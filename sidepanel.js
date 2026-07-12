const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");
const btnSend = $("btnSend");
const history = [];      // chat normal {role, content}
const agentHistory = []; // modo agente {task, resposta}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULTS = {
  url: "http://localhost:8080/v1/chat/completions",
  model: "",
  key: "",
  maxSteps: 20
};
let cfg = { ...DEFAULTS };

if (chrome.storage?.sync) chrome.storage.sync.get(DEFAULTS, (saved) => {
  cfg = saved;
  $("cfgUrl").value = cfg.url;
  $("cfgModel").value = cfg.model;
  $("cfgKey").value = cfg.key;
  $("cfgSteps").value = cfg.maxSteps;
});

$("btnSettings").onclick = () => $("settings").classList.toggle("hidden");
$("btnSave").onclick = () => {
  cfg = {
    url: $("cfgUrl").value.trim() || DEFAULTS.url,
    model: $("cfgModel").value.trim(),
    key: $("cfgKey").value.trim(),
    maxSteps: Math.min(50, Math.max(3, parseInt($("cfgSteps").value) || 20))
  };
  if (chrome.storage?.sync) chrome.storage.sync.set(cfg);
  $("settings").classList.add("hidden");
};

// ---------- renderização Markdown (sem dependências, HTML sempre escapado) ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function md(src) {
  const blocks = [];
  src = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\x00${blocks.length - 1}\x00`;
  });
  let h = esc(src)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let out = "", list = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const ln of h.split("\n")) {
    let m;
    if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { closeList(); out += `<h4>${m[2]}</h4>`; }
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
  if (cls === "assistant") {
    div.innerHTML = text === "…" || text === "" ? TYPING : md(text);
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
  return div;
}

function setAssistant(div, text) {
  div.dataset.raw = text;
  div.innerHTML = md(text);
  chat.scrollTop = chat.scrollHeight;
}

function gatewayHeaders() {
  const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  if (cfg.key) headers.Authorization = "Bearer " + cfg.key;
  return headers;
}

async function ensureModel(headers) {
  if (cfg.model) return;
  const mResp = await fetch(cfg.url.replace(/\/chat\/completions\/?$/, "/models"), { headers });
  const first = (await mResp.json()).data?.[0]?.id;
  if (!first) throw new Error("configure o modelo no ⚙︎ (GET /v1/models não retornou nada)");
  cfg.model = first;
  if (chrome.storage?.sync) chrome.storage.sync.set({ model: first });
  $("cfgModel").value = first;
}

// chamada não-streaming com retry (usada pelos agentes)
async function llm(messages, maxTokens = 700) {
  const headers = gatewayHeaders();
  await ensureModel(headers);
  for (let tent = 1; ; tent++) {
    try {
      const resp = await fetch(cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature: 0 })
      });
      if (resp.status >= 500) throw new Error("HTTP " + resp.status);
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`), { fatal: true });
      return (await resp.json()).choices?.[0]?.message?.content || "";
    } catch (e) {
      if (e.fatal || tent >= 3) throw e;
      await sleep(800 * tent); // retry em falha de rede/5xx
    }
  }
}

// ---------- MODO AGENTE ----------
const AGENTS = [
  { id: "navegador",   nome: "🧭 Navegador",   desc: "abre sites, clica em links e botões, navega entre páginas" },
  { id: "pesquisador", nome: "🔎 Pesquisador", desc: "pesquisa na web (Google/DuckDuckGo) e coleta informações de resultados" },
  { id: "leitor",      nome: "📖 Leitor",      desc: "lê, resume e extrai dados do conteúdo de páginas" },
  { id: "preenchedor", nome: "📝 Preenchedor", desc: "preenche campos de formulários e caixas de busca" }
];

