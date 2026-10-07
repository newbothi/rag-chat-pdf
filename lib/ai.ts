import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed, embedMany, generateText } from 'ai';

/**
 * Ollama y LM Studio exponen una API compatible con OpenAI en /v1,
 * así que usamos el proveedor oficial "openai-compatible" del AI SDK.
 * Chat y embeddings pueden venir de servidores distintos:
 *   - Chat:       Ollama    → http://localhost:11434/v1
 *   - Embeddings: LM Studio → http://localhost:1234/v1   (o el mismo Ollama)
 */
const chatProvider = createOpenAICompatible({
  name: 'chat',
  baseURL: process.env.CHAT_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
});

const embeddingProvider = createOpenAICompatible({
  name: 'embeddings',
  baseURL: process.env.EMBEDDING_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
});

// Modelo de embeddings (bge-m3 = 1024 dimensiones → VECTOR(1024) en SQL Server)
export const embeddingModel = embeddingProvider.embeddingModel(process.env.EMBEDDING_MODEL ?? 'bge-m3');

// Modelo de chat
export const chatModel = chatProvider.chatModel(process.env.CHAT_MODEL ?? 'llama3.2');

/** Embeddings en lote para la ingesta. */
export async function embedChunks(values: string[]) {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values,
    maxParallelCalls: 1, // local: una petición a la vez para no saturar el servidor
  });
  return embeddings;
}

/** Embedding de la pregunta del usuario. */
export async function embedQuery(value: string) {
  const { embedding } = await embed({ model: embeddingModel, value });
  return embedding;
}

/**
 * Reescribe preguntas de seguimiento ("¿y el segundo punto?") como preguntas
 * autónomas, para que la búsqueda vectorial encuentre los fragmentos correctos.
 */
export async function rewriteQuery(history: string, question: string) {
  if (!history.trim()) return question;
  const { text } = await generateText({
    model: chatModel,
    instructions:
      'Reescribe la última pregunta del usuario como una pregunta autónoma y completa, ' +
      'usando el historial solo para resolver referencias. Responde SOLO con la pregunta, sin comillas ni explicaciones.',
    prompt: `Historial:\n${history}\n\nÚltima pregunta: ${question}`,
  });
  const rewritten = text.trim().split('\n')[0];
  return rewritten || question;
}
