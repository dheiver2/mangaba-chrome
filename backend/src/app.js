// API HTTP da extensão Mangaba AI: contas (e-mail + senha) e sincronização por usuário.
// Sem framework: só node:http, para o serviço ficar pequeno e fácil de auditar.
import http from "node:http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const KINDS = ["settings", "chat", "agent", "memory"];
const MAX_BODY = 2 * 1024 * 1024; // 2 MB por requisição
const MAX_PAYLOAD = 1.5 * 1024 * 1024;
const TOKEN_TTL = "30d";
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_TRIES = 20;

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
      if (size > MAX_BODY) { reject(new HttpError(413, "requisição grande demais")); req.destroy(); return; }
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

export function createHandler({ pool, jwtSecret }) {
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
    if (rows[0].n >= AUTH_MAX_TRIES) throw new HttpError(429, "muitas tentativas; aguarde alguns minutos");
    await pool.query("insert into auth_tentativas (ip) values ($1)", [ip]);
  }


  function userFromAuth(req) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) throw new HttpError(401, "faça login");
    try {
      const claims = jwt.verify(token, jwtSecret);
      return { id: claims.sub, email: claims.email };
    } catch {
      throw new HttpError(401, "sessão inválida ou expirada; faça login de novo");
    }
  }

  const issue = (user) => jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: TOKEN_TTL });
  const publicUser = (row) => ({ id: row.id, email: row.email, name: row.name });

  async function signup(body, ip) {
    await limitAuth(ip);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 80);
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "e-mail inválido");
    if (password.length < 8 || password.length > 200) throw new HttpError(400, "a senha precisa ter de 8 a 200 caracteres");
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await pool.query(
        "insert into users (email, name, password_hash) values ($1, $2, $3) returning id, email, name",
        [email, name, hash],
      );
      return { token: issue(rows[0]), user: publicUser(rows[0]) };
    } catch (e) {
      if (e.code === "23505") throw new HttpError(409, "já existe uma conta com este e-mail");
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
    if (!row || !valid) throw new HttpError(401, "e-mail ou senha incorretos");
    return { token: issue(row), user: publicUser(row) };
  }

  async function getSync(user, kind) {
    const { rows } = await pool.query("select payload, updated_at from user_data where user_id = $1 and kind = $2", [user.id, kind]);
    if (!rows[0]) return { payload: null, updated_at: null };
    return { payload: rows[0].payload, updated_at: rows[0].updated_at };
  }

  async function putSync(user, kind, body) {
    if (body.payload === undefined) throw new HttpError(400, "falta o campo payload");
    const json = JSON.stringify(body.payload);
    if (json.length > MAX_PAYLOAD) throw new HttpError(413, "dados grandes demais para sincronizar");
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
    if (req.method === "DELETE" && path === "/auth/me") {
      // Exclusão definitiva: confirma com a senha e apaga a conta com todos os dados (cascade).
      await limitAuth(ip);
      const u = userFromAuth(req);
      const corpo = JSON.parse((await readBody(req)) || "{}");
      const { rows } = await pool.query("select password_hash from users where id = $1", [u.id]);
      if (!rows[0] || !(await bcrypt.compare(String(corpo.password || ""), rows[0].password_hash))) {
        throw new HttpError(401, "senha incorreta");
      }
      await pool.query("delete from users where id = $1", [u.id]);
      return send(res, origin, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/auth/me") {
      const u = userFromAuth(req);
      const { rows } = await pool.query("select id, email, name from users where id = $1", [u.id]);
      if (!rows[0]) throw new HttpError(401, "conta não existe mais");
      return send(res, origin, 200, { user: publicUser(rows[0]) });
    }

    const m = path.match(/^\/sync\/([a-z]+)$/);
    if (m) {
      if (!KINDS.includes(m[1])) throw new HttpError(404, "tipo de dado desconhecido");
      const user = userFromAuth(req);
      if (req.method === "GET") return send(res, origin, 200, await getSync(user, m[1]));
      if (req.method === "PUT") return send(res, origin, 200, await putSync(user, m[1], JSON.parse(await readBody(req) || "{}")));
    }

    if (req.method === "GET" && path === "/health") return send(res, origin, 200, { ok: true });
    throw new HttpError(404, "rota não encontrada");
  }

  return async (req, res) => {
    const origin = req.headers.origin || "";
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(origin)); return res.end(); }
      const url = new URL(req.url, "http://localhost");
      await route(req, res, url, origin);
    } catch (e) {
      if (e instanceof HttpError) return send(res, origin, e.status, { error: e.message });
      if (e instanceof SyntaxError) return send(res, origin, 400, { error: "JSON inválido" });
      console.error("erro interno:", e);
      return send(res, origin, 500, { error: "erro interno" });
    }
  };
}

export function createApp(options) {
  return http.createServer(createHandler(options));
}
