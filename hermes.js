// ---- Motor Hermes (servidor) ----
// O raciocínio roda no Hermes (hermes-chrome, atrás da ponte). As ações de página chegam
// como frames `navegador.acao` no mesmo stream SSE e são executadas nesta aba pelo
// mesmo tool() do modo Router, que já conhece o background.js.

const HERMES_KEY = "hermes_instalacao"; // {instalacao, chave} em chrome.storage.local

function hermesBase() {
  return (cfg.hermesUrl || DEFAULTS.hermesUrl).replace(/\/+$/, "");
}

// Registra esta instalação na ponte uma vez; a chave vira a identidade.
async function hermesInstalacao() {
  const r = await chrome.storage.local.get({ [HERMES_KEY]: null });
  if (r[HERMES_KEY]) return r[HERMES_KEY];
  const resposta = await fetch(hermesBase() + "/instalacao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resposta.ok) throw new Error(`não consegui registrar no Hermes (${resposta.status})`);
  const inst = await resposta.json();
  await chrome.storage.local.set({ [HERMES_KEY]: inst });
  return inst;
}

// Apaga no Hermes a instalação desta extensão: container, volume e chave.
async function hermesApagar() {
  const r = await chrome.storage.local.get({ [HERMES_KEY]: null });
  const inst = r[HERMES_KEY];
  if (!inst) return;
  await fetch(hermesBase() + "/instalacao/apagar", {
    method: "POST",
    headers: { Authorization: "Bearer " + inst.chave },
  }).catch(() => {});
  await chrome.storage.local.remove(HERMES_KEY);
}

// Lê text/event-stream preservando o nome do evento (é nele que vêm as ações).
async function* lerSSEHermes(corpo) {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await leitor.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    let fim;
    while ((fim = buffer.indexOf("\n\n")) >= 0) {
      const quadro = buffer.slice(0, fim);
      buffer = buffer.slice(fim + 2);
      let evento = null;
      const partes = [];
      for (const linha of quadro.split("\n")) {
        if (linha.startsWith("event:")) evento = linha.slice(6).trim();
        else if (linha.startsWith("data:")) partes.push(linha.slice(5).replace(/^ /, ""));
      }
      if (partes.length) yield { evento, dados: partes.join("\n") };
    }
  }
}

// Diz ao agente qual página o usuário está vendo, para ele trabalhar nela e não noutra.
async function contextoDaAba() {
  const r = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT", windowId: myWindowId }).catch(() => null);
  if (!r?.ok) return "";
  return `\n\n[aba atual: ${r.page.title} — ${r.page.url}]\nTrabalhe nesta aba, a que o usuário está vendo, a não ser que ele peça outra.`;
}

// "Meus dados": o modelo só conhece os nomes ({{email}}); o valor entra direto na página.
function meusDados() {
  const dados = {};
  for (const linha of (cfg.dados || "").split("\n")) {
    const i = linha.indexOf(":");
    const chave = linha.slice(0, i).trim();
    if (i > 0 && chave) dados[chave] = linha.slice(i + 1).trim();
  }
  return dados;
}

function contextoDosDados() {
  const chaves = Object.keys(meusDados());
  if (!chaves.length) return "";
  return `\n[dados do usuário: ${chaves.map((c) => `{{${c}}}`).join(", ")}]\nPara preencher com eles, digite o marcador exatamente assim; a extensão troca pelo valor na página. Não peça esses dados ao usuário.`;
}

const trocarMarcadores = (texto, dados) => texto.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, c) => (c in dados ? dados[c] : m));

// O que volta ao modelo não pode trazer o valor de volta: troca de novo pelo marcador.
function esconderValores(texto, dados) {
  for (const [c, v] of Object.entries(dados)) if (v.length >= 3) texto = texto.split(v).join(`{{${c}}}`);
  return texto;
}

// Executa uma ação pedida pelo Hermes e devolve o texto que volta para ele.
// "perguntar" e "extrair" são resolvidas aqui no painel; o resto vai ao background.js.
async function executarAcaoHermes(acao) {
  const args = acao.args || {};
  if (acao.tool === "perguntar") {
    addMsg("assistant", "❓ " + (args.pergunta || "Preciso de uma informação sua para continuar."));
    input.placeholder = "Responda ao agente…";
    const resposta = await new Promise((resolver) => { agentRun.waiting = resolver; });
    return "resposta do usuário: " + resposta;
  }
  if (acao.tool === "extrair") {
    // a extração em si é do modelo; aqui só entregamos o texto da página
    const r = await tool("ler", {});
    return esconderValores(r.ok ? `Texto da página para extrair "${args.o_que || ""}":\n${r.out}` : "erro: " + (r.error || "falhou"), meusDados());
  }
  const dados = meusDados();
  const comValores = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" ? trocarMarcadores(v, dados) : v]));
  const r = await tool(acao.tool, comValores);
  return esconderValores(r.ok ? String(r.out ?? "ok") : "erro: " + (r.error || "falhou"), dados);
}

// Executa uma tarefa pelo Hermes. Retorna quando o stream termina.
async function runHermes(task) {
  agentRun = { cancel: false, waiting: null, abort: new AbortController() };
  setStop(true);
  const status = document.createElement("div");
  status.className = "msg agentstatus";
  status.textContent = "Hermes pensando...";
  chat.appendChild(status);
  const resposta = addMsg("assistant");
  let texto = "";
  if (!cfg.key) {
    status.textContent = "Sem chave";
    addMsg("err", "Informe sua chave do Mangaba Router em ⚙️ Configurações.");
    agentRun = null;
    setStop(false);
    return;
  }
  try {
    const inst = await hermesInstalacao();
    const cabecalhos = { "Content-Type": "application/json", Authorization: "Bearer " + inst.chave };
    // a chave do Mangaba Router é do usuário: vai em cada turno e a ponte só a usa enquanto ele dura
    const fluxo = await fetch(hermesBase() + "/v1/chat/completions", {
      method: "POST",
      headers: { ...cabecalhos, "X-Mangaba-Key": cfg.key || "" },
      body: JSON.stringify({ model: "hermes-agent", messages: [{ role: "user", content: task + (await contextoDaAba()) + contextoDosDados() }], stream: true }),
      signal: agentRun.abort.signal,
    });
    if (!fluxo.ok) throw new Error(`Hermes respondeu ${fluxo.status}`);

    for await (const quadro of lerSSEHermes(fluxo.body)) {
      if (quadro.evento === "navegador.acao") {
        // sequencial de propósito: a próxima ação depende do que esta encontrou na página
        const acao = JSON.parse(quadro.dados);
        const saida = await executarAcaoHermes(acao);
        await fetch(hermesBase() + "/navegador/resultado", {
          method: "POST",
          headers: cabecalhos,
          body: JSON.stringify({ id: acao.id, saida: String(saida).slice(0, 60000) }),
        });
        continue;
      }
      if (quadro.evento === "erro") throw new Error(JSON.parse(quadro.dados).erro);
      if (quadro.dados === "[DONE]") break;
      try {
        const pedaco = JSON.parse(quadro.dados).choices?.[0]?.delta?.content;
        if (pedaco) { texto += pedaco; setAssistant(resposta, texto); }
      } catch { /* keepalive */ }
    }
    status.textContent = "Concluído (Hermes)";
  } catch (e) {
    status.textContent = "Erro (Hermes)";
    if (e.name !== "AbortError") addMsg("err", "Hermes: " + e.message);
  } finally {
    agentRun = null;
    setStop(false);
  }
}
