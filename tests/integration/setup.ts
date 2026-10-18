// Se ejecuta en cada archivo de test, ANTES de importar el código de la app:
// apunta lib/db.ts a la base de pruebas.
// @ts-expect-error: script de Node en JavaScript, sin tipos
import { loadTestEnv } from '../../scripts/test-db.mjs';

const env = loadTestEnv();
process.env.DB_SERVER = env.server;
process.env.DB_PORT = env.port ? String(env.port) : '';
process.env.DB_INSTANCE = env.instance ?? '';
process.env.DB_NAME = env.database;
process.env.DB_USER = env.user;
process.env.DB_PASSWORD = env.password;
process.env.DB_TRUST_CERT = 'true';
