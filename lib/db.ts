import sql from 'mssql';

export { sql };

/** Debe coincidir con VECTOR(1024) en db/schema.sql */
export const EMBEDDING_DIMENSIONS = 1024;

const config: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  database: process.env.DB_NAME ?? 'RagChat',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  pool: { max: 10, idleTimeoutMillis: 30_000 },
  options: {
    // Para instancias con nombre (ej. SQLEXPRESS). Requiere el servicio SQL Server Browser activo.
    instanceName: process.env.DB_INSTANCE || undefined,
    encrypt: process.env.DB_ENCRYPT !== 'false',
    // En local el certificado es autofirmado; en producción ponlo en false
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  },
};

// Reutiliza el pool entre recargas en desarrollo (hot reload de Next)
const globalForDb = globalThis as unknown as { pool?: Promise<sql.ConnectionPool> };

export function getPool() {
  if (!globalForDb.pool) {
    globalForDb.pool = new sql.ConnectionPool(config).connect().catch((err) => {
      globalForDb.pool = undefined; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return globalForDb.pool;
}

/** Cierra el pool y limpia la caché (tests y apagado ordenado). */
export async function closePool() {
  const pending = globalForDb.pool;
  globalForDb.pool = undefined;
  if (pending) await (await pending).close();
}

/** Convierte un embedding al formato JSON que SQL Server convierte a VECTOR: '[0.1,0.2,...]' */
export const toVectorJson = (v: number[]) => JSON.stringify(v);
