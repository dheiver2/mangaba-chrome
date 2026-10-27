const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");
const btnSend = $("btnSend");
const agentHistory = []; // modo agente {task, resposta}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// windowId da janela ONDE ESTA side panel está aberta — enviado em toda mensagem pro
// service worker. Sem isso, chrome.tabs.query({currentWindow:true}) rodando no service
// worker resolve pra última janela com foco do SO, não necessariamente a desta side panel:
// com várias janelas do Chrome abertas, a extensão lia a aba ativa da janela ERRADA
// silenciosamente (sem erro — só "não reconhecia" a página que o usuário via).
let myWindowId = null;
chrome.windows.getCurrent().then((w) => { myWindowId = w.id; }).catch(() => {});

const DEFAULTS = {
  hermesUrl: "https://hermes.mangaba.ia.br", // agente: Hermes; o modelo que raciocina é o Mangaba Router
  key: "",
  dados: "",
};
let cfg = { ...DEFAULTS };

if (chrome.storage?.sync) chrome.storage.sync.get(DEFAULTS, (saved) => {
  cfg = saved;
  $("cfgKey").value = cfg.key;
  $("cfgDados").value = cfg.dados || "";
});

// Carregar histórico ao iniciar
(async () => {
  try {
    const msgs = await getChatHistory();
    for (const msg of msgs) {
      const div = addMsg(msg.role);
      if (msg.role === "assistant") setAssistant(div, msg.content);
      else div.textContent = msg.content;
    }
  } catch { /* histórico vazio no primeiro uso */ }
})();

$("btnSettings").onclick = () => $("settings").classList.toggle("hidden");
$("btnClearHistory").onclick = async () => {
  if (confirm("Tem certeza que quer limpar TODO o histórico? Esta ação não pode ser desfeita.")) {
    await clearHistory();
    chat.innerHTML = '';
    addMsg("assistant").textContent = "Histórico limpo. Comece uma nova conversa.";
  }
};

// Teclado shortcuts
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      input.focus();
    } else if (e.key === "Enter" && input.value.trim()) {
      e.preventDefault();
      btnSend.click();
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      if (confirm("Limpar histórico?")) {
        $("btnClearHistory").click();
      }
    }
  } else if (e.key === "Escape" && agentRun && agentRun.cancel) {
    e.preventDefault();
    agentRun.cancel();
  }
});
$("btnSave").onclick = () => {
  cfg = { ...cfg, key: $("cfgKey").value.trim(), dados: $("cfgDados").value.trim() };
  if (chrome.storage?.sync) chrome.storage.sync.set(cfg);
  $("settings").classList.add("hidden");
  if (account) syncPush(account).catch(() => {});

};

// ---------- renderização Markdown (sem dependências, HTML sempre escapado) ----------
// escapa também aspas: senão uma URL com " quebra o atributo href e injeta handlers (XSS)
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const inline = (s) => s
  .replace(/`([^`\n]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1<i>$2</i>")
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