const TOOLS_DOC = `Ferramentas disponíveis (responda SOMENTE com um JSON por vez, sem nenhum texto fora do JSON):
{"tool":"navegar","args":{"url":"https://..."}} — abrir uma URL na aba atual
{"tool":"nova_aba","args":{"url":"https://..."}} — abrir uma URL em nova aba
{"tool":"voltar","args":{}} — voltar à página anterior
{"tool":"clicar","args":{"i":N}} — clicar no elemento de índice [N]
{"tool":"digitar","args":{"i":N,"texto":"..."}} — escrever no campo [N]
{"tool":"tecla","args":{"i":N,"tecla":"Enter"}} — pressionar Enter no campo [N] (envia buscas/formulários)
{"tool":"rolar","args":{"dir":"baixo"}} — rolar a página ("baixo" ou "cima")
{"tool":"ler","args":{"offset":0}} — obter o texto da página (use offset para continuar páginas longas)
{"tool":"esperar","args":{"segundos":2}} — aguardar a página carregar (1 a 10s)
{"tool":"perguntar","args":{"pergunta":"..."}} — fazer uma pergunta ao usuário quando faltar informação
{"tool":"concluir","args":{"resposta":"..."}} — terminar a tarefa e responder ao usuário em PT-BR (use Markdown)

IMPORTANTE: sua resposta deve conter apenas UM objeto JSON e começar com "{". Na ação "concluir", seja breve na resposta (máx. ~150 palavras).

Dicas: só use "clicar"/"digitar" em índices [N] que existam na lista de elementos. Para pesquisar na web, navegue direto para https://duckduckgo.com/html/?q=SUA+BUSCA e depois use "ler". Se a página atual não serve para a tarefa, comece com "navegar". Se faltar informação essencial do usuário (ex.: qual cidade, qual produto), use "perguntar".

Regras de segurança: NUNCA digite senhas, dados de cartão ou documentos; NUNCA confirme compras, pagamentos ou exclusões. Nesses casos use "concluir" pedindo que o usuário faça essa parte manualmente.`;

function agentSystem(agent) {
  return `Você é ${agent.nome}, agente da equipe Mangaba AI especializado em: ${agent.desc}. Você controla o navegador do usuário passo a passo para cumprir a tarefa pedida.\n\n${TOOLS_DOC}`;
}

