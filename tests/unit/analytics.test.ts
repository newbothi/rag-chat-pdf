import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsUnavailableError,
  computeFeatures,
  getReport,
  predictConfidence,
  type QueryFeatures,
  retrainInBackground,
} from '@/lib/analytics';
import type { RetrievedChunk } from '@/lib/retrieval';

const chunk = (similarity: number, page = 1, documentId = 'doc-a'): RetrievedChunk => ({
  id: Math.round(similarity * 1000),
  documentId,
  documentName: 'reglamento.pdf',
  page,
  content: '...',
  similarity,
});

const base = { question: '¿Cuántos días de vacaciones tengo?', isFollowUp: false, hasDocumentFilter: false };

describe('computeFeatures', () => {
  it('calcula las métricas de la recuperación', () => {
    const f = computeFeatures([chunk(0.8, 1), chunk(0.7, 2), chunk(0.6, 2), chunk(0.4, 3)], base);
    expect(f.top_similarity).toBe(0.8);
    expect(f.avg_similarity).toBeCloseTo(0.625);
    expect(f.similarity_spread).toBeCloseTo(0.4);
    expect(f.chunks_above_threshold).toBe(3); // umbral 0.5
    expect(f.distinct_pages).toBe(2); // páginas 1 y 2 entre los relevantes
    expect(f.question_words).toBe(5);
    expect(f.is_follow_up).toBe(false);
    expect(f.has_document_filter).toBe(false);
  });

  it('distingue la misma página de documentos distintos', () => {
    const f = computeFeatures([chunk(0.9, 1, 'a'), chunk(0.8, 1, 'b')], base);
    expect(f.distinct_pages).toBe(2);
  });

  it('funciona sin resultados (no hay documentos)', () => {
    const f = computeFeatures([], { ...base, question: '  ' });
    expect(f).toMatchObject({
      top_similarity: 0,
      avg_similarity: 0,
      similarity_spread: 0,
      chunks_above_threshold: 0,
      distinct_pages: 0,
      question_words: 0,
    });
  });

  it('limita las similitudes al rango válido del contrato (-1..1)', () => {
    const f = computeFeatures([chunk(1.0000002)], base);
    expect(f.top_similarity).toBeLessThanOrEqual(1);
  });

  it('propaga si es seguimiento y si hay filtro', () => {
    const f = computeFeatures([chunk(0.7)], { ...base, isFollowUp: true, hasDocumentFilter: true });
    expect(f.is_follow_up).toBe(true);
    expect(f.has_document_filter).toBe(true);
  });
});

describe('cliente del servicio Python', () => {
  const features: QueryFeatures = computeFeatures([chunk(0.7)], base);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envía la clave compartida y devuelve la predicción', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ probability: 0.82, level: 'alta', model: 'logistic' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await predictConfidence(features);

    expect(result).toEqual({ probability: 0.82, level: 'alta', model: 'logistic' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://analytics.test/confidence/predict');
    expect(init.method).toBe('POST');
    expect(init.headers['x-analytics-key']).toBe('unit-test-key');
    expect(JSON.parse(init.body)).toEqual(features);
  });

  it('devuelve null (y el chat sigue) si Python no responde', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await predictConfidence(features)).toBeNull();
  });

  it('devuelve null si Python rechaza la clave', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Clave inválida' }, { status: 401 })));
    expect(await predictConfidence(features)).toBeNull();
  });

  it('getReport lanza un error tipado con el detalle de Python', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ detail: 'Sin base de datos' }, { status: 503 })),
    );
    await expect(getReport(true)).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(getReport(true)).rejects.toThrow('Sin base de datos');
  });

  it('getReport pasa el filtro de datos sintéticos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await getReport(false);
    expect(fetchMock.mock.calls[0][0]).toBe('http://analytics.test/report?include_synthetic=false');
  });

  it('el reentrenamiento en segundo plano no lanza errores aunque falle', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('caído')));
    expect(() => retrainInBackground()).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
