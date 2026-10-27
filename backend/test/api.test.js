// Testes de integração contra o Postgres real (DATABASE_URL). Rodam com: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createPool, migrate } from "../src/db.js";

const pool = createPool();
const server = createApp({ pool, jwtSecret: "teste-segredo-com-mais-de-32-caracteres-ok" });
let base;
const unique = () => `u${Date.now()}${Math.random().toString(36).slice(2, 7)}@exemplo.com`;

// IP aleatório por chamada: o limite de tentativas agora persiste no banco entre execuções.
const ipAleatorio = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function call(method, path, { body, token, origin, ip } = {}) {
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip || ipAleatorio() };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

before(async () => {
  await migrate(pool);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

test("cadastro cria conta e devolve token", async () => {
  const email = unique();
  const r = await call("POST", "/auth/signup", { body: { name: "Ana", email, password: "senha-forte-123" } });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.email, email);
  assert.ok(r.json.token);
});

test("e-mail duplicado retorna 409", async () => {
  const email = unique();
  await call("POST", "/auth/signup", { body: { email, password: "senha-forte-123" } });
  const r = await call("POST", "/auth/signup", { body: { email, password: "outra-senha-456" } });
  assert.equal(r.status, 409);
});

test("senha curta e e-mail inválido são recusados", async () => {
  assert.equal((await call("POST", "/auth/signup", { body: { email: unique(), password: "curta" } })).status, 400);
  assert.equal((await call("POST", "/auth/signup", { body: { email: "nao-e-email", password: "senha-forte-123" } })).status, 400);
});

test("login aceita a senha certa e recusa a errada (mesma mensagem)", async () => {
  const email = unique();
  await call("POST", "/auth/signup", { body: { email, password: "senha-forte-123" } });
  const ok = await call("POST", "/auth/login", { body: { email, password: "senha-forte-123" } });
  assert.equal(ok.status, 200);
  const bad = await call("POST", "/auth/login", { body: { email, password: "errada-000000" } });
  const ghost = await call("POST", "/auth/login", { body: { email: unique(), password: "errada-000000" } });
  assert.equal(bad.status, 401);
  assert.equal(ghost.status, 401);
  assert.equal(bad.json.error, ghost.json.error);
});

test("/auth/me exige token válido", async () => {
  const email = unique();
  const s = await call("POST", "/auth/signup", { body: { email, password: "senha-forte-123" } });
  const me = await call("GET", "/auth/me", { token: s.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, email);
  assert.equal((await call("GET", "/auth/me")).status, 401);
  assert.equal((await call("GET", "/auth/me", { token: "lixo" })).status, 401);
});

test("sync: cada usuário lê e grava só os próprios dados", async () => {
  const a = await call("POST", "/auth/signup", { body: { email: unique(), password: "senha-forte-123" } });
  const b = await call("POST", "/auth/signup", { body: { email: unique(), password: "senha-forte-123" } });
  const vazio = await call("GET", "/sync/settings", { token: a.json.token });
  assert.equal(vazio.status, 200);
  assert.equal(vazio.json.payload, null);

  const put = await call("PUT", "/sync/settings", { token: a.json.token, body: { payload: { model: "mangaba-titan", temperature: 0 } } });
  assert.equal(put.status, 200);
  assert.ok(put.json.updated_at);

  const lido = await call("GET", "/sync/settings", { token: a.json.token });
  assert.deepEqual(lido.json.payload, { model: "mangaba-titan", temperature: 0 });

  const outro = await call("GET", "/sync/settings", { token: b.json.token });
  assert.equal(outro.json.payload, null);
});

test("sync: tipo desconhecido retorna 404 e sem token retorna 401", async () => {
  const s = await call("POST", "/auth/signup", { body: { email: unique(), password: "senha-forte-123" } });
  assert.equal((await call("GET", "/sync/senhas", { token: s.json.token })).status, 404);
  assert.equal((await call("GET", "/sync/settings")).status, 401);
});

test("sync: payload grande demais é recusado", async () => {
  const s = await call("POST", "/auth/signup", { body: { email: unique(), password: "senha-forte-123" } });
  const grande = "x".repeat(1.6 * 1024 * 1024);
  const r = await call("PUT", "/sync/chat", { token: s.json.token, body: { payload: grande } });
  assert.equal(r.status, 413);
});

test("CORS libera a extensão e não libera origens quaisquer", async () => {
  const ext = await call("GET", "/health", { origin: "chrome-extension://abcdefghijklmnop" });
  assert.equal(ext.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop");
  const outra = await call("GET", "/health", { origin: "https://site-qualquer.com" });
  assert.equal(outra.headers.get("access-control-allow-origin"), null);
});

test("exclusão de conta: exige a senha e apaga a conta e os dados", async () => {
  const email = unique();
  const s = await call("POST", "/auth/signup", { body: { email, password: "senha-forte-123" } });
  await call("PUT", "/sync/memory", { token: s.json.token, body: { payload: [{ key: "x", value: "y" }] } });
  const semSenha = await call("DELETE", "/auth/me", { token: s.json.token, body: { password: "errada-000000" } });
  assert.equal(semSenha.status, 401);
  const ok = await call("DELETE", "/auth/me", { token: s.json.token, body: { password: "senha-forte-123" } });
  assert.equal(ok.status, 200);
  assert.equal((await call("POST", "/auth/login", { body: { email, password: "senha-forte-123" } })).status, 401);
  assert.equal((await call("GET", "/auth/me", { token: s.json.token })).status, 401);
  const { rows } = await pool.query("select count(*)::int as n from user_data ud join users u on u.id = ud.user_id where u.email = $1", [email]);
  assert.equal(rows[0].n, 0);
});

test("limite de tentativas persiste e bloqueia a 21ª tentativa do mesmo IP", async () => {
  const ip = `192.0.2.${Math.floor(Math.random() * 250)}`;
  await pool.query("delete from auth_tentativas where ip = $1", [ip]);
  for (let i = 0; i < 20; i++) {
    const r = await call("POST", "/auth/login", { ip, body: { email: unique(), password: "x-errada-123" } });
    assert.equal(r.status, 401);
  }
  const bloqueado = await call("POST", "/auth/login", { ip, body: { email: unique(), password: "x-errada-123" } });
  assert.equal(bloqueado.status, 429);
  const outroIp = await call("POST", "/auth/login", { body: { email: unique(), password: "x-errada-123" } });
  assert.equal(outroIp.status, 401);
  await pool.query("delete from auth_tentativas where ip = $1", [ip]);
});

