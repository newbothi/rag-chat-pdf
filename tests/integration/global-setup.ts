// Se ejecuta una vez antes de todos los tests de integración: recrea la base de pruebas.
// @ts-expect-error: script de Node en JavaScript, sin tipos
import { createTestDatabase } from '../../scripts/test-db.mjs';

export default async function setup() {
  await createTestDatabase();
}
