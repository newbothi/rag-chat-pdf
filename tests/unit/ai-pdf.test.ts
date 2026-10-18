import { readFile } from 'node:fs/promises';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { models } = vi.hoisted(() => ({
  models: { chat: null as unknown as MockLanguageModelV4, embedding: null as unknown as MockEmbeddingModelV4 },
}));

// Reemplaza el proveedor (LM Studio / Ollama) por modelos simulados
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({
    chatModel: () => models.chat,
    embeddingModel: () => models.embedding,
  }),
}));

models.chat = new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [
      { type: 'text', text: '¿Qué nota se necesita para optar a un aumento?\nExplicación: la pregunta anterior...' },
    ],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  }),
});
models.embedding = new MockEmbeddingModelV4({
  maxEmbeddingsPerCall: 2,
  doEmbed: async ({ values }) => ({ embeddings: values.map((v) => [v.length, 1]), warnings: [] }),
});

const { embedChunks, embedQuery, rewriteQuery } = await import('@/lib/ai');
const { extractPdfPages } = await import('@/lib/pdf');

beforeEach(() => {
  models.chat.doGenerateCalls.length = 0;
  models.embedding.doEmbedCalls.length = 0;
});

describe('rewriteQuery', () => {
  it('sin historial no llama al modelo', async () => {
    expect(await rewriteQuery('', '¿Cuántos días de vacaciones tengo?')).toBe('¿Cuántos días de vacaciones tengo?');
    expect(models.chat.doGenerateCalls).toHaveLength(0);
  });

  it('con historial reescribe la pregunta y se queda solo con la primera línea', async () => {
    const result = await rewriteQuery('Usuario: ¿Cómo se evalúa el desempeño?', '¿y qué nota necesito?');
    expect(result).toBe('¿Qué nota se necesita para optar a un aumento?');
    expect(JSON.stringify(models.chat.doGenerateCalls[0].prompt)).toContain('¿y qué nota necesito?');
  });
});

describe('embeddings', () => {
  it('embedChunks divide en lotes según el límite del modelo y conserva el orden', async () => {
    const result = await embedChunks(['a', 'bb', 'ccc', 'dddd', 'eeeee']);
    expect(result.map((e) => e[0])).toEqual([1, 2, 3, 4, 5]);
    expect(models.embedding.doEmbedCalls).toHaveLength(3); // lotes de 2
  });

  it('embedQuery devuelve un solo vector', async () => {
    expect(await embedQuery('hola')).toEqual([4, 1]);
  });
});

describe('extractPdfPages (PDF real de ejemplo)', () => {
  it('extrae el texto página por página', async () => {
    const buffer = await readFile('docs/ejemplo/reglamento-interno-nimbus.pdf');
    const { totalPages, pages } = await extractPdfPages(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    expect(totalPages).toBe(3);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('Jornada laboral');
    expect(pages[1]).toContain('15 días hábiles');
    expect(pages[2]).toContain('Evaluación de desempeño');
  });

  it('rechaza un archivo que no es PDF', async () => {
    await expect(extractPdfPages(new TextEncoder().encode('no soy un pdf').buffer)).rejects.toThrow();
  });
});
