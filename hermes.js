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
  if (!resposta.ok) throw new Error(`could not register with Hermes (${resposta.status})`);
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

// Com "Ler a página aberta" ligado, o texto da aba vai junto com o pedido: o agente já começa
// sabendo o que o usuário está vendo, sem precisar decidir ler primeiro.
async function textoDaAba() {
  if (cfg.lerPagina === false) return "";
  const r = await tool("ler", {}).catch(() => null);
  if (!r?.ok || !r.out?.trim()) return "";
  return esconderValores(`\n\n[conteúdo da aba atual, já lido pela extensão]\n${r.out}\n[fim do conteúdo da aba]`, meusDados());
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
    addMsg("assistant", "❓ " + (args.pergunta || "I need some information from you to continue."));
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
  const r = await tool(acao.tool, comValores, acao.agente);
  // saída que não é texto (ex.: lista de elementos do snapshot) vai como JSON, não "[object Object]"
  const saida = typeof r.out === "string" ? r.out : r.out == null ? "ok" : JSON.stringify(r.out);
  return esconderValores(r.ok ? saida : "erro: " + (r.error || "falhou"), dados);
}

// ---- Canal do painel ----
// Com o painel aberto, a ponte pode mandar ações de clientes MCP externos (Claude Code,
// Codex) mesmo sem uma conversa em curso. O canal é este stream; ele reconecta sozinho
// e cai quando o painel fecha, o que faz o cliente externo ver "painel não aberto".
let canalHermes = null;

async function abrirCanalHermes() {
  if (canalHermes) return;
  const controle = new AbortController();
  canalHermes = controle;
  (async () => {
    while (canalHermes === controle) {
      try {
        const inst = await hermesInstalacao();
        const cabecalhos = { Authorization: "Bearer " + inst.chave };
        // a chave do Router vai só para o Jev decidir ações sensíveis; a ponte não a guarda
        const resposta = await fetch(hermesBase() + "/navegador/canal", {
          headers: { ...cabecalhos, "X-Mangaba-Key": cfg.key || "" },
          signal: controle.signal,
        });
        if (!resposta.ok) throw new Error(`canal respondeu ${resposta.status}`);
        for await (const quadro of lerSSEHermes(resposta.body)) {
          if (quadro.evento !== "navegador.acao") continue;
          devolverAcao(JSON.parse(quadro.dados), { "Content-Type": "application/json", ...cabecalhos });
        }
      } catch (_) { /* rede caiu ou painel fechou: tenta de novo abaixo */ }
      if (canalHermes !== controle) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();
}

function fecharCanalHermes() {
  if (canalHermes) canalHermes.abort();
  canalHermes = null;
}

// Executa uma ação e devolve o texto à ponte. Não espera a anterior terminar: ações de agentes
// diferentes correm juntas, cada uma com a sua seta.
function devolverAcao(acao, cabecalhos) {
  executarAcaoHermes(acao)
    .then((saida) => fetch(hermesBase() + "/navegador/resultado", {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ id: acao.id, saida: String(saida).slice(0, 60000) }),
    }))
    .catch(() => { /* a ponte já devolveu timeout para esta ação */ });
}

const erroHermes = (msg, chaveRecusada) => Object.assign(new Error(msg), { chaveRecusada });

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
    status.textContent = "No key";
    addMsg("err", "Connect your Mangaba Router key to continue.");
    agentRun = null;
    setStop(false);
    return;
  }
  try {
    if (cfg.lerPagina !== false) status.textContent = "Reading the page...";
    const pagina = await textoDaAba();
    status.textContent = "Hermes pensando...";
    const inst = await hermesInstalacao();
    const cabecalhos = { "Content-Type": "application/json", Authorization: "Bearer " + inst.chave };
    // a chave do Mangaba Router é do usuário: vai em cada turno e a ponte só a usa enquanto ele dura
    const fluxo = await fetch(hermesBase() + "/v1/chat/completions", {
      method: "POST",
      headers: { ...cabecalhos, "X-Mangaba-Key": cfg.key || "" },
      body: JSON.stringify({ model: "hermes-agent", messages: [{ role: "user", content: task + (await contextoDaAba()) + pagina + contextoDosDados() }], stream: true }),
      signal: agentRun.abort.signal,
    });
    if (!fluxo.ok) {
      const corpo = await fluxo.json().catch(() => ({}));
      throw erroHermes(corpo.erro || `Hermes respondeu ${fluxo.status}`, fluxo.status === 401 && /Mangaba Router/.test(corpo.erro || ""));
    }

    for await (const quadro of lerSSEHermes(fluxo.body)) {
      if (quadro.evento === "navegador.acao") {
        // em paralelo: cada ação tem a sua seta e devolve o resultado quando termina
        devolverAcao(JSON.parse(quadro.dados), cabecalhos);
        continue;
      }
      if (quadro.evento === "erro") {
        const erro = JSON.parse(quadro.dados).erro || "";
        throw erroHermes(erro, /^chave do Mangaba Router recusada/.test(erro));
      }
      if (quadro.dados === "[DONE]") break;
      try {
        const pedaco = JSON.parse(quadro.dados).choices?.[0]?.delta?.content;
        if (pedaco) { texto += pedaco; setAssistant(resposta, texto); }
      } catch { /* keepalive */ }
    }
    status.textContent = "Done (Hermes)";
  } catch (e) {
    status.textContent = "Error (Hermes)";
    if (e.name !== "AbortError") addMsg("err", "Hermes: " + e.message);
    // a ponte avisa quando o Router recusou a chave: volta para a tela da chave
    if (e.chaveRecusada && typeof chaveRouterRecusada === "function") chaveRouterRecusada(e.message);
  } finally {
    agentRun = null;
    setStop(false);
  }
}
