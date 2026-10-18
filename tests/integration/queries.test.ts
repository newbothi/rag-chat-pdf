import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { logQuery, type QueryFeatures, saveAnswer, saveFeedback } from '@/lib/analytics';
import { closePool } from '@/lib/db';
import { fakeEmbedding, query, resetTables } from './helpers';

const features: QueryFeatures = {
  top_similarity: 0.71,
  avg_similarity: 0.58,
  similarity_spread: 0.24,
  chunks_above_threshold: 3,
  distinct_pages: 2,
  question_words: 6,
  is_follow_up: true,
  has_document_filter: false,
};

async function insertQuery(id = crypto.randomUUID()) {
  await logQuery({
    id,
    question: '¿Cuántos días de vacaciones tengo?',
    searchQuery: '¿Cuántos días de vacaciones tengo al año?',
    embedding: fakeEmbedding('vacaciones'),
    features,
    confidence: { probability: 0.83, level: 'alta', model: 'logistic' },
  });
  return id;
}

beforeEach(resetTables);
afterAll(closePool);

describe('registro de consultas (dbo.Queries)', () => {
  it('guarda la consulta con sus features, embedding y confianza', async () => {
    const id = await insertQuery();

    const [row] = await query<Record<string, unknown>>(`
      SELECT Question, SearchQuery, TopSimilarity, AvgSimilarity, SimilaritySpread, ChunksAboveThreshold,
             DistinctPages, QuestionWords, IsFollowUp, HasDocumentFilter, Confidence, ConfidenceModel,
             Answer, Feedback, IsSynthetic,
             (SELECT COUNT(*) FROM OPENJSON(CAST(Embedding AS NVARCHAR(MAX)))) AS Dims
      FROM dbo.Queries WHERE Id = '${id}'`);

    expect(row).toEqual({
      Question: '¿Cuántos días de vacaciones tengo?',
      SearchQuery: '¿Cuántos días de vacaciones tengo al año?',
      TopSimilarity: 0.71,
      AvgSimilarity: 0.58,
      SimilaritySpread: 0.24,
      ChunksAboveThreshold: 3,
      DistinctPages: 2,
      QuestionWords: 6,
      IsFollowUp: true,
      HasDocumentFilter: false,
      Confidence: 0.83,
      ConfidenceModel: 'logistic',
      Answer: null,
      Feedback: null,
      IsSynthetic: false,
      Dims: 1024,
    });
  });

  it('acepta consultas sin confianza (servicio Python caído)', async () => {
    const id = crypto.randomUUID();
    await logQuery({
      id,
      question: 'hola',
      searchQuery: 'hola',
      embedding: fakeEmbedding('hola'),
      features,
      confidence: null,
    });
    const [row] = await query<{ Confidence: null; ConfidenceModel: null }>(
      `SELECT Confidence, ConfidenceModel FROM dbo.Queries WHERE Id = '${id}'`,
    );
    expect(row).toEqual({ Confidence: null, ConfidenceModel: null });
  });

  it('guarda la respuesta y la latencia al terminar el streaming', async () => {
    const id = await insertQuery();
    await saveAnswer(id, 'Tienes 15 días hábiles [1].', 1834.6);
    const [row] = await query<{ Answer: string; LatencyMs: number }>(
      `SELECT Answer, LatencyMs FROM dbo.Queries WHERE Id = '${id}'`,
    );
    expect(row).toEqual({ Answer: 'Tienes 15 días hábiles [1].', LatencyMs: 1835 });
  });

  it('guarda el feedback con su fecha y permite cambiarlo', async () => {
    const id = await insertQuery();

    expect(await saveFeedback(id, 1)).toBe(true);
    expect(await saveFeedback(id, -1)).toBe(true);

    const [row] = await query<{ Feedback: number; FeedbackAt: Date }>(
      `SELECT Feedback, FeedbackAt FROM dbo.Queries WHERE Id = '${id}'`,
    );
    expect(row.Feedback).toBe(-1);
    expect(row.FeedbackAt).toBeInstanceOf(Date);
  });

  it('saveFeedback devuelve false si la consulta no existe', async () => {
    expect(await saveFeedback(crypto.randomUUID(), 1)).toBe(false);
  });

  it('la base rechaza valores de feedback inválidos (CHECK)', async () => {
    const id = await insertQuery();
    await expect(query(`UPDATE dbo.Queries SET Feedback = 2 WHERE Id = '${id}'`)).rejects.toThrow(/CHECK/);
  });

  it('trunca preguntas muy largas en vez de fallar', async () => {
    const id = crypto.randomUUID();
    const long = 'a'.repeat(5000);
    await logQuery({
      id,
      question: long,
      searchQuery: long,
      embedding: fakeEmbedding('x'),
      features,
      confidence: null,
    });
    const [row] = await query<{ Len: number }>(`SELECT LEN(Question) AS Len FROM dbo.Queries WHERE Id = '${id}'`);
    expect(row.Len).toBe(2000);
  });
});
