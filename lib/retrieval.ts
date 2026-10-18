import { embedQuery } from './ai';
import { EMBEDDING_DIMENSIONS, getPool, sql, toVectorJson } from './db';

export type RetrievedChunk = {
  id: number;
  documentId: string;
  documentName: string;
  page: number;
  content: string;
  similarity: number;
};

export type SearchResult = {
  /** Fragmentos que superan el umbral mínimo: son los que se pasan al modelo */
  chunks: RetrievedChunk[];
  /** Los k más cercanos sin filtrar: se usan para medir la calidad de la recuperación */
  nearest: RetrievedChunk[];
  /** Embedding de la consulta (se guarda en dbo.Queries para agrupar por tema) */
  embedding: number[];
};

/**
 * Búsqueda semántica con el tipo VECTOR de SQL Server 2025:
 * devuelve los `k` fragmentos más cercanos a la pregunta (distancia coseno),
 * opcionalmente filtrando por documentos.
 */
export async function searchChunks(
  query: string,
  { k = 6, documentIds = [] as string[], minSimilarity = 0.25 } = {},
): Promise<SearchResult> {
  const embedding = await embedQuery(query);
  const pool = await getPool();

  const filter = documentIds.length
    ? 'AND c.DocumentId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@documentIds))'
    : '';

  // VECTOR_DISTANCE('cosine') devuelve 0 (idénticos) a 2 (opuestos); similitud = 1 - distancia
  const { recordset } = await pool
    .request()
    .input('k', sql.Int, k)
    .input('queryVector', sql.NVarChar(sql.MAX), toVectorJson(embedding))
    .input('documentIds', sql.NVarChar(sql.MAX), JSON.stringify(documentIds))
    .query<RetrievedChunk>(`
      DECLARE @q VECTOR(${EMBEDDING_DIMENSIONS}) = CAST(@queryVector AS VECTOR(${EMBEDDING_DIMENSIONS}));

      SELECT TOP (@k)
             c.Id         AS id,
             c.DocumentId AS documentId,
             d.Name       AS documentName,
             c.Page       AS page,
             c.Content    AS content,
             1 - VECTOR_DISTANCE('cosine', c.Embedding, @q) AS similarity
      FROM dbo.Chunks c
      JOIN dbo.Documents d ON d.Id = c.DocumentId
      WHERE d.Status = 'ready'
      ${filter}
      ORDER BY VECTOR_DISTANCE('cosine', c.Embedding, @q);
    `);

  const nearest = recordset.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  return {
    nearest,
    chunks: nearest.filter((r) => r.similarity >= minSimilarity),
    embedding,
  };
}
