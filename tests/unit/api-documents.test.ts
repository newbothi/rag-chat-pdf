import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pdf', () => ({ extractPdfPages: vi.fn() }));
vi.mock('@/lib/ai', () => ({ embedChunks: vi.fn() }));
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...real,
    getPool: vi.fn(() => Promise.reject(new Error('La base de datos no debería usarse en este test'))),
  };
});

import { DELETE } from '@/app/api/documents/[id]/route';
import { POST } from '@/app/api/documents/route';
import * as db from '@/lib/db';
import * as pdf from '@/lib/pdf';

const upload = (file?: File) => {
  const form = new FormData();
  if (file) form.append('file', file);
  return POST(new Request('http://app.test/api/documents', { method: 'POST', body: form }));
};

const pdfFile = (bytes = 100, name = 'doc.pdf') => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/documents (validaciones)', () => {
  it('400 si no viene el archivo', async () => {
    expect((await upload()).status).toBe(400);
  });

  it('415 si no es PDF', async () => {
    const res = await upload(new File(['hola'], 'notas.txt', { type: 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('413 si supera el tamaño máximo (20 MB por defecto)', async () => {
    const res = await upload(pdfFile(20 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(pdf.extractPdfPages).not.toHaveBeenCalled();
  });

  it('422 si el PDF está dañado o protegido', async () => {
    vi.mocked(pdf.extractPdfPages).mockRejectedValue(new Error('Invalid PDF structure'));
    const res = await upload(pdfFile());
    expect(res.status).toBe(422);
  });

  it('422 si el PDF no tiene texto (escaneado) y no toca la base de datos', async () => {
    vi.mocked(pdf.extractPdfPages).mockResolvedValue({ totalPages: 2, pages: ['', '   '] });
    const res = await upload(pdfFile());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/OCR/);
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it('acepta un PDF identificado solo por la extensión', async () => {
    vi.mocked(pdf.extractPdfPages).mockResolvedValue({ totalPages: 1, pages: [''] });
    const res = await upload(new File([new Uint8Array(10)], 'REPORTE.PDF', { type: '' }));
    expect(res.status).toBe(422); // pasó la validación de tipo y llegó a la extracción
  });
});

describe('DELETE /api/documents/:id', () => {
  it.each(['123', "x' OR 1=1 --", 'not-a-guid-at-all-but-36-characters!'])('400 con id inválido: %s', async (id) => {
    const res = await DELETE(new Request('http://app.test'), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    expect(db.getPool).not.toHaveBeenCalled();
  });
});
