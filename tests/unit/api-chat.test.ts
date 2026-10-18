import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ANSWER } = vi.hoisted(() => {
  const ANSWER = ['Tienes 15 días hábiles', ' de vacaciones [1].'];
  return { ANSWER };
});

const mockModel = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start', id: 't1' },
        ...ANSWER.map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
        },
      ],
    }),
  }),
});

vi.mock('@/lib/ai', () => ({
  get chatModel() {
    return mockModel;
  },
  rewriteQuery: vi.fn(async (_history: string, question: string) => question),
}));
vi.mock('@/lib/retrieval', () => ({ searchChunks: vi.fn() }));
vi.mock('@/lib/analytics', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/analytics')>();
  return { ...real, predictConfidence: vi.fn(), logQuery: vi.fn(), saveAnswer: vi.fn() };
});

import { POST } from '@/app/api/chat/route';
import * as ai from '@/lib/ai';
import * as analytics from '@/lib/analytics';
import * as retrieval from '@/lib/retrieval';

const hit = (similarity: number, page: number) => ({
  id: page,
  documentId: 'doc-1',
  documentName: 'reglamento.pdf',
  page,
  content: `Contenido de la página ${page}: 15 días hábiles de vacaciones.`,
  similarity,
});

const userMessage = (text: string, id = 'u1') => ({ id, role: 'user', parts: [{ type: 'text', text }] });

async function callChat(body: object) {
  const res = await POST(
    new Request('http://app.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const raw = await res.text();
  const events = raw
    .split('\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line) => JSON.parse(line.slice(6)));
  const start = events.find((e) => e.type === 'start');
  const text = events
    .filter((e) => e.type === 'text-delta')
    .map((e) => e.delta)
    .join('');
  return { res, metadata: start?.messageMetadata, text };
}

const lastPrompt = () => JSON.stringify(mockModel.doStreamCalls.at(-1)?.prompt);

beforeEach(() => {
  vi.clearAllMocks();
  const hits = [hit(0.78, 2), hit(0.66, 2), hit(0.41, 3)];
  vi.mocked(retrieval.searchChunks).mockResolvedValue({ nearest: hits, chunks: hits, embedding: [0.1, 0.2] });
  vi.mocked(analytics.predictConfidence).mockResolvedValue({ probability: 0.86, level: 'alta', model: 'logistic' });
  vi.mocked(analytics.logQuery).mockResolvedValue(undefined);
  vi.mocked(analytics.saveAnswer).mockResolvedValue(undefined);
});

describe('POST /api/chat', () => {
  it('responde en streaming con fuentes, id de consulta y confianza', async () => {
    const { res, metadata, text } = await callChat({ messages: [userMessage('¿Cuántos días de vacaciones tengo?')] });

    expect(res.status).toBe(200);
    expect(text).toBe(ANSWER.join(''));
    expect(metadata.sources).toHaveLength(3);
    expect(metadata.sources[0]).toMatchObject({ n: 1, documentName: 'reglamento.pdf', page: 2, similarity: 0.78 });
    expect(metadata.queryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(metadata.confidence).toEqual({ probability: 0.86, level: 'alta', model: 'logistic' });
  });

  it('pasa el contexto numerado al modelo para que cite las fuentes', async () => {
    await callChat({ messages: [userMessage('¿Cuántos días de vacaciones tengo?')] });
    expect(lastPrompt()).toContain('[1] (reglamento.pdf, pág. 2)');
    expect(lastPrompt()).toContain('[3] (reglamento.pdf, pág. 3)');
  });

  it('avisa al modelo cuando no hay contexto relevante', async () => {
    vi.mocked(retrieval.searchChunks).mockResolvedValue({ nearest: [hit(0.2, 1)], chunks: [], embedding: [0.1] });
    const { metadata } = await callChat({ messages: [userMessage('¿Cuál es el sueldo base?')] });
    expect(lastPrompt()).toContain('NO SE ENCONTRÓ CONTEXTO RELEVANTE');
    expect(metadata.sources).toEqual([]);
  });

  it('registra la consulta con las métricas de la búsqueda y guarda la respuesta al terminar', async () => {
    const { metadata } = await callChat({
      messages: [userMessage('¿Cuántos días de vacaciones tengo?')],
      documentIds: ['doc-1'],
    });

    expect(retrieval.searchChunks).toHaveBeenCalledWith('¿Cuántos días de vacaciones tengo?', {
      documentIds: ['doc-1'],
    });
    const logged = vi.mocked(analytics.logQuery).mock.calls[0][0];
    expect(logged.id).toBe(metadata.queryId);
    expect(logged.features).toMatchObject({
      top_similarity: 0.78,
      chunks_above_threshold: 2,
      distinct_pages: 1,
      has_document_filter: true,
      is_follow_up: false,
    });
    await vi.waitFor(() =>
      expect(analytics.saveAnswer).toHaveBeenCalledWith(metadata.queryId, ANSWER.join(''), expect.any(Number)),
    );
  });

  it('marca como seguimiento las preguntas reescritas con el historial', async () => {
    vi.mocked(ai.rewriteQuery).mockResolvedValueOnce('¿Qué nota se necesita para un aumento de sueldo?');
    await callChat({
      messages: [
        userMessage('¿Cómo se evalúa el desempeño?', 'u1'),
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Dos veces al año.' }] },
        userMessage('¿y qué nota necesito?', 'u2'),
      ],
    });
    expect(vi.mocked(analytics.logQuery).mock.calls[0][0].features.is_follow_up).toBe(true);
  });

  it('sigue respondiendo si el servicio Python y el registro fallan', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(analytics.predictConfidence).mockResolvedValue(null);
    vi.mocked(analytics.logQuery).mockRejectedValue(new Error('Invalid object name dbo.Queries'));

    const { res, metadata, text } = await callChat({ messages: [userMessage('¿Cuántos días de vacaciones tengo?')] });

    expect(res.status).toBe(200);
    expect(text).toBe(ANSWER.join(''));
    expect(metadata.sources).toHaveLength(3);
    expect(metadata.queryId).toBeUndefined(); // sin id no se muestran los botones de feedback
    expect(metadata.confidence).toBeNull();
    expect(analytics.saveAnswer).not.toHaveBeenCalled();
  });
});
