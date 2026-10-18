import { describe, expect, it } from 'vitest';
import { chunkPages } from '@/lib/chunking';

const sentence = (i: number) => `Esta es la oración número ${i} del documento de prueba con algo de contenido.`;
const longPage = (n: number) => Array.from({ length: n }, (_, i) => sentence(i)).join(' ');

describe('chunkPages', () => {
  it('devuelve un solo fragmento para una página corta', () => {
    const chunks = chunkPages(['La jornada ordinaria es de 42 horas semanales, de lunes a viernes.']);
    expect(chunks).toEqual([
      { content: 'La jornada ordinaria es de 42 horas semanales, de lunes a viernes.', page: 1, index: 0 },
    ]);
  });

  it('omite páginas vacías pero conserva el número de página real', () => {
    const chunks = chunkPages([
      '',
      '   \n  ',
      'Contenido suficiente para formar un fragmento válido en la tercera página.',
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page).toBe(3);
  });

  it('numera los fragmentos de forma correlativa entre páginas', () => {
    const chunks = chunkPages([longPage(30), longPage(30)]);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
  });

  it('respeta el tamaño máximo (pieza + solapamiento + separador)', () => {
    const size = 1000;
    const chunks = chunkPages([longPage(80)], { size, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(size + 1);
  });

  it('cada fragmento empieza con el final del anterior (solapamiento)', () => {
    const chunks = chunkPages([longPage(80)], { size: 600, overlap: 100 });
    for (let i = 1; i < chunks.length; i++) {
      const previousEnd = chunks[i - 1].content.slice(-40);
      expect(chunks[i].content.slice(0, 101)).toContain(previousEnd.trim().slice(-20));
    }
  });

  it('no pierde contenido: todas las oraciones aparecen en algún fragmento', () => {
    const chunks = chunkPages([longPage(60)], { size: 500, overlap: 80 });
    const all = chunks.map((c) => c.content).join(' ');
    for (let i = 0; i < 60; i++) expect(all).toContain(`número ${i} del documento`);
  });

  it('corta palabras gigantes sin separadores (último recurso)', () => {
    const chunks = chunkPages(['x'.repeat(2500)], { size: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(1001);
  });

  it('descarta fragmentos demasiado cortos', () => {
    expect(chunkPages(['Página 3'], { minLength: 40 })).toEqual([]);
  });

  it('normaliza espacios y saltos de línea repetidos', () => {
    const [chunk] = chunkPages(['Primera   línea\t\tcon espacios.\n\n\n\nSegunda línea del mismo párrafo largo.']);
    expect(chunk.content).toBe('Primera línea con espacios.\n\nSegunda línea del mismo párrafo largo.');
  });

  it('une palabras cortadas con guion al final de línea', () => {
    const [chunk] = chunkPages(['El reglamento regula la jornada y la infor-\nmación interna de la empresa.']);
    expect(chunk.content).toContain('información');
  });

  it('une palabras cortadas con guion aunque tengan tildes o ñ', () => {
    const [chunk] = chunkPages([
      'Las garantí-\nas del contrato y la compa-\nñía se describen en esta sección del reglamento.',
    ]);
    expect(chunk.content).toContain('garantías');
    expect(chunk.content).toContain('compañía');
  });

  it('no une guiones que no están al final de una línea', () => {
    const [chunk] = chunkPages(['El horario es 08:00-10:00 y aplica a personal técnico-administrativo de bodega.']);
    expect(chunk.content).toContain('08:00-10:00');
    expect(chunk.content).toContain('técnico-administrativo');
  });
});
