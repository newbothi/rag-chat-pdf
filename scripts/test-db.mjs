// Crea (o recrea desde cero) la base de datos de pruebas aplicando los mismos
// scripts SQL que usa la app: db/schema.sql y db/002-analytics.sql.
//
// Uso:  node scripts/test-db.mjs
// Lee TEST_DB_* del entorno o de .env.test.local (ver .env.test.example).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_FILES = ['db/schema.sql', 'db/002-analytics.sql'];

export function loadTestEnv() {
  try {
    process.loadEnvFile(join(root, '.env.test.local'));
  } catch {
    // En CI las variables vienen del entorno
  }
  const env = {
    server: process.env.TEST_DB_SERVER || 'localhost',
    port: process.env.TEST_DB_PORT ? Number(process.env.TEST_DB_PORT) : undefined,
    instance: process.env.TEST_DB_INSTANCE || undefined,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME || 'RagChat_Test',
  };
  if (!env.user || !env.password) {
    throw new Error(
      'Faltan TEST_DB_USER y TEST_DB_PASSWORD. Copia .env.test.example a .env.test.local y complétalo ' +
        '(ver la sección "Calidad" del README).',
    );
  }
  // Protección: nunca recrear una base que no sea de pruebas
  if (!/test/i.test(env.database)) {
    throw new Error(`TEST_DB_NAME debe contener "test" (es "${env.database}"): esta base se borra y se recrea.`);
  }
  return env;
}

/** Divide un script en lotes por las líneas "GO" (como hacen SSMS y sqlcmd). */
function batches(script) {
  return script
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter(Boolean);
}

export async function createTestDatabase({ quiet = false } = {}) {
  const env = loadTestEnv();
  const log = quiet ? () => {} : console.log;

  // Una sola conexión: los USE de un lote deben aplicar a los siguientes
  const pool = new sql.ConnectionPool({
    server: env.server,
    port: env.instance ? undefined : env.port,
    user: env.user,
    password: env.password,
    database: 'master',
    pool: { min: 1, max: 1 },
    options: { instanceName: env.instance, encrypt: true, trustServerCertificate: true },
    connectionTimeout: 30_000,
    requestTimeout: 60_000,
  });

  // SQL Server tarda en aceptar conexiones justo después de arrancar el contenedor
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.connect();
      break;
    } catch (err) {
      if (attempt >= 20) throw err;
      log(`Esperando a SQL Server (${attempt})… ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const db = env.database.replace(/]/g, '');
  log(`Recreando la base de pruebas [${db}]…`);
  await pool.request().batch(`
    IF DB_ID(N'${db}') IS NOT NULL
    BEGIN
      ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${db}];
    END`);

  for (const file of SQL_FILES) {
    const script = readFileSync(join(root, file), 'utf8').replace(/\bRagChat\b/g, db);
    for (const batch of batches(script)) await pool.request().batch(batch);
    log(`  ✓ ${file}`);
  }

  await pool.close();
  log('Base de pruebas lista.');
  return env;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createTestDatabase().catch((err) => {
    console.error(`\n✗ ${err.message}\n`);
    process.exit(1);
  });
}
