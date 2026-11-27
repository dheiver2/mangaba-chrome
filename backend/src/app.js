// API HTTP da extensão Mangaba AI: contas (e-mail + senha) e sincronização por usuário.
// Sem framework: só node:http, para o serviço ficar pequeno e fácil de auditar.
import http from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

const KINDS = ["settings", "chat", "agent", "memory"];
const MAX_BODY = 2 * 1024 * 1024; // 2 MB por requisição
const MAX_PAYLOAD = 1.5 * 1024 * 1024;
const TOKEN_TTL = "30d";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_TRIES = 20;
const RESET_TTL_MS = 30 * 60 * 1000; // link de redefinição vale 30 minutos
const PUBLIC_URL = process.env.PUBLIC_URL || "https://mangaba-chrome-backend.vercel.app";

// Origens permitidas para o navegador: a extensão (chrome-extension://) e o local de dev.
function corsHeaders(origin) {
  const ok = origin && (origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"));
  if (!ok) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, "request too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, origin, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(origin) });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

const sha256 = (texto) => createHash("sha256").update(texto).digest("hex");

// Envio pelo Resend. Só roda com RESEND_API_KEY definida; o remetente vem de RESEND_FROM.
export async function enviarPeloResend({ para, assunto, html }) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) throw new Error("RESEND_API_KEY not set");
  const resposta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Mangaba AI <no-reply@mangaba.ia.br>",
      to: [para], subject: assunto, html,
    }),
  });
  if (!resposta.ok) throw new Error(`Resend responded ${resposta.status}`);
}

