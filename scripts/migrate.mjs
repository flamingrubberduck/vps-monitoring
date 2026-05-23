/**
 * Startup migration script — runs before `node server.js`.
 *
 * Applies scripts/schema.sql which is fully idempotent (CREATE TABLE IF NOT EXISTS,
 * CREATE INDEX IF NOT EXISTS, if_not_exists => TRUE on hypertable calls).
 * Safe to run on every container boot.
 */

import { readFileSync }  from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

console.log('[migrate] Applying schema…');
const sql = postgres(DATABASE_URL, { max: 1 });
try {
  await sql.unsafe(schemaSQL);
  console.log('[migrate] Schema applied successfully.');
} catch (e) {
  console.error('[migrate] Migration failed:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
