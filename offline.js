// ---- MODO OFFLINE v3.0.0 — só WebLLM (WebGPU, dentro do navegador) ----
// Zero setup externo: o modelo roda no próprio navegador, sem servidor (llama.cpp removido).
// Manifest V3 proíbe código remotamente hospedado, então a lib @mlc-ai/web-llm vem vendorizada
// em lib/web-llm.js; só os PESOS do modelo são baixados do Hugging Face na 1ª vez e ficam em
// cache do navegador depois.
//
// Modelo: Hermes-2-Pro-Mistral-7B-q4f16_1-MLC. É o único, dentre os modelos com tool-calling
// nativo suportados pelo WebLLM hoje, confirmado confiável (outros retornam tool_calls vazio;
// só Hermes-2-Pro produz o JSON estruturado corretamente — issue mlc-ai/web-llm#712). Modelos
// Hermes-3 têm suporte "beta"/instável para isso no momento.
//
// Limitação conhecida da lib: não é possível combinar `system` role com `tools` de forma
// confiável (ela injeta seu próprio prompt de tool-calling e o nosso é ignorado/sobrescrito).
// Por isso as instruções da tarefa vão na primeira mensagem "user", não em "system".

const OFFLINE_CONFIG = {
  enabled: false,
  webllm_model: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC",
  max_tokens: 600,
  temperature: 0.2
};

let offlineMode = false;
let webllmEngine = null;
let webllmModulePromise = null;
let webllmLoadingPromise = null;

async function detectOfflineModel() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// Import dinâmico do módulo local vendorizado — nunca de CDN: MV3 proíbe código remoto.
// Página própria da extensão (side panel): não precisa de web_accessible_resources.
function loadWebLLMModule() {
  if (!webllmModulePromise) {
    webllmModulePromise = import(chrome.runtime.getURL("lib/web-llm.js"));
  }
  return webllmModulePromise;
}

// Cria (ou reaproveita) a engine. onProgress recebe {progress: 0-1, text} durante o
// download/carregamento do modelo — só acontece de fato na primeira vez (fica em cache depois).
async function ensureWebLLMEngine(onProgress) {
  if (webllmEngine) return webllmEngine;
  if (webllmLoadingPromise) return webllmLoadingPromise;

  webllmLoadingPromise = (async () => {
    const webllm = await loadWebLLMModule();
    const engine = await webllm.CreateMLCEngine(OFFLINE_CONFIG.webllm_model, {
      initProgressCallback: (report) => { if (onProgress) onProgress(report); }
    });
    webllmEngine = engine;
    return engine;
  })();

  try {
    return await webllmLoadingPromise;
  } finally {
    webllmLoadingPromise = null;
  }
}

// Ativar/desativar modo offline. Ativar já prepara a engine (baixa o modelo se preciso),
// para falhar cedo com uma mensagem clara em vez de só na primeira tarefa.
async function toggleOfflineMode(enable, onProgress) {
  if (!enable) {
    offlineMode = false;
    OFFLINE_CONFIG.enabled = false;
    return;
  }
  if (!(typeof navigator !== "undefined" && navigator.gpu)) {
    throw new Error("Este navegador não suporta WebGPU — necessário para o modo offline. Use um Chrome/Edge recente.");
  }
  await ensureWebLLMEngine(onProgress);
  offlineMode = true;
  OFFLINE_CONFIG.enabled = true;
}

