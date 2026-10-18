import { readFile } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEmbedding, query, resetTables } from './helpers';

// Lo único simulado es el modelo de embeddings: PDF, fragmentación y SQL Server son reales.
vi.mock('@/lib/ai', () => ({
  embedChunks: vi.fn(async (values: string[]) => values.map(fakeEmbedding)),
  embedQuery: vi.fn(async (value: string) => fakeEmbedding(value)),
}));

import { DELETE } from '@/app/api/documents/[id]/route';
import { GET, POST } from '@/app/api/documents/route';
import * as ai from '@/lib/ai';
import { closePool, getPool } from '@/lib/db';
import { searchChunks } from '@/lib/retrieval';

const PDF_PATH = 'docs/ejemplo/reglamento-interno-nimbus.pdf';

async function uploadPdf(name = 'reglamento.pdf') {
  const bytes = await readFile(PDF_PATH);
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: 'application/pdf' }));
  const res = await POST(new Request('http://app.test/api/documents', { method: 'POST', body: form }));
  return { res, body: await res.json() };
}

beforeEach(resetTables);
afterAll(closePool);

describe('ingesta de PDF en SQL Server (VECTOR)', () => {
  it('guarda el documento y sus fragmentos con embeddings de 1024 dimensiones', async () => {
    const { res, body } = await uploadPdf();

    expect(res.status).toBe(201);
    expect(body.pages).toBe(3);
    expect(body.chunks).toBeGreaterThan(3);

    const [doc] = await query<{ Status: string; Pages: number; Chunks: number }>(`
      SELECT d.Status, d.Pages, (SELECT COUNT(*) FROM dbo.Chunks c WHERE c.DocumentId = d.Id) AS Chunks
      FROM dbo.Documents d`);
    expect(doc).toEqual({ Status: 'ready', Pages: 3, Chunks: body.chunks });

    const [dims] = await query<{ Dims: number }>(`
      SELECT TOP 1 (SELECT COUNT(*) FROM OPENJSON(CAST(Embedding AS NVARCHAR(MAX)))) AS Dims FROM dbo.Chunks`);
    expect(dims.Dims).toBe(1024);
  });

  it('conserva el orden y la página de cada fragmento', async () => {
    await uploadPdf();
    const rows = await query<{ ChunkIndex: number; Page: number }>(
      'SELECT ChunkIndex, Page FROM dbo.Chunks ORDER BY ChunkIndex',
    );
    expect(rows.map((r) => r.ChunkIndex)).toEqual(rows.map((_, i) => i));
    expect(rows[0].Page).toBe(1);
    expect(rows.at(-1)?.Page).toBe(3);
    // Las páginas nunca retroceden
    for (let i = 1; i < rows.length; i++) expect(rows[i].Page).toBeGreaterThanOrEqual(rows[i - 1].Page);
  });

  it('GET /api/documents lista el documento con su cantidad de fragmentos', async () => {
    const { body } = await uploadPdf('mi-reglamento.pdf');
    const list = await (await GET()).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: body.id, name: 'mi-reglamento.pdf', status: 'ready', chunks: body.chunks });
  });

  it('si fallan los embeddings, el documento queda en error y no deja fragmentos a medias', async () => {
    vi.mocked(ai.embedChunks).mockRejectedValueOnce(new Error('El servidor de embeddings no responde'));

    const { res } = await uploadPdf();

    expect(res.status).toBe(500);
    const [doc] = await query<{ Status: string; Error: string }>('SELECT Status, Error FROM dbo.Documents');
    expect(doc.Status).toBe('error');
    expect(doc.Error).toContain('no responde');
    const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.Chunks');
    expect(n).toBe(0);
  });

  it('DELETE borra el documento y sus fragmentos en cascada', async () => {
    const { body } = await uploadPdf();
    const params = { params: Promise.resolve({ id: body.id }) };

    expect((await DELETE(new Request('http://app.test'), params)).status).toBe(204);
    const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.Chunks');
    expect(n).toBe(0);

    expect((await DELETE(new Request('http://app.test'), params)).status).toBe(404);
  });
});

describe('búsqueda con VECTOR_DISTANCE', () => {
  it('devuelve primero el fragmento más parecido, con similitud ~1 para el mismo texto', async () => {
    await uploadPdf();
    const [target] = await query<{ Id: number; Content: string }>(
      "SELECT TOP 1 Id, Content FROM dbo.Chunks WHERE Content LIKE N'%15 días hábiles%'",
    );

    const { chunks, nearest, embedding } = await searchChunks(target.Content);

    expect(embedding).toHaveLength(1024);
    expect(nearest[0].id).toBe(target.Id);
    expect(nearest[0].similarity).toBeCloseTo(1, 4);
    expect(nearest[0].page).toBe(2);
    // Ordenados de mayor a menor similitud
    for (let i = 1; i < nearest.length; i++)
      expect(nearest[i].similarity).toBeLessThanOrEqual(nearest[i - 1].similarity);
    // chunks = nearest filtrado por el umbral mínimo
    expect(chunks.every((c) => c.similarity >= 0.25)).toBe(true);
  });

  it('respeta k', async () => {
    await uploadPdf();
    const { nearest } = await searchChunks('vacaciones', { k: 2 });
    expect(nearest).toHaveLength(2);
  });

  it('filtra por documentos seleccionados', async () => {
    const { body: a } = await uploadPdf('a.pdf');
    const { body: b } = await uploadPdf('b.pdf');

    const { nearest } = await searchChunks('vacaciones', { documentIds: [b.id], k: 20 });

    expect(nearest.length).toBeGreaterThan(0);
    expect(nearest.every((c) => c.documentId.toLowerCase() === b.id.toLowerCase())).toBe(true);
    expect(nearest.some((c) => c.documentId.toLowerCase() === a.id.toLowerCase())).toBe(false);
  });

  it('ignora documentos que no están listos', async () => {
    const { body } = await uploadPdf();
    await (await getPool()).request().query(`UPDATE dbo.Documents SET Status = 'processing' WHERE Id = '${body.id}'`);
    const { nearest } = await searchChunks('vacaciones');
    expect(nearest).toEqual([]);
  });
});
