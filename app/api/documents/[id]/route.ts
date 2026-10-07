import { getPool, sql } from '@/lib/db';

export const runtime = 'nodejs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/documents/:id — borra el documento y sus fragmentos (ON DELETE CASCADE) */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!GUID.test(id)) {
    return Response.json({ error: 'Id inválido.' }, { status: 400 });
  }

  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('DELETE FROM dbo.Documents WHERE Id = @id');

  if (result.rowsAffected[0] === 0) {
    return Response.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
