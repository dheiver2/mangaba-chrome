const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");
const btnSend = $("btnSend");
const history = []; // {role, content}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULTS = {
  url: "http://localhost:8080/v1/chat/completions",
  model: "",
  key: ""
};
let cfg = { ...DEFAULTS };

chrome.storage.sync.get(DEFAULTS, (saved) => {
  cfg = saved;
  $("cfgUrl").value = cfg.url;
  $("cfgModel").value = cfg.model;
  $("cfgKey").value = cfg.key;
});

$("btnSettings").onclick = () => $("settings").classList.toggle("hidden");
$("btnSave").onclick = () => {
  cfg = {
    url: $("cfgUrl").value.trim() || DEFAULTS.url,
    model: $("cfgModel").value.trim(),
    key: $("cfgKey").value.trim()
  };
  chrome.storage.sync.set(cfg);
  $("settings").classList.add("hidden");
};

function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function gatewayHeaders() {
  const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
  if (cfg.key) headers.Authorization = "Bearer " + cfg.key;
  return headers;
}

async function ensureModel(headers) {
  if (cfg.model) return;
  // sem modelo configurado: usa o primeiro que o gateway listar
  const mResp = await fetch(cfg.url.replace(/\/chat\/completions\/?$/, "/models"), { headers });
  const first = (await mResp.json()).data?.[0]?.id;
  if (!first) throw new Error("configure o modelo no ⚙︎ (GET /v1/models não retornou nada)");
  cfg.model = first;
  chrome.storage.sync.set({ model: first });
  $("cfgModel").value = first;
}

// chamada não-streaming (usada pelos agentes)
async function llm(messages, maxTokens = 700) {
  const headers = gatewayHeaders();
  await ensureModel(headers);
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: cfg.model, messages, max_tokens: maxTokens, temperature: 0 })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return (await resp.json()).choices?.[0]?.message?.content || "";
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
{"tool":"clicar","args":{"i":N}} — clicar no elemento de índice [N]
{"tool":"digitar","args":{"i":N,"texto":"..."}} — escrever no campo [N]
{"tool":"tecla","args":{"i":N,"tecla":"Enter"}} — pressionar Enter no campo [N] (envia buscas/formulários)
{"tool":"rolar","args":{"dir":"baixo"}} — rolar a página ("baixo" ou "cima")
{"tool":"ler","args":{}} — obter o texto completo da página atual
{"tool":"concluir","args":{"resposta":"..."}} — terminar a tarefa e responder ao usuário em PT-BR

Dicas: só use "clicar"/"digitar" em índices [N] que existam na lista de elementos. Para pesquisar na web, navegue direto para https://duckduckgo.com/html/?q=SUA+BUSCA e depois use "ler". Se a página atual não serve para a tarefa, comece com "navegar".

Regras de segurança: NUNCA digite senhas, dados de cartão ou documentos; NUNCA confirme compras, pagamentos ou exclusões. Nesses casos use "concluir" pedindo que o usuário faça essa parte manualmente.`;

function agentSystem(agent) {
  return `Você é ${agent.nome}, agente da equipe Mangaba AI especializado em: ${agent.desc}. Você controla o navegador do usuário passo a passo para cumprir a tarefa pedida.\n\n${TOOLS_DOC}`;
}

function parseAction(raw) {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const a = clean.indexOf("{");
  if (a < 0) return null;
  // extrai o primeiro objeto JSON balanceado (tolera lixo antes/depois, ex.: "}" extra)
  let depth = 0, str = false, esc = false;
  for (let i = a; i < clean.length; i++) {
    const c = clean[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
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

function fmtSnapshot(s) {
  const els = s.elements.map((e) => `[${e.i}] ${e.tag}${e.tipo ? ":" + e.tipo : ""} "${e.texto}"`).join("\n");
  return `Página: ${s.title} — ${s.url}\nElementos interativos:\n${els}\nTrecho do texto: ${s.trecho}`;
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

async function runAgent(task) {
  addMsg("step", "🧠 Orquestrador escolhendo o agente...");
  const agent = await pickAgent(task);
  addMsg("step", `${agent.nome} assumiu a tarefa`);

  const feitas = [];
  let leitura = ""; // conteúdo completo da última ação "ler"
  for (let passo = 1; passo <= 15; passo++) {
    const snapRes = await tool("snapshot", {});
    const contexto = snapRes?.ok ? fmtSnapshot(snapRes.out) : `(sem acesso à página: ${snapRes?.error || "?"} — use "navegar" para abrir um site)`;
    const raw = await llm([
      { role: "system", content: agentSystem(agent) },
      { role: "user", content: `Tarefa do usuário: ${task}\n\n${contexto}\n${leitura ? `\nConteúdo lido da página (ação "ler"):\n${leitura}\n` : ""}\nAções já executadas:\n${feitas.length ? feitas.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(nenhuma)"}\n\nQual a próxima ação? Responda somente o JSON.` }
    ]);
    const act = parseAction(raw);
    if (!act?.tool) {
      feitas.push(`resposta inválida ("${raw.slice(0, 60)}...") → envie UM único objeto JSON válido`);
      addMsg("step", `${passo}. resposta inválida, tentando de novo`);
      continue;
    }
    if (act.tool === "concluir") {
      addMsg("assistant", act.args?.resposta || "Tarefa concluída.");
      return;
    }
    addMsg("step", `${passo}. ${act.tool} ${JSON.stringify(act.args || {})}`);
    const res = await tool(act.tool, act.args || {});
    const obs = res?.ok ? (typeof res.out === "string" ? res.out : "ok") : "ERRO: " + res?.error;
    if (act.tool === "ler" && res?.ok) {
      leitura = String(res.out).slice(0, 5000);
      feitas.push(`ler → conteúdo obtido (veja acima); se já basta para a tarefa, use "concluir"`);
    } else {
      feitas.push(`${act.tool} ${JSON.stringify(act.args || {})} → ${String(obs).slice(0, 120)}`);
    }
    await sleep(400);
  }
  addMsg("err", "Limite de 15 passos atingido sem concluir. Refine o pedido.");
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
  input.value = "";
  btnSend.disabled = true;
  addMsg("user", question);

  try {
    if ($("agentMode").checked) {
      await runAgent(question);
      return;
    }
    const messages = [{
      role: "system",
      content: "Você é a Mangaba, assistente de IA brasileira. Responda em português do Brasil, de forma clara e objetiva."
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
    if (!resp.ok) { bubble.remove(); throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`); }

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
            if (delta) { answer += delta; bubble.textContent = answer; chat.scrollTop = chat.scrollHeight; }
          } catch { /* linha parcial */ }
        }
      }
    } else {
      const json = await resp.json();
      answer = json.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 500);
      bubble.textContent = answer;
    }
    history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (e) {
    addMsg("err", "Erro: " + e.message);
  } finally {
    btnSend.disabled = false;
    input.focus();
  }
}

btnSend.onclick = send;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
