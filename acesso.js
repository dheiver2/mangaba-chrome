// ---- Acesso: conta obrigatória + chave do Mangaba Router ----
// O painel só libera o chat com sessão válida e chave validada no Router.
// A chave fica em chrome.storage.local, separada por usuário: não sincroniza pela conta
// Google do Chrome e não passa de um usuário para outro no mesmo navegador.

const ROUTER_URL = "https://mangabarouter.store";
const ROUTER_CHAVES_URL = ROUTER_URL + "/console"; // onde o usuário cria a chave

const chaveStorageKey = (userId) => "mangaba_chave_" + userId;

// Qual tela mostrar: "entrada" (login/cadastro), "chave" ou "pronto" (chat).
function estadoAcesso(account, chave) {
  if (!account?.token || !account.user?.id) return "entrada";
  if (!chave) return "chave";
  return "pronto";
}

async function chaveLoad(userId) {
  if (!userId) return "";
  const k = chaveStorageKey(userId);
  const r = await chrome.storage.local.get({ [k]: "" });
  return r[k] || "";
}

async function chaveSave(userId, chave) {
  await chrome.storage.local.set({ [chaveStorageKey(userId)]: chave });
}

async function chaveRemove(userId) {
  if (userId) await chrome.storage.local.remove(chaveStorageKey(userId));
}

// Até a 2.16.0 a chave ficava em chrome.storage.sync, sem dono. Passa para o primeiro
// usuário que entrar e some do sync.
async function chaveMigrar(userId) {
  if (!userId || !chrome.storage?.sync) return "";
  const antiga = await new Promise((ok) => chrome.storage.sync.get({ key: "" }, (r) => ok(r?.key || "")));
  if (!antiga) return "";
  if (!(await chaveLoad(userId))) await chaveSave(userId, antiga);
  await new Promise((ok) => chrome.storage.sync.remove("key", ok));
  return antiga;
}

// Confere a chave no Router. {ok:true} | {ok:false, motivo:"invalida"|"rede", erro}
async function validarChaveRouter(chave) {
  chave = String(chave || "").trim();
  if (!chave) return { ok: false, motivo: "invalida", erro: "Cole a sua chave do Mangaba Router." };
  let res;
  try {
    res = await fetch(ROUTER_URL + "/v1/models", { headers: { Authorization: "Bearer " + chave } });
  } catch {
    return { ok: false, motivo: "rede", erro: "Não consegui falar com o Mangaba Router. Confira a internet e tente de novo." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, motivo: "invalida", erro: "Chave inválida ou revogada. Confira no console do Router." };
  return { ok: false, motivo: "rede", erro: "O Mangaba Router respondeu " + res.status + ". Tente de novo em instantes." };
}

// Confere a sessão salva. "ok" | "expirada" | "offline" (sem rede: mantém a sessão local).
async function confirmarSessao(account) {
  if (!account?.token) return "expirada";
  try {
    const res = await fetch(account.apiUrl.replace(/\/+$/, "") + "/auth/me", { headers: { Authorization: "Bearer " + account.token } });
    if (res.status === 401) return "expirada";
    return res.ok ? "ok" : "offline";
  } catch {
    return "offline";
  }
}
