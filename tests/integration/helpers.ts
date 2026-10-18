import { createHash } from 'node:crypto';
import { getPool } from '@/lib/db';

/**
 * Embedding determinista de 1024 dimensiones a partir del texto (sin modelo real).
 * Mismo texto → mismo vector, así la similitud coseno entre un texto y sí mismo es 1.
 */
export function fakeEmbedding(text: string): number[] {
  const v: number[] = [];
  let seed = createHash('sha256').update(text).digest();
  while (v.length < 1024) {
    for (const byte of seed) v.push(byte / 255 - 0.5);
    seed = createHash('sha256').update(seed).digest();
  }
  const values = v.slice(0, 1024);
  const norm = Math.hypot(...values);
  return values.map((x) => x / norm);
}

export async function resetTables() {
  const pool = await getPool();
  await pool.request().batch('DELETE FROM dbo.Queries; DELETE FROM dbo.Documents;');
}

export async function query<T>(text: string) {
  const pool = await getPool();
  return (await pool.request().query<T>(text)).recordset;
}
