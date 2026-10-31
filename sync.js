// ---- Conta e sincronização com o backend (pasta backend/) ----
// Login por e-mail + senha. Quando logado, o histórico, a memória e as configurações
// (sem a API key) são copiados para o servidor e puxados de volta em outro navegador.
// Sem conta, tudo continua só local, como antes.

const ACCOUNT_KEY = "mangaba_account"; // {apiUrl, token, user} em chrome.storage.local
const ACCOUNT_DEFAULT_URL = "https://mangaba-chrome-backend.vercel.app";
const SYNC_RECORD_LIMIT = 100;

async function accountLoad() {
  try {
    const r = await chrome.storage.local.get({ [ACCOUNT_KEY]: null });
    return r[ACCOUNT_KEY];
  } catch { return null; }
}

async function accountSave(account) {
  await chrome.storage.local.set({ [ACCOUNT_KEY]: account });
}

async function accountRequest(apiUrl, path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  let res;
  try {
    res = await fetch(apiUrl.replace(/\/+$/, "") + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("não foi possível conectar ao servidor da conta (" + apiUrl + ")");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "erro " + res.status);
  return data;
}

async function accountSignIn(apiUrl, email, password) {
  const data = await accountRequest(apiUrl, "/auth/login", { method: "POST", body: { email, password } });
  const account = { apiUrl, token: data.token, user: data.user };
  await accountSave(account);
  return account;
}

async function accountSignUp(apiUrl, name, email, password) {
  const data = await accountRequest(apiUrl, "/auth/signup", { method: "POST", body: { name, email, password } });
  const account = { apiUrl, token: data.token, user: data.user };
  await accountSave(account);
  return account;
}

// Exclui a conta no servidor (confirmada pela senha) e tudo o que ela sincronizou.
async function accountDelete(account, password) {
  await accountRequest(account.apiUrl, "/auth/me", { method: "DELETE", body: { password }, token: account.token });
  await accountSignOut();
}

async function accountSignOut() {
  await chrome.storage.local.remove(ACCOUNT_KEY);
}

// Configurações sem a API key: a chave fica só neste navegador.
function syncableSettings() {
  const { key, ...rest } = cfg;
  return rest;
}

// Envia o estado local para a conta. Com recordsOnly, pula as configurações.
async function syncPush(account, { recordsOnly = false } = {}) {
  if (!account) return;
  const req = (kind, payload) => accountRequest(account.apiUrl, "/sync/" + kind, { method: "PUT", body: { payload }, token: account.token });
  if (!recordsOnly) await req("settings", syncableSettings());
  const byRecent = (a, b) => (a.ts || 0) - (b.ts || 0);
  const chat = (await listStore("chat_history")).sort(byRecent).slice(-SYNC_RECORD_LIMIT);
  const agent = (await listStore("agent_history")).sort(byRecent).slice(-SYNC_RECORD_LIMIT);
  const memory = await listStore("memory");
  await req("chat", chat);
  await req("agent", agent);
  await req("memory", memory);
}

// Puxa da conta. Registros são mesclados por id/chave (nada local é apagado).
// As configurações do servidor substituem as locais, só no login.
async function syncPull(account, { includeSettings = false } = {}) {
  if (!account) return;
  const get = (kind) => accountRequest(account.apiUrl, "/sync/" + kind, { token: account.token });
  if (includeSettings) {
    const { payload } = await get("settings");
    if (payload) {
      const { key, ...semChave } = payload; // configurações antigas podem ter trazido a chave
      cfg = { ...DEFAULTS, ...semChave, key: cfg.key }; // a chave continua local e por usuário
      salvarCfgSync();
    }
  }
  for (const [kind, store] of [["chat", "chat_history"], ["agent", "agent_history"], ["memory", "memory"]]) {
    const { payload } = await get(kind);
    if (Array.isArray(payload) && payload.length) await putRecords(store, payload);
  }
}
