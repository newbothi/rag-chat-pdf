import { embedChunks } from '@/lib/ai';
import { chunkPages } from '@/lib/chunking';
import { EMBEDDING_DIMENSIONS, getPool, sql } from '@/lib/db';
import { extractPdfPages } from '@/lib/pdf';
import type { DocumentRow } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024;
const BATCH_SIZE = 200;

/** GET /api/documents — lista los documentos subidos */
export async function GET() {
  const pool = await getPool();
  const { recordset } = await pool.request().query<DocumentRow>(`
    SELECT d.Id AS id, d.Name AS name, d.Pages AS pages, d.SizeBytes AS sizeBytes,
           d.Status AS status, d.Error AS error, d.CreatedAt AS createdAt,
           (SELECT COUNT(*) FROM dbo.Chunks c WHERE c.DocumentId = d.Id) AS chunks
    FROM dbo.Documents d
    ORDER BY d.CreatedAt DESC
  `);
  return Response.json(recordset);
}

/** POST /api/documents — sube un PDF: extrae texto → fragmenta → embeddings → SQL Server (VECTOR) */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return Response.json({ error: 'Falta el archivo (campo "file").' }, { status: 400 });
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return Response.json({ error: 'Solo se aceptan archivos PDF.' }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `El archivo supera el máximo de ${process.env.MAX_UPLOAD_MB ?? 20} MB.` },
      { status: 413 },
    );
  }

  // 1. Extraer texto por página
  let pages: string[];
  let totalPages: number;
  try {
    ({ pages, totalPages } = await extractPdfPages(await file.arrayBuffer()));
  } catch {
    return Response.json({ error: 'No se pudo leer el PDF (¿está dañado o protegido?).' }, { status: 422 });
  }

  // 2. Fragmentar
  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    return Response.json(
      { error: 'El PDF no tiene texto extraíble. Probablemente es escaneado (requiere OCR).' },
      { status: 422 },
    );
  }

  const pool = await getPool();
  const { recordset } = await pool
    .request()
    .input('name', sql.NVarChar(400), file.name)
    .input('pages', sql.Int, totalPages)
    .input('size', sql.Int, file.size)
    .query<{ id: string }>(`
      INSERT INTO dbo.Documents (Name, Pages, SizeBytes)
      OUTPUT INSERTED.Id AS id
      VALUES (@name, @pages, @size)
    `);
  const documentId = recordset[0].id;

  try {
    // 3. Embeddings
    const embeddings = await embedChunks(chunks.map((c) => c.content));

    // 4. Guardar en lotes: cada lote viaja como un JSON y se inserta con OPENJSON
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE).map((c, j) => ({
          idx: c.index,
          page: c.page,
          content: c.content,
          embedding: embeddings[i + j],
        }));

        await new sql.Request(tx)
          .input('documentId', sql.UniqueIdentifier, documentId)
          .input('json', sql.NVarChar(sql.MAX), JSON.stringify(batch))
          .query(`
            INSERT INTO dbo.Chunks (DocumentId, ChunkIndex, Page, Content, Embedding)
            SELECT @documentId, j.idx, j.page, j.content,
                   CAST(j.embedding AS VECTOR(${EMBEDDING_DIMENSIONS}))
            FROM OPENJSON(@json) WITH (
              idx       INT           '$.idx',
              page      INT           '$.page',
              content   NVARCHAR(MAX) '$.content',
              embedding NVARCHAR(MAX) '$.embedding' AS JSON
            ) AS j;
          `);
      }

      await new sql.Request(tx)
        .input('documentId', sql.UniqueIdentifier, documentId)
        .query(`UPDATE dbo.Documents SET Status = 'ready' WHERE Id = @documentId`);

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    await pool
      .request()
      .input('documentId', sql.UniqueIdentifier, documentId)
      .input('error', sql.NVarChar(sql.MAX), message)
      .query(`UPDATE dbo.Documents SET Status = 'error', Error = @error WHERE Id = @documentId`);
    return Response.json({ error: `Error al procesar el documento: ${message}` }, { status: 500 });
  }

  return Response.json({ id: documentId, pages: totalPages, chunks: chunks.length }, { status: 201 });
}