const PAGINA_REDEFINIR = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset password · Mangaba AI</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#FBF7F2;color:#1E0D01;margin:0;padding:40px 16px}main{max-width:380px;margin:0 auto;background:#fff;border:1px solid #EADFD6;border-radius:14px;padding:28px}h1{font-size:22px;margin:0 0 12px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d8c9bb;border-radius:8px;font-size:16px;margin:6px 0 14px}button{background:#E94A12;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-weight:600;font-size:15px;width:100%;cursor:pointer}p{margin:12px 0 0;font-size:14px}</style></head>
<body><main><h1>Choose a new password</h1><form id="f"><label>New password (at least 8 characters)<input id="s" type="password" minlength="8" required autocomplete="new-password"></label><button>Save password</button></form><p id="m"></p></main>
<script>const token=new URLSearchParams(location.search).get("token")||"";document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const m=document.getElementById("m");m.textContent="Saving…";const r=await fetch("/auth/redefinir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password:document.getElementById("s").value})});const d=await r.json().catch(()=>({}));m.textContent=r.ok?"Password changed. You can now sign in to the extension with the new password.":(d.error||"Could not save.");};</script></body></html>`;

export function createHandler({ pool, jwtSecret, enviarEmail = enviarPeloResend }) {
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres");

  // Limite de tentativas de login/cadastro guardado no banco: em funções serverless cada
  // instância tem memória própria, e um Map em memória não limitava nada de verdade.
  async function limitAuth(ip) {
    const janela = `${AUTH_WINDOW_MS} milliseconds`;
    await pool.query("delete from auth_tentativas where ts < now() - $1::interval", [janela]);
    const { rows } = await pool.query(
      "select count(*)::int as n from auth_tentativas where ip = $1 and ts >= now() - $2::interval",
      [ip, janela],
    );
    if (rows[0].n >= AUTH_MAX_TRIES) throw new HttpError(429, "too many attempts; wait a few minutes");
    await pool.query("insert into auth_tentativas (ip) values ($1)", [ip]);
  }


  async function pedirRedefinicao(body, ip) {
    await limitAuth(ip);
    const email = String(body.email || "").trim().toLowerCase();
    const resposta = { ok: true, mensagem: "If the email is registered, we sent a link to create a new password." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resposta;
    const { rows } = await pool.query("select id, email from users where email = $1", [email]);
    if (!rows[0]) return resposta; // mesma resposta para e-mail inexistente: não revela contas
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      "insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + $3::interval)",
      [sha256(token), rows[0].id, `${RESET_TTL_MS} milliseconds`],
    );
    const link = `${PUBLIC_URL}/redefinir?token=${token}`;
    try {
      await enviarEmail({
        para: rows[0].email,
        assunto: "Reset your Mangaba AI password",
        html: `<p>Use the link below to create a new password. It is valid for 30 minutes and works once.</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email.</p>`,
      });
    } catch (e) {
      console.error("falha ao enviar o e-mail de redefinição:", e.message);
    }
    return resposta;
  }

  async function redefinirSenha(body) {
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "the password must be 8 to 200 characters");
    if (!token || token.length > 200) throw new HttpError(400, "invalid or expired link");
    const { rows } = await pool.query(
      "select user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now()",
      [sha256(token)],
    );
    if (!rows[0]) throw new HttpError(400, "invalid or expired link");
    const hash = await bcrypt.hash(password, 12);
    await pool.query("update users set password_hash = $1 where id = $2", [hash, rows[0].user_id]);
    await pool.query("update password_resets set used_at = now() where user_id = $1", [rows[0].user_id]);
    return { ok: true };
  }

  function userFromAuth(req) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) throw new HttpError(401, "sign in required");
    try {
      const claims = jwt.verify(token, jwtSecret);
      return { id: claims.sub, email: claims.email };
    } catch {
      throw new HttpError(401, "invalid or expired session; sign in again");
    }
  }

  const issue = (user) => jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: TOKEN_TTL });
  const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name });

  async function signup(body, ip) {
    await limitAuth(ip);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 80);
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "invalid email");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "the password must be 8 to 200 characters");
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query(
        "insert into users (email, name, password_hash) values ($1, $2, $3) returning id, email, name",
        [email, name, hash],
      );
      return { token: issue(rows[0]), user: publicUser(rows[0]) };
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "an account with this email already exists");
      throw e;
    }
  }

  async function login(body, ip) {
    await limitAuth(ip);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const { rows } = await pool.query("select id, email, name, password_hash from users where email = $1", [email]);
    // Mesma mensagem para e-mail inexistente e senha errada, e bcrypt roda nos dois casos.
    const row = rows[0];
    const valid = await bcrypt.compare(password, row ? row.password_hash : "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!row || !valid) throw new HttpError(401, "incorrect email or password");
    return { token: issue(row), user: publicUser(row) };
  }

  async function getSync(user, kind) {
    const { rows } = await pool.query("select payload, updated_at from user_data where user_id = $1 and kind = $2", [user.id, kind]);
    if (!rows[0]) return { payload: null, updated_at: null };
    return { payload: rows[0].payload, updated_at: rows[0].updated_at };
  }

  async function putSync(user, kind, body) {
    if (body.payload === undefined) throw new HttpError(400, "missing payload field");
    const json = JSON.stringify(body.payload);
    if (json.length > MAX_PAYLOAD) throw new HttpError(413, "data too large to sync");
    const { rows } = await pool.query(
      `insert into user_data (user_id, kind, payload, updated_at) values ($1, $2, $3, now())
       on conflict (user_id, kind) do update set payload = excluded.payload, updated_at = now()
       returning updated_at`,
      [user.id, kind, json],
    );
    return { updated_at: rows[0].updated_at };
  }

  async function route(req, res, url, origin) {
    const path = url.pathname;
    // na Vercel a conexão vem do proxy; o IP do cliente é o primeiro do x-forwarded-for
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

    if (req.method === "POST" && path === "/auth/signup") return send(res, origin, 201, await signup(JSON.parse(await readBody(req) || "{}"), ip));
    if (req.method === "POST" && path === "/auth/login") return send(res, origin, 200, await login(JSON.parse(await readBody(req) || "{}"), ip));
    if (req.method === "POST" && path === "/auth/esqueci") return send(res, origin, 200, await pedirRedefinicao(JSON.parse(await readBody(req) || "{}"), ip));
    if (req.method === "POST" && path === "/auth/redefinir") return send(res, origin, 200, await redefinirSenha(JSON.parse(await readBody(req) || "{}")));
    if (req.method === "GET" && path === "/redefinir") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(PAGINA_REDEFINIR);
    }
    if (req.method === "DELETE" && path === "/auth/me") {
      // Exclusão definitiva: confirma com a senha e apaga a conta com todos os dados (cascade).
      await limitAuth(ip);
      const u = userFromAuth(req);
      const corpo = JSON.parse((await readBody(req)) || "{}");
      const { rows } = await pool.query("select password_hash from users where id = $1", [u.id]);
      if (!rows[0] || !(await bcrypt.compare(String(corpo.password || ""), rows[0].password_hash))) {
        throw new HttpError(401, "incorrect password");
      }
      await pool.query("delete from users where id = $1", [u.id]);
      return send(res, origin, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/auth/me") {
      const u = userFromAuth(req);
      const { rows } = await pool.query("select id, email, name from users where id = $1", [u.id]);
      if (!rows[0]) throw new HttpError(401, "account no longer exists");
      return send(res, origin, 200, { user: publicUser(rows[0]) });
    }

    const m = path.match(/^\/sync\/([a-z]+)$/);
    if (m) {
      if (!KINDS.includes(m[1])) throw new HttpError(404, "unknown data type");
      const user = userFromAuth(req);
      if (req.method === "GET") return send(res, origin, 200, await getSync(user, m[1]));
      if (req.method === "PUT") return send(res, origin, 200, await putSync(user, m[1], JSON.parse(await readBody(req) || "{}")));
    }

    if (req.method === "GET" && path === "/health") return send(res, origin, 200, { ok: true });
    throw new HttpError(404, "route not found");
  }

  return async (req, res) => {
    const origin = req.headers.origin || "";
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(origin)); return res.end(); }
      const url = new URL(req.url, "http://localhost");
      await route(req, res, url, origin);
    } catch (e) {
      if (e instanceof HttpError) return send(res, origin, e.status, { error: e.message });
      if (e instanceof SyntaxError) return send(res, origin, 400, { error: "invalid JSON" });
      console.error("erro interno:", e);
      return send(res, origin, 500, { error: "internal error" });
    }
  };
}

export function createApp(options) {
  return http.createServer(createHandler(options));
}
