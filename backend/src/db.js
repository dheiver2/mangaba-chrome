import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL não definida");
  return new pg.Pool({ connectionString, max: 10 });
}

/** Cria as tabelas se ainda não existem (schema.sql é idempotente). */
export async function migrate(pool) {
  const sql = readFileSync(join(here, "..", "schema.sql"), "utf8");
  await pool.query(sql);
}