function md(src) {
  const blocks = [];
  // blocos de código
  src = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\x00${blocks.length - 1}\x00`;
  });
  // TABELAS (GitHub markdown): cabeçalho + linha separadora + corpo
  src = src.replace(/(^|\n)[ \t]*\|(.+)\|[ \t]*\n[ \t]*\|[ \t:|-]+\|[ \t]*\n((?:[ \t]*\|.*\|[ \t]*(?:\n|$))+)/g,
    (_, pre, header, body) => {
      const cels = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(esc(c.trim())));
      const th = cels(header).map((c) => `<th>${c}</th>`).join("");
      const trs = body.trim().split("\n").filter((r) => r.trim()).map((r) => `<tr>${cels(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
      blocks.push(`<div class="tblwrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
      return `${pre}\x00${blocks.length - 1}\x00\n`;
    });
  let h = inline(esc(src));
  let out = "", list = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const ln of h.split("\n")) {
    let m;
    if (/^\s*(?:[-*_]\s*){3,}$/.test(ln) && !/[^\s\-*_]/.test(ln)) { closeList(); out += "<hr>"; } // régua ---
    else if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { closeList(); out += `<h4>${m[2]}</h4>`; }
    else if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; } out += `<li>${m[1]}</li>`; }
    else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; } out += `<li>${m[1]}</li>`; }
    else if (!ln.trim()) closeList();
    else { closeList(); out += `<p>${ln}</p>`; }
  }
  closeList();
  return out.replace(/\x00(\d+)\x00/g, (_, i) => blocks[i]);
}

const TYPING = '<span class="dots"><span></span><span></span><span></span></span>';

function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  const finalText = text || "";

  if (cls === "assistant") {
    div.innerHTML = finalText === "…" || finalText === "" ? TYPING : md(finalText);
    const row = document.createElement("div");
    row.className = "arow";
    const av = document.createElement("img");
    av.className = "avatar"; av.src = "icons/mark.png"; av.alt = "";
    const btn = document.createElement("button");
    btn.className = "copybtn"; btn.title = "Copiar"; btn.textContent = "⧉";
    btn.onclick = () => {
      navigator.clipboard.writeText(div.dataset.raw || div.textContent);
      btn.textContent = "✓"; setTimeout(() => (btn.textContent = "⧉"), 1200);
    };
    if (text && text !== "…") div.dataset.raw = text;
    row.append(av, div, btn);
    chat.appendChild(row);
  } else {
    div.textContent = text;
    chat.appendChild(div);
  }
  chat.scrollTop = chat.scrollHeight;

  // Salvar ao histórico (assincronamente, sem bloquear UI)
  if (text && text !== "…") {
    addChatMessage(cls, finalText).catch(() => {});
  }

  return div;
}

function setAssistant(div, text) {
  div.dataset.raw = text;
  div.innerHTML = md(text);
  chat.scrollTop = chat.scrollHeight;
}


 // {t, data} — lista de /v1/models por 5 min
// reenvia se o service worker MV3 tiver morrido (o próprio reenvio o reacorda)
// chrome.runtime.sendMessage() não tem timeout nativo: se o service worker travar ou
// nunca chamar sendResponse (ex.: exceção não tratada num handler async), a Promise fica
// pendente PRA SEMPRE. Sem isto, um único tool() travado deixava "agentRun" sem nunca
// voltar a null — e como send() só executa uma tarefa nova se "agentRun" for null, toda
// mensagem seguinte do usuário era silenciosamente ignorada (sem status, sem erro, sem
// nada na tela: exatamente o "não tá respondendo" que parecia bug de UI mas era um
// tool() pendurado no fundo).
function sendMessageWithTimeout(msg, ms = 20000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout: service worker não respondeu em " + (ms / 1000) + "s")), ms);
  });
  const racers = [chrome.runtime.sendMessage(msg), timeoutPromise];
  // se o usuário clicar ■ (parar) enquanto isto está pendurado, não faz sentido esperar
  // os 20s inteiros — aborta na hora, senão o botão "parar" pareceria não fazer nada.
  const sig = agentRun?.abort?.signal;
  let onAbort;
  if (sig) racers.push(new Promise((_, reject) => { onAbort = () => reject(Object.assign(new Error("parado"), { name: "AbortError" })); sig.addEventListener("abort", onAbort, { once: true }); }));
  // Promise.race não cancela quem perdeu: sem este cleanup, CADA chamada deixa um
  // setTimeout de 20s (e um listener no AbortSignal) pendurado até o fim do prazo mesmo
  // depois de já ter resolvido rápido pelo outro lado — um vazamento pequeno mas que se
  // acumula ao longo de uma tarefa com muitos passos.
  return Promise.race(racers).finally(() => {
    clearTimeout(timer);
    if (sig && onAbort) sig.removeEventListener("abort", onAbort);
  });
}

async function tool(t, args) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await sendMessageWithTimeout({ type: "AGENT_TOOL", tool: t, args, windowId: myWindowId });
      if (r !== undefined) return r;
    } catch (e) {
      // AbortSignal já abortado não dispara o listener de novo numa retentativa (o evento só
      // acontece uma vez) — sem este retorno imediato, a 1ª tentativa cancelava na hora, mas a
      // 2ª e 3ª voltavam a esperar os 20s inteiros do timeout, porque agentRun.abort.signal já
      // estava "aborted" e não reemite o evento. Cancelamento é definitivo: não faz sentido
      // insistir depois que o usuário pediu pra parar.
      if (e.name === "AbortError") return { ok: false, error: "parado pelo usuário" };
      /* canal fechou ou expirou: worker dormiu/travado — tenta de novo */
    }
    await sleep(300);
  }
  return { ok: false, error: "service worker não respondeu (recarregue a extensão em chrome://extensions)" };
}

 // hash da imagem → descrição
 // tarefa → agente escolhido (evita chamada repetida ao orquestrador)
// ---- runtime do agente ----
let agentRun = null; // {cancel, waiting}
  // para atualizar status visual em retry

function setStop(on) {
  btnSend.textContent = on ? "■" : "↑";
  btnSend.title = on ? "Parar tarefa" : "Enviar";
  btnSend.classList.toggle("stop", on);
}

// Modal de Login/2FA
let loginResolve = null;
let loginTimeout = null;
let modalVisible = false;

function hideLoginModal() {
  if (!modalVisible) return;
  clearTimeout(loginTimeout);
  modalVisible = false;

  const modal = document.getElementById("pauseLogin");
  if (modal) modal.style.display = "none";
  console.log("✅ Modal fechada");

  if (loginResolve) {
    const fn = loginResolve;
    loginResolve = null;
    fn(true);  // Resolve promise
  }
}

// AGRESSIVO: Múltiplas formas de capturar clique no botão OK
function setupLoginButton() {
  const btn = document.getElementById("btnLoginOK");
  if (!btn) {
    console.warn("⚠️ btnLoginOK não encontrado, tentando novamente em 500ms...");
    setTimeout(setupLoginButton, 500);
    return;
  }

  // 1. Listener direto (onclick)
  btn.onclick = hideLoginModal;

  // 2. addEventListener (para garantir)
  btn.addEventListener("click", hideLoginModal, false);

  // 3. Listener para Enter
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") hideLoginModal();
  });

  // Sem handler inline (onclick="..."): a CSP do Manifest V3 bloqueia e ainda anula btn.onclick
  console.log("✅ Login button listeners ativados (3 formas)");
}

// Ativar logo que DOM estiver pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupLoginButton);
} else {
  setupLoginButton();  // Já carregou
}

// EXTRA: Tentar novamente periodicamente (fallback se tudo falhar)
setInterval(() => {
  const btn = document.getElementById("btnLoginOK");
  if (btn && !btn.onclick && !btn.__loginSetup) {
    console.log("🔧 Re-adicionando listeners (fallback periódico)");
    setupLoginButton();
    btn.__loginSetup = true;
  }
}, 1000);

// Saudação/agradecimento/despedida PURA (a mensagem inteira, sem mais nada junto) não pede
// nenhuma ação no navegador — mas antes de chegar aqui, o modo agente pagava o custo de MCP
// discovery + snapshot da página + ~2000 tokens de TOOLS_DOC/fluxo só pra concluir isso na
// primeira resposta. Em gateway CPU-only isso já rendeu reclamação real de "oi" levando
// 20s+. Resolvido sem nenhuma chamada ao LLM: regex cobre só a mensagem inteira (não um
// prefixo), então "oi, pesquise sobre X" continua indo pro agente normalmente.
const SOCIAL_SAUDACAO = /^(oi+|ol[áa]+|e a[íi]|opa|eae|hey|hello|bom dia|boa tarde|boa noite)[\s!.,?]*$/i;
const SOCIAL_AGRADECE = /^(obrigad[oa]s?|muito obrigad[oa]|valeu|vlw)[\s!.,?]*$/i;
const SOCIAL_TCHAU = /^(tchau|flw|falou|at[ée] (mais|logo|amanh[ãa]))[\s!.,?]*$/i;
const SOCIAL_COMOVAI = /^((oi+|ol[áa]+|e a[íi]|opa|eae)[\s,!]*)?(tudo bem\??|tudo bom\??|como (voc[êe] )?(est[áa]|vai)\??|beleza\??|blz\??)[\s!.,?]*$/i;
function respostaSocial(q) {
  if (SOCIAL_SAUDACAO.test(q)) return "Oi! Como posso ajudar?";
  if (SOCIAL_AGRADECE.test(q)) return "De nada! Qualquer coisa é só chamar.";
  if (SOCIAL_TCHAU.test(q)) return "Até mais! 👋";
  if (SOCIAL_COMOVAI.test(q)) return "Tudo certo por aqui! Em que posso ajudar?";
  return null;
}

async function send() {
  const question = input.value.trim();
  if (!question) return;

  // resposta a uma pergunta do agente em andamento
  if (agentRun?.waiting) {
    input.value = ""; input.style.height = "";
    addMsg("user", question);
    const resolve = agentRun.waiting;
    agentRun.waiting = null;
    input.placeholder = "Pergunte algo...";
    resolve(question);
    return;
  }
  if (agentRun) return; // agente ocupado: use ■ para parar

  input.value = ""; input.style.height = "";
  addMsg("user", question);

  const social = respostaSocial(question);
  if (social) { addMsg("assistant", social); agentHistory.push({ task: question, resposta: social }); return; }

  await runHermes(question);
}

btnSend.onclick = () => {
  if (agentRun && !agentRun.waiting) { agentRun.cancel = true; agentRun.abort?.abort(); return; }
  send();
};
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
// textarea cresce com o conteúdo (até o teto do CSS)
function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; }
input.addEventListener("input", autoGrow);

// ---- Conta: entrar, criar conta, sair e sincronização ----
let account = null;
const statusConta = (msg) => { $("contaStatus").textContent = msg; };
const mostraConta = () => {
  statusConta(account
    ? "Conectado como " + (account.user.name || account.user.email) + " — dados sincronizados com " + account.apiUrl
    : "Não conectado — o histórico fica só neste navegador.");
};
async function contaEntrar(criar) {
  const apiUrl = ACCOUNT_DEFAULT_URL;
  try {
    statusConta(criar ? "Criando conta…" : "Entrando…");
    account = criar
      ? await accountSignUp(apiUrl, $("contaNome").value.trim(), $("contaEmail").value.trim(), $("contaSenha").value)
      : await accountSignIn(apiUrl, $("contaEmail").value.trim(), $("contaSenha").value);
    $("contaSenha").value = "";
    await syncPull(account, { includeSettings: true });
    await syncPush(account);
    mostraConta();
  } catch (e) {
    statusConta("Erro: " + e.message);
  }
}
$("btnEntrar").onclick = () => contaEntrar(false);
$("btnCriarConta").onclick = () => contaEntrar(true);
$("btnExcluirConta").onclick = async () => {
  if (!account) return statusConta("Entre na conta antes de excluí-la.");
  const senha = $("contaSenha").value;
  if (!senha) return statusConta("Digite a senha no campo acima para confirmar a exclusão.");
  if (!confirm("Excluir a conta e todos os dados sincronizados? Essa ação não pode ser desfeita.")) return;
  try {
    statusConta("Excluindo conta…");
    await accountDelete(account, senha);
    await hermesApagar();
    $("contaSenha").value = "";
    account = null;
    mostraConta();
    statusConta("Conta excluída. Os dados guardados neste navegador continuam aqui até você limpá-los.");
  } catch (e) {
    statusConta("Erro: " + e.message);
  }
};
$("btnSair").onclick = async () => {
  await accountSignOut();
  account = null;
  mostraConta();
};
// Histórico e memória sobem a cada minuto enquanto a conta estiver conectada.
setInterval(() => { if (account) syncPush(account, { recordsOnly: true }).catch(() => {}); }, 60000);
accountLoad().then((saved) => {
  account = saved;
  mostraConta();
  if (account) syncPull(account).catch(() => {});
});