function parseAction(raw) {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const a = clean.indexOf("{");
  if (a < 0) return null;
  // extrai o primeiro objeto JSON balanceado (tolera lixo antes/depois, ex.: "}" extra)
  let depth = 0, str = false, escd = false;
  for (let i = a; i < clean.length; i++) {
    const c = clean[i];
    if (escd) { escd = false; continue; }
    if (c === "\\") { escd = true; continue; }
    if (c === '"') str = !str;
    if (str) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(clean.slice(a, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const tool = (t, args) => chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: t, args });

const TOOL_NAMES = ["navegar", "nova_aba", "voltar", "clicar", "digitar", "tecla", "rolar", "ler", "esperar", "perguntar", "concluir"];
const STR_ARG = { concluir: "resposta", perguntar: "pergunta", navegar: "url", nova_aba: "url", rolar: "dir" };

// aceita variações que os modelos pequenos produzem:
// {"tool":"x","args":{...}} | {"tool":"x",...args soltos} | {"x":{...}} | {"concluir":"texto"}
function normalizeAction(o) {
  if (!o || typeof o !== "object") return null;
  if (typeof o.tool === "string") {
    let args = o.args;
    if (typeof args === "string") args = STR_ARG[o.tool] ? { [STR_ARG[o.tool]]: args } : {};
    if (!args || typeof args !== "object") { args = { ...o }; delete args.tool; }
    if (o.tool === "concluir" && typeof args.resposta !== "string") {
      const s = args.texto ?? args.answer ?? args.mensagem;
      if (typeof s === "string") args.resposta = s;
    }
    return TOOL_NAMES.includes(o.tool) ? { tool: o.tool, args } : null;
  }
  for (const t of TOOL_NAMES) {
    if (t in o) {
      const v = o[t];
      const args = v && typeof v === "object" ? v
        : STR_ARG[t] ? { [STR_ARG[t]]: String(v ?? "") } : {};
      return { tool: t, args };
    }
  }
  return null;
}

function fmtSnapshot(s) {
  const els = s.elements.map((e) => {
    let ln = `[${e.i}] ${e.tag}${e.tipo ? ":" + e.tipo : ""} "${e.texto}"`;
    if (e.href) ln += ` → ${e.href}`;
    if (e.valor) ln += ` (valor atual: "${e.valor}")`;
    return ln;
  }).join("\n");
  return `Página: ${s.title} — ${s.url} (vista até ${s.rolagem}% da altura)\nElementos interativos:\n${els}\nTrecho do texto: ${s.trecho}`;
}

async function pickAgent(task) {
  const lista = AGENTS.map((a) => `${a.id}: ${a.desc}`).join("\n");
  const raw = await llm([
    { role: "system", content: "Você é o Orquestrador da equipe Mangaba AI. Escolha o agente mais adequado para a tarefa. Responda SOMENTE com JSON no formato {\"agente\":\"id\"}." },
    { role: "user", content: `Agentes:\n${lista}\n\nTarefa: ${task}` }
  ], 60);
  const id = parseAction(raw)?.agente;
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}

// ---- runtime do agente ----
let agentRun = null; // {cancel, waiting}

const SENSITIVE_CLICK = /comprar|pagar|pagamento|checkout|finalizar|enviar|excluir|apagar|deletar|remover|assinar|transferir|confirmar/i;
const SENSITIVE_FIELD = /senha|password|cart[ãa]o|cvv|cpf|cnpj|\brg\b/i;

function setStop(on) {
  btnSend.textContent = on ? "■" : "➤";
  btnSend.title = on ? "Parar tarefa" : "Enviar";
  btnSend.classList.toggle("stop", on);
}

function stepsBox() {
  const det = document.createElement("details");
  det.className = "steps";
  det.open = true;
  const sum = document.createElement("summary");
  sum.textContent = "Passos (0)";
  const body = document.createElement("div");
  det.append(sum, body);
  chat.appendChild(det);
  return {
    det, n: 0,
    add(txt) {
      this.n++;
      sum.textContent = `Passos (${this.n})`;
      const d = document.createElement("div");
      d.className = "stepline";
      d.textContent = txt;
      body.appendChild(d);
      chat.scrollTop = chat.scrollHeight;
    }
  };
}

function confirmAction(texto) {
  return new Promise((res) => {
    const div = document.createElement("div");
    div.className = "msg confirm";
    const p = document.createElement("p");
    p.textContent = "⚠️ O agente quer " + texto + ". Permitir?";
    const ok = document.createElement("button");
    ok.textContent = "Permitir";
    const no = document.createElement("button");
    no.textContent = "Negar"; no.className = "neg";
    const done = (v) => { ok.disabled = no.disabled = true; div.classList.add("done"); res(v); };
    ok.onclick = () => done(true);
    no.onclick = () => done(false);
    div.append(p, ok, no);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  });
}

function askUser(pergunta) {
  addMsg("assistant", pergunta);
  input.placeholder = "Responda ao agente...";
  input.focus();
  return new Promise((res) => (agentRun.waiting = res));
}

const elLabel = (snap, i) => snap?.elements?.find((e) => e.i === i)?.texto || "";

function describeAction(act, label) {
  const a = act.args || {};
  switch (act.tool) {
    case "navegar": return `🌐 Abrindo ${a.url}`;
    case "nova_aba": return `🗂️ Nova aba: ${a.url}`;
    case "voltar": return "↩️ Voltando à página anterior";
    case "clicar": return `🖱️ Clicando em [${a.i}] "${label}"`;
    case "digitar": return `⌨️ Digitando "${String(a.texto || "").slice(0, 40)}" em [${a.i}] "${label}"`;
    case "tecla": return `⏎ ${a.tecla || "Enter"} em [${a.i}] "${label}"`;
    case "rolar": return `↕️ Rolando para ${a.dir || "baixo"}`;
    case "ler": return `📖 Lendo a página${a.offset ? ` (a partir de ${a.offset})` : ""}`;
    case "esperar": return `⏱️ Esperando ${a.segundos || 1}s`;
    default: return `${act.tool} ${JSON.stringify(a)}`;
  }
}

async function runAgent(task) {
  agentRun = { cancel: false, waiting: null };
  setStop(true);
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  const status = document.createElement("div");
  status.className = "msg agentstatus";
  status.textContent = "🧠 Planejando...";
  chat.appendChild(status);
  const box = stepsBox();
  let statusTxt = "🧠 Planejando";
  const tick = setInterval(() => {
    if (statusTxt) status.textContent = `${statusTxt} · ${secs()}s`;
  }, 1000);

  const visited = [], feitas = [];
  let leitura = "", lastSig = "", lastCount = 0;

  const finish = (resposta) => {
    const r = resposta || "Tarefa concluída.";
    statusTxt = null;
    if (visited.length) box.add("📍 Páginas: " + visited.slice(-5).join(" → "));
    status.textContent = `✅ Concluído · ${box.n} passos · ${secs()}s`;
    box.det.open = false;
    addMsg("assistant", r);
    agentHistory.push({ task, resposta: r });
  };

  try {
    // plano curto antes de agir
    let plano = [];
    try {
      const p = parseAction(await llm([
        { role: "system", content: 'Você é o planejador da equipe Mangaba AI. Gere um plano curto (2 a 4 passos) para cumprir a tarefa usando o navegador. Responda SOMENTE com JSON: {"plano":["passo 1","passo 2"]}' },
        { role: "user", content: task }
      ], 200));
      if (Array.isArray(p?.plano)) plano = p.plano.map(String).slice(0, 5);
    } catch { /* plano é opcional */ }
    if (plano.length) box.add("🗺️ Plano: " + plano.map((s, i) => `${i + 1}) ${s}`).join("  "));

    // agente: manual (dropdown) ou orquestrador
    const sel = $("agentSel").value;
    const agent = sel !== "auto" ? AGENTS.find((a) => a.id === sel) : await pickAgent(task);
    box.add(`${agent.nome} assumiu a tarefa`);

    const maxSteps = cfg.maxSteps || 20;
    for (let passo = 1; passo <= maxSteps; passo++) {
      if (agentRun.cancel) {
        statusTxt = null;
        status.textContent = `⏹ Interrompido por você · ${box.n} passos · ${secs()}s`;
        return;
      }
      statusTxt = `${agent.nome} · passo ${passo}/${maxSteps}`;

      const snapRes = await tool("snapshot", {});
      const snap = snapRes?.ok ? snapRes.out : null;
      if (snap?.url && visited[visited.length - 1] !== snap.url) visited.push(snap.url);
      const contexto = snap ? fmtSnapshot(snap) : `(sem acesso à página: ${snapRes?.error || "?"} — use "navegar" para abrir um site)`;
      const anteriores = agentHistory.slice(-3).map((h) => `- "${h.task}" → ${h.resposta.slice(0, 100)}`).join("\n");

      const raw = await llm([
        { role: "system", content: agentSystem(agent) },
        { role: "user", content:
          `Tarefa do usuário: ${task}\n` +
          (plano.length ? `\nPlano combinado: ${plano.join("; ")}\n` : "") +
          (anteriores ? `\nTarefas anteriores nesta conversa:\n${anteriores}\n` : "") +
          `\n${contexto}\n` +
          (visited.length > 1 ? `\nPáginas já visitadas: ${visited.slice(-5).join(" → ")}\n` : "") +
          (leitura ? `\nConteúdo lido da página (ação "ler"):\n${leitura}\n` : "") +
          `\nAções já executadas:\n${feitas.length ? feitas.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(nenhuma)"}\n` +
          `\nQual a próxima ação? Responda somente o JSON.` }
      ], 1200);

      const act = normalizeAction(parseAction(raw));
      if (!act?.tool) {
        const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```\w*/g, "").trim();
        const m = clean.match(/"resposta"\s*:\s*"([\s\S]+)/);
        if (m) { finish(m[1].replace(/\\n/g, "\n").replace(/["}\]]*\s*$/, "")); return; }
        if (!clean.includes("{") && leitura && clean.length > 40) { finish(clean); return; }
        feitas.push(`resposta inválida ("${clean.slice(0, 60)}...") → envie UM único objeto JSON começando com {`);
        box.add(`⚠️ Resposta fora do formato, pedindo de novo`);
        continue;
      }

      // detecção de loop: mesma ação 3x seguidas
      const sig = JSON.stringify(act);
      lastCount = sig === lastSig ? lastCount + 1 : 1;
      lastSig = sig;
      if (lastCount >= 3) {
        feitas.push("ATENÇÃO: você repetiu a mesma ação 3 vezes sem progresso; mude de estratégia ou use \"concluir\"");
        box.add("♻️ Ação repetida 3× — pedindo mudança de estratégia");
        lastCount = 0;
        continue;
      }

      if (act.tool === "concluir") { finish(act.args?.resposta); return; }

      if (act.tool === "perguntar") {
        const q = act.args?.pergunta || "Pode dar mais detalhes sobre o que você quer?";
        box.add("❓ Perguntando ao usuário");
        statusTxt = null;
        status.textContent = "⏸️ Aguardando sua resposta...";
        const ans = await askUser(q);
        statusTxt = `${agent.nome} · retomando`;
        feitas.push(`perguntar "${q.slice(0, 60)}" → usuário respondeu: "${ans.slice(0, 150)}"`);
        continue;
      }

      // confirmação humana para ações sensíveis
      const label = elLabel(snap, act.args?.i);
      const sensivel =
        ((act.tool === "clicar" || act.tool === "tecla") && SENSITIVE_CLICK.test(label)) ||
        (act.tool === "digitar" && SENSITIVE_FIELD.test(label));
      if (sensivel) {
        statusTxt = null;
        status.textContent = "⏸️ Aguardando sua confirmação...";
        const okd = await confirmAction(`${act.tool} em "${label}"`);
        statusTxt = `${agent.nome} · passo ${passo}/${maxSteps}`;
        if (!okd) {
          feitas.push(`usuário NEGOU ${act.tool} em "${label}" — não tente de novo; siga outro caminho ou conclua`);
          box.add("🚫 Ação negada por você");
          continue;
        }
      }

      box.add(`${passo}. ${describeAction(act, label)}`);
      const res = await tool(act.tool, act.args || {});
      const obs = res?.ok ? (typeof res.out === "string" ? res.out : "ok") : "ERRO: " + res?.error;
      if (act.tool === "ler" && res?.ok) {
        leitura = String(res.out).slice(0, 5000);
        feitas.push(`ler → conteúdo obtido (veja acima); se já basta para a tarefa, use "concluir"`);
      } else {
        feitas.push(`${act.tool} ${JSON.stringify(act.args || {})} → ${String(obs).slice(0, 120)}`);
      }
      await sleep(300);
    }
    statusTxt = null;
    status.textContent = `⚠️ Limite de ${maxSteps} passos atingido · ${secs()}s`;
    addMsg("err", "Não concluí dentro do limite de passos. Refine o pedido ou aumente o limite no ⚙︎.");
  } catch (e) {
    statusTxt = null;
    status.textContent = `❌ Erro · ${secs()}s`;
    addMsg("err", "Erro no modo agente: " + e.message);
  } finally {
    clearInterval(tick);
    agentRun = null;
    setStop(false);
    input.placeholder = "Pergunte algo...";
  }
}

// ---------- CHAT ----------
async function getPageContext() {
  const res = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" });
  if (!res?.ok) return null;
  const { title, url, text } = res.page;
  return `Contexto da página aberta:\nTítulo: ${title}\nURL: ${url}\nConteúdo:\n${text}`;
}

async function send() {
  const question = input.value.trim();
  if (!question) return;

  // resposta a uma pergunta do agente em andamento
  if (agentRun?.waiting) {
    input.value = "";
    addMsg("user", question);
    const resolve = agentRun.waiting;
    agentRun.waiting = null;
    input.placeholder = "Pergunte algo...";
    resolve(question);
    return;
  }
  if (agentRun) return; // agente ocupado: use ■ para parar

  input.value = "";
  addMsg("user", question);

  try {
    if ($("agentMode").checked) {
      await runAgent(question);
      return;
    }
    btnSend.disabled = true;
    const messages = [{
      role: "system",
      content: "Você é a Mangaba, assistente de IA brasileira. Responda em português do Brasil, de forma clara e objetiva. Use Markdown quando ajudar na leitura."
    }];
    if ($("usePage").checked) {
      const ctx = await getPageContext();
      if (ctx) messages.push({ role: "system", content: ctx });
    }
    messages.push(...history, { role: "user", content: question });

    const bubble = addMsg("assistant", "…");
    const headers = gatewayHeaders();
    await ensureModel(headers);
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.model, messages, stream: true })
    });
    if (!resp.ok) { (bubble.closest(".arow") || bubble).remove(); throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`); }

    let answer = "";
    if (resp.headers.get("content-type")?.includes("event-stream")) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "").trim();
          if (!data || data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) { answer += delta; setAssistant(bubble, answer); }
          } catch { /* linha parcial */ }
        }
      }
    } else {
      const json = await resp.json();
      answer = json.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 500);
      setAssistant(bubble, answer);
    }
    history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (e) {
    addMsg("err", "Erro: " + e.message);
  } finally {
    btnSend.disabled = false;
    input.focus();
  }
}

btnSend.onclick = () => {
  if (agentRun && !agentRun.waiting) { agentRun.cancel = true; return; }
  send();
};
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
