import pg from "pg";
import { Pool as WsPool, neonConfig } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Desde 10/11/2026 o banco é o Postgres próprio na PoC Golden, por WebSocket em db.mangaba.ia.br
// (DB_URL + DB_WS_PROXY). Sem DB_WS_PROXY segue o pg por TCP (testes locais e o Neon antigo).
export function createPool(connectionString = process.env.DB_URL || process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL not set");
  if (process.env.DB_WS_PROXY) {
    neonConfig.wsProxy = process.env.DB_WS_PROXY;
    neonConfig.useSecureWebSocket = true;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    const pool = new WsPool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    pool.on("error", () => {}); // conexão ociosa que caiu: o Pool descarta e abre outra
    return pool;
  }
  return new pg.Pool({ connectionString, max: 10 });
}

/** Cria as tabelas se ainda não existem (schema.sql é idempotente). */
export async function migrate(pool) {
  const sql = readFileSync(join(here, "..", "schema.sql"), "utf8");
  await pool.query(sql);
}