// Extrai o primeiro objeto JSON balanceado de um texto — usado só como rede de segurança
// quando o modelo não preenche tool_calls estruturado mas escreve o JSON como texto solto.
function extractJsonAction(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Conjunto de ferramentas em JSON Schema (formato OpenAI `tools`) — cobre o essencial do
// modo agente principal para o modelo local ter capacidade real, não só um punhado de ações.
const TOOLS_SCHEMA = [
  { type: "function", function: { name: "navegar", description: "Navega para uma URL na aba atual", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "voltar", description: "Volta à página anterior", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "clicar", description: "Clica no elemento de índice [i] do snapshot", parameters: { type: "object", properties: { i: { type: "number" } }, required: ["i"] } } },
  { type: "function", function: { name: "clicar_texto", description: "Clica no elemento clicável cujo texto visível corresponde", parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } } },
  { type: "function", function: { name: "digitar", description: "Escreve texto no campo de índice [i]", parameters: { type: "object", properties: { i: { type: "number" }, texto: { type: "string" } }, required: ["i", "texto"] } } },
  { type: "function", function: { name: "tecla", description: "Pressiona uma tecla no campo [i] (ex.: Enter para enviar busca/formulário)", parameters: { type: "object", properties: { i: { type: "number" }, tecla: { type: "string" } }, required: ["i"] } } },
  { type: "function", function: { name: "rolar_ate", description: "Rola a página até o trecho que contém esse texto", parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } } },
  { type: "function", function: { name: "rolar_fim", description: "Rola até o fim da página (dispara carregamento preguiçoso de listas)", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "esperar_por", description: "Aguarda até um texto aparecer na página (até 15s)", parameters: { type: "object", properties: { texto: { type: "string" }, segundos: { type: "number" } }, required: ["texto"] } } },
  { type: "function", function: { name: "ler", description: "Obtém todo o texto da página atual de uma vez (não precisa rolar antes)", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "links", description: "Lista os links visíveis da página (texto → URL)", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "extrair", description: "Extrai dados específicos do texto da página, de forma estruturada", parameters: { type: "object", properties: { o_que: { type: "string" } }, required: ["o_que"] } } },
  { type: "function", function: { name: "formulario", description: "Mapeia os campos do formulário da página (rótulos, tipos, opções)", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "preencher", description: "Preenche vários campos de texto de uma vez", parameters: { type: "object", properties: { campos: { type: "array", items: { type: "object", properties: { i: { type: "number" }, texto: { type: "string" } } } } }, required: ["campos"] } } },
  { type: "function", function: { name: "selecionar", description: "Escolhe uma opção em um dropdown (select)", parameters: { type: "object", properties: { i: { type: "number" }, opcao: { type: "string" } }, required: ["i", "opcao"] } } },
  { type: "function", function: { name: "marcar", description: "Marca ou desmarca um checkbox/radio", parameters: { type: "object", properties: { i: { type: "number" }, valor: { type: "boolean" } }, required: ["i", "valor"] } } },
  { type: "function", function: { name: "snapshot", description: "Captura os elementos interativos da página atual", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "agora", description: "Obtém a data e hora atuais", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "concluir", description: "Termina a tarefa e devolve o resultado ao usuário", parameters: { type: "object", properties: { resposta: { type: "string" } }, required: ["resposta"] } } }
];

// Loop de tool-calling nativo do WebLLM: o modelo escolhe uma ferramenta a cada resposta
// (choice.message.tool_calls), executamos via o mesmo canal AGENT_TOOL do modo principal,
// devolvemos o resultado como mensagem role "tool", e repetimos até "concluir" ou o limite.
async function runOfflineAgent(task, tools_available, onProgress) {
  const engine = await ensureWebLLMEngine(onProgress);
  const tools = tools_available?.length ? tools_available : TOOLS_SCHEMA;

  const messages = [
    {
      role: "user",
      content: `Você é um agente autônomo controlando um navegador, rodando LOCALMENTE (sem internet além da aba ativa). Trabalhe só com as ferramentas fornecidas, uma de cada vez. Tarefa: ${task}\n\nQuando terminar, chame a ferramenta "concluir" com o resultado.`
    }
  ];

  const MAX_STEPS = 20;
  for (let step = 1; step <= MAX_STEPS; step++) {
    let resp;
    try {
      resp = await engine.chat.completions.create({
        messages,
        tools,
        max_tokens: OFFLINE_CONFIG.max_tokens,
        temperature: OFFLINE_CONFIG.temperature
      });
    } catch (e) {
      return { ok: false, error: "WebLLM: " + e.message, steps: step };
    }

    const choice = resp.choices?.[0];
    if (!choice) return { ok: false, error: "WebLLM não retornou resposta", steps: step };

    let toolCalls = choice.message?.tool_calls;

    // Rede de segurança: se o modelo não preencheu tool_calls estruturado mas escreveu
    // o JSON como texto solto no content, tenta extrair manualmente antes de desistir do passo.
    if (!toolCalls?.length && choice.message?.content) {
      const manual = extractJsonAction(choice.message.content);
      if (manual?.tool) {
        toolCalls = [{ id: `manual-${step}`, function: { name: manual.tool, arguments: JSON.stringify(manual.args || {}) } }];
      }
    }

    if (!toolCalls?.length) {
      messages.push({ role: "assistant", content: choice.message?.content || "" });
      messages.push({ role: "user", content: 'Chame uma ferramenta (tool calling), ou "concluir" se já terminou. Não responda só texto.' });
      continue;
    }

    messages.push({ role: "assistant", content: choice.message?.content || "", tool_calls: toolCalls });

    let concluido = null;
    for (const call of toolCalls) {
      const toolName = call.function.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(call.function.arguments || "{}"); } catch { /* args malformados: segue com {} */ }

      if (toolName === "concluir") {
        concluido = toolArgs.resposta || "Tarefa concluída.";
        break;
      }

      let toolResult;
      try {
        toolResult = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: toolName, args: toolArgs, windowId: typeof myWindowId !== "undefined" ? myWindowId : undefined }, resolve);
        });
      } catch (e) {
        toolResult = { ok: false, error: e.message };
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult?.ok ? String(toolResult.out).slice(0, 1500) : `ERRO: ${toolResult?.error || "?"}`
      });
    }

    if (concluido !== null) return { ok: true, result: concluido, steps: step };
  }

  return { ok: false, error: `Excedeu ${MAX_STEPS} passos`, steps: MAX_STEPS };
}
