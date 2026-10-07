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

/**
 * Búsqueda semántica con el tipo VECTOR de SQL Server 2025:
 * devuelve los `k` fragmentos más cercanos a la pregunta (distancia coseno),
 * opcionalmente filtrando por documentos.
 */
export async function searchChunks(
  query: string,
  { k = 6, documentIds = [] as string[], minSimilarity = 0.25 } = {},
): Promise<RetrievedChunk[]> {
  const queryVector = toVectorJson(await embedQuery(query));
  const pool = await getPool();

  const filter = documentIds.length
    ? 'AND c.DocumentId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@documentIds))'
    : '';

  // VECTOR_DISTANCE('cosine') devuelve 0 (idénticos) a 2 (opuestos); similitud = 1 - distancia
  const { recordset } = await pool
    .request()
    .input('k', sql.Int, k)
    .input('queryVector', sql.NVarChar(sql.MAX), queryVector)
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

  return recordset.filter((r) => Number(r.similarity) >= minSimilarity);
}
