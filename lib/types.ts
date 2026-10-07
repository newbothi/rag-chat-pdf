import type { UIMessage } from 'ai';

export type Source = {
  n: number;
  documentId: string;
  documentName: string;
  page: number;
  similarity: number;
  snippet: string;
};

/** Mensaje del chat: los metadatos llevan las fuentes usadas para responder. */
export type ChatMessage = UIMessage<{ sources?: Source[] }>;

export type DocumentRow = {
  id: string;
  name: string;
  pages: number;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'error';
  error: string | null;
  chunks: number;
  createdAt: string;
};
