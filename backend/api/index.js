// Função serverless da Vercel: encaminha todas as rotas para a API (src/app.js).
import { createHandler } from "../src/app.js";
import { createPool, migrate } from "../src/db.js";

const pool = createPool();
const handler = createHandler({ pool, jwtSecret: process.env.JWT_SECRET || "" });
let ready = null;

export default async function main(req, res) {
  // O schema é idempotente: aplicar no primeiro pedido de cada instância garante as tabelas.
  ready ||= migrate(pool).catch((e) => { ready = null; throw e; });
  try {
    await ready;
  } catch (e) {
    console.error("falha ao preparar o banco:", e);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "banco indisponível" }));
  }
  return handler(req, res);
}
