import type { UIMessage } from 'ai';
import type { ConfidencePrediction } from './analytics';

export type Source = {
  n: number;
  documentId: string;
  documentName: string;
  page: number;
  similarity: number;
  snippet: string;
};

/** Metadatos de cada respuesta: fuentes usadas, id para el feedback y confianza estimada. */
export type ChatMetadata = {
  sources?: Source[];
  queryId?: string;
  confidence?: ConfidencePrediction | null;
};

export type ChatMessage = UIMessage<ChatMetadata>;

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
