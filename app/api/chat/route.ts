import { convertToModelMessages, streamText } from 'ai';
import { chatModel, rewriteQuery } from '@/lib/ai';
import { searchChunks } from '@/lib/retrieval';
import type { ChatMessage, Source } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const textOf = (m: ChatMessage) =>
  m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

export async function POST(req: Request) {
  const { messages, documentIds = [] }: { messages: ChatMessage[]; documentIds?: string[] } =
    await req.json();

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser ? textOf(lastUser) : '';

  // Historial reciente (sin la última pregunta) para resolver preguntas de seguimiento
  const history = messages
    .slice(0, -1)
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${textOf(m)}`)
    .join('\n');

  // 1. Recuperación (Retrieval)
  const searchQuery = await rewriteQuery(history, question);
  const chunks = question ? await searchChunks(searchQuery, { documentIds }) : [];

  const sources: Source[] = chunks.map((c, i) => ({
    n: i + 1,
    documentId: c.documentId,
    documentName: c.documentName,
    page: c.page,
    similarity: Number(c.similarity),
    snippet: c.content.slice(0, 280),
  }));

  const context = chunks.length
    ? chunks
        .map((c, i) => `[${i + 1}] (${c.documentName}, pág. ${c.page})\n${c.content}`)
        .join('\n\n---\n\n')
    : 'NO SE ENCONTRÓ CONTEXTO RELEVANTE.';

  // 2. Generación aumentada (Augmented Generation) en streaming
  const result = streamText({
    model: chatModel,
    instructions: `Eres un asistente que responde preguntas usando EXCLUSIVAMENTE el contexto extraído de los documentos del usuario.

Reglas:
- Responde en el idioma de la pregunta.
- Cita las fuentes con su número entre corchetes, por ejemplo [1] o [2][3], justo después de la afirmación que respaldan.
- Si el contexto no contiene la respuesta, dilo claramente ("No encontré esa información en los documentos") y no inventes.
- Sé conciso y usa listas cuando ayuden.

Contexto:
${context}`,
    messages: await convertToModelMessages(messages),
  });

  // 3. Las fuentes viajan como metadatos del mensaje para mostrarlas en la UI
  return result.toUIMessageStreamResponse<ChatMessage>({
    messageMetadata: ({ part }) => (part.type === 'start' ? { sources } : undefined),
  });
}
