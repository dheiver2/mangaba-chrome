// Recuperação de senha com um banco de mentira que responde às consultas exatas do app.
// Não precisa de Postgres. Rodar com: node --test test/recuperacao.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { createApp } from "../src/app.js";

const sha = (t) => createHash("sha256").update(t).digest("hex");

function bancoDeMentira() {
  const usuarios = [{ id: "u1", email: "ana@exemplo.com", name: "Ana", password_hash: bcrypt.hashSync("senha-antiga-1", 4) }];
  const resets = [];
  return {
    usuarios, resets,
    async query(sql, p = []) {
      if (sql.startsWith("delete from auth_tentativas") || sql.startsWith("insert into auth_tentativas")) return { rows: [] };
      if (sql.startsWith("select count(*)")) return { rows: [{ n: 0 }] };
      if (sql.startsWith("select id, email from users where email")) return { rows: usuarios.filter((u) => u.email === p[0]).map(({ id, email }) => ({ id, email })) };
      if (sql.startsWith("select id, email, name, password_hash from users where email")) return { rows: usuarios.filter((u) => u.email === p[0]) };
      if (sql.startsWith("insert into password_resets")) {
        resets.push({ hash: p[0], user: p[1], expira: Date.now() + 30 * 60 * 1000, usado: false });
        return { rows: [] };
      }
      if (sql.startsWith("select user_id from password_resets")) {
        const r = resets.find((x) => x.hash === p[0] && !x.usado && x.expira > Date.now());
        return { rows: r ? [{ user_id: r.user }] : [] };
      }
      if (sql.startsWith("update users set password_hash")) {
        usuarios.find((u) => u.id === p[1]).password_hash = p[0];
        return { rows: [] };
      }
      if (sql.startsWith("update password_resets set used_at")) {
        resets.filter((x) => x.user === p[0]).forEach((x) => { x.usado = true; });
        return { rows: [] };
      }
      throw new Error("consulta não prevista no teste: " + sql.slice(0, 60));
    },
  };
}

let server, base, banco, enviados;
before(async () => {
  banco = bancoDeMentira();
  enviados = [];
  const app = createApp({
    pool: banco,
    jwtSecret: "teste-segredo-com-mais-de-32-caracteres-ok",
    enviarEmail: async (m) => { enviados.push(m); },
  });
  server = app.listen(0, "127.0.0.1");
  return new Promise((ok) => server.on("listening", () => { base = `http://127.0.0.1:${server.address().port}`; ok(); }));
});
after(() => server.close());

async function post(caminho, corpo) {
  const r = await fetch(base + caminho, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(corpo) });
  return { status: r.status, dados: await r.json() };
}

test("esqueci responde igual para e-mail existente e inexistente, e só envia para o existente", async () => {
  const a = await post("/auth/esqueci", { email: "ana@exemplo.com" });
  const b = await post("/auth/esqueci", { email: "ninguem@exemplo.com" });
  assert.equal(a.status, 200);
  assert.deepEqual(a.dados, b.dados);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, "ana@exemplo.com");
});

test("o link redefine a senha, entra com a nova e não serve de novo", async () => {
  const link = enviados[0].html.match(/token=([A-Za-z0-9_-]+)/)[1];
  const r1 = await post("/auth/redefinir", { token: link, password: "senha-nova-123" });
  assert.equal(r1.status, 200);
  const entrou = await post("/auth/login", { email: "ana@exemplo.com", password: "senha-nova-123" });
  assert.equal(entrou.status, 200);
  const r2 = await post("/auth/redefinir", { token: link, password: "outra-senha-456" });
  assert.equal(r2.status, 400);
});

test("token inventado e senha curta são recusados", async () => {
  assert.equal((await post("/auth/redefinir", { token: "nao-existe", password: "senha-valida-1" })).status, 400);
  await post("/auth/esqueci", { email: "ana@exemplo.com" });
  const link = enviados[1].html.match(/token=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await post("/auth/redefinir", { token: link, password: "curta" })).status, 400);
});

test("o link expira", async () => {
  await post("/auth/esqueci", { email: "ana@exemplo.com" });
  const link = enviados[2].html.match(/token=([A-Za-z0-9_-]+)/)[1];
  banco.resets.forEach((r) => { if (r.hash === sha(link)) r.expira = Date.now() - 1; });
  assert.equal((await post("/auth/redefinir", { token: link, password: "senha-valida-1" })).status, 400);
});
