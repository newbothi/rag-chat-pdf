import type { components } from './analytics-api';
import { EMBEDDING_DIMENSIONS, getPool, sql, toVectorJson } from './db';
import type { RetrievedChunk } from './retrieval';

/**
 * Integración con el servicio de análisis en Python (analytics/).
 * Los tipos vienen de lib/analytics-api.d.ts, generado desde el OpenAPI de FastAPI
 * (`npm run gen:analytics-types`): si Python cambia el contrato, TypeScript lo detecta.
 */
type Schemas = components['schemas'];
export type QueryFeatures = Schemas['QueryFeatures'];
export type ConfidencePrediction = Schemas['ConfidencePrediction'];
export type AnalyticsReport = Schemas['AnalyticsReport'];
export type TrainResponse = Schemas['TrainResponse'];

const ANALYTICS_URL = (process.env.ANALYTICS_URL ?? 'http://localhost:8001').replace(/\/$/, '');
const ANALYTICS_API_KEY = process.env.ANALYTICS_API_KEY ?? '';

/** Similitud a partir de la cual un fragmento cuenta como relevante (mismo valor que usa Python). */
export const RELEVANCE_THRESHOLD = Number(process.env.RELEVANCE_THRESHOLD ?? 0.5);

export class AnalyticsUnavailableError extends Error {}

async function analyticsFetch<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${ANALYTICS_URL}${path}`, {
      ...rest,
      headers: { 'content-type': 'application/json', 'x-analytics-key': ANALYTICS_API_KEY, ...rest.headers },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    throw new AnalyticsUnavailableError(
      `El servicio de análisis no responde en ${ANALYTICS_URL} (${err instanceof Error ? err.message : err}).`,
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AnalyticsUnavailableError(body.detail ?? `El servicio de análisis respondió ${res.status}.`);
  }
  return res.json() as Promise<T>;
}

/** Métricas de la recuperación: se conocen ANTES de generar la respuesta. */
export function computeFeatures(
  nearest: RetrievedChunk[],
  { question, isFollowUp, hasDocumentFilter }: { question: string; isFollowUp: boolean; hasDocumentFilter: boolean },
): QueryFeatures {
  const sims = nearest.map((c) => c.similarity);
  const relevant = nearest.filter((c) => c.similarity >= RELEVANCE_THRESHOLD);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    top_similarity: clamp(sims[0] ?? 0),
    avg_similarity: clamp(sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0),
    similarity_spread: sims.length ? Math.max(0, sims[0] - sims[sims.length - 1]) : 0,
    chunks_above_threshold: relevant.length,
    distinct_pages: new Set(relevant.map((c) => `${c.documentId}:${c.page}`)).size,
    question_words: question.trim().split(/\s+/).filter(Boolean).length,
    is_follow_up: isFollowUp,
    has_document_filter: hasDocumentFilter,
  };
}

/** Predicción de confianza. Si Python no responde a tiempo, el chat sigue funcionando sin ella. */
export async function predictConfidence(features: QueryFeatures): Promise<ConfidencePrediction | null> {
  try {
    return await analyticsFetch<ConfidencePrediction>('/confidence/predict', {
      method: 'POST',
      body: JSON.stringify(features),
      timeoutMs: 1500,
    });
  } catch (err) {
    console.warn('[analytics] Sin predicción de confianza:', (err as Error).message);
    return null;
  }
}

/** Reentrena el modelo en segundo plano (no bloquea la respuesta al usuario). */
export function retrainInBackground() {
  analyticsFetch<TrainResponse>('/confidence/train', { method: 'POST', timeoutMs: 30_000 }).catch((err) =>
    console.warn('[analytics] No se pudo reentrenar:', (err as Error).message),
  );
}

export function retrain() {
  return analyticsFetch<TrainResponse>('/confidence/train', { method: 'POST', timeoutMs: 30_000 });
}

export function getReport(includeSynthetic: boolean) {
  return analyticsFetch<AnalyticsReport>(`/report?include_synthetic=${includeSynthetic}`, { timeoutMs: 30_000 });
}

// ---------- Registro en dbo.Queries ----------

export async function logQuery(q: {
  id: string;
  question: string;
  searchQuery: string;
  embedding: number[];
  features: QueryFeatures;
  confidence: ConfidencePrediction | null;
}) {
  const f = q.features;
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.UniqueIdentifier, q.id)
    .input('question', sql.NVarChar(2000), q.question.slice(0, 2000))
    .input('searchQuery', sql.NVarChar(2000), q.searchQuery.slice(0, 2000))
    .input('embedding', sql.NVarChar(sql.MAX), toVectorJson(q.embedding))
    .input('top', sql.Float, f.top_similarity)
    .input('avg', sql.Float, f.avg_similarity)
    .input('spread', sql.Float, f.similarity_spread)
    .input('above', sql.Int, f.chunks_above_threshold)
    .input('pages', sql.Int, f.distinct_pages)
    .input('words', sql.Int, f.question_words)
    .input('followUp', sql.Bit, f.is_follow_up)
    .input('filter', sql.Bit, f.has_document_filter)
    .input('confidence', sql.Float, q.confidence?.probability ?? null)
    .input('confidenceModel', sql.VarChar(20), q.confidence?.model ?? null)
    .query(`
      INSERT INTO dbo.Queries (
        Id, Question, SearchQuery, Embedding,
        TopSimilarity, AvgSimilarity, SimilaritySpread, ChunksAboveThreshold, DistinctPages,
        QuestionWords, IsFollowUp, HasDocumentFilter, Confidence, ConfidenceModel
      )
      VALUES (
        @id, @question, @searchQuery, CAST(@embedding AS VECTOR(${EMBEDDING_DIMENSIONS})),
        @top, @avg, @spread, @above, @pages, @words, @followUp, @filter, @confidence, @confidenceModel
      )
    `);
}

export async function saveAnswer(id: string, answer: string, latencyMs: number) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('answer', sql.NVarChar(sql.MAX), answer)
    .input('latency', sql.Int, Math.round(latencyMs))
    .query('UPDATE dbo.Queries SET Answer = @answer, LatencyMs = @latency WHERE Id = @id');
}

/** Devuelve false si la consulta no existe. */
export async function saveFeedback(id: string, value: 1 | -1) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('value', sql.SmallInt, value)
    .query('UPDATE dbo.Queries SET Feedback = @value, FeedbackAt = SYSUTCDATETIME() WHERE Id = @id');
  return result.rowsAffected[0] > 0;
}
