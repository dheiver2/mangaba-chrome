// ---- MODO OFFLINE v2.1.0 ----
// Dois provedores de IA local, sem depender do gateway:
// - "llamacpp": servidor externo em localhost:8778 (já exigia setup prévio do usuário)
// - "webllm": modelo rodando DENTRO do navegador via WebGPU (@mlc-ai/web-llm, vendorizada
//   em lib/web-llm.js — Manifest V3 proíbe código remotamente hospedado, então a lib em si
//   vem junto da extensão; só os PESOS do modelo são baixados sob demanda do Hugging Face
//   na primeira vez e ficam em cache do navegador depois). Zero setup externo.
// Tool-calling: só llama.cpp usa o formato nativo `tools` da API; o WebLLM usa o mesmo
// padrão "responda com um JSON de ação" do modo agente principal, porque o modelo pequeno
// (Llama-3.2-1B) não está na lista de modelos com function-calling nativo do WebLLM.

const OFFLINE_CONFIG = {
  enabled: false,
  provider: "llamacpp",  // "llamacpp" | "webllm"
  model_url: "http://localhost:8778",  // llama.cpp padrão
  model_name: "qwen-1b-q8",
  webllm_model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  max_tokens: 500,
  temperature: 0.3,
  timeout: 30000
};

let offlineMode = false;
let localModel = null;

// fetch() nativo não tem opção "timeout" (é ignorada silenciosamente) — sem isto,
// um llama.cpp travado ou ausente deixa a chamada pendurada em vez de falhar rápido.
function offlineFetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .catch((e) => { if (timedOut) throw new Error(`timeout após ${ms / 1000}s`); throw e; })
    .finally(() => clearTimeout(timer));
}

// ---- Dispatchers: escolhem o provedor configurado ----

async function detectOfflineModel() {
  return OFFLINE_CONFIG.provider === "webllm" ? detectWebLLM() : detectLlamaCpp();
}

async function runOfflineAgent(task, tools_available) {
  return OFFLINE_CONFIG.provider === "webllm"
    ? runOfflineAgentWebLLM(task, tools_available)
    : runOfflineAgentLlamaCpp(task, tools_available);
}

// Ativar/desativar modo offline (onProgress só é usado pelo provedor webllm, no download do modelo)
async function toggleOfflineMode(enable, onProgress) {
  if (!enable) {
    offlineMode = false;
    OFFLINE_CONFIG.enabled = false;
    return;
  }
  const available = await detectOfflineModel();
  if (!available) {
    if (OFFLINE_CONFIG.provider === "webllm") {
      throw new Error(typeof navigator !== "undefined" && navigator.gpu
        ? "Falha ao preparar o modelo no navegador (veja o console)"
        : "Este navegador não suporta WebGPU — o modo WebLLM não funciona aqui. Use o llama.cpp ou um Chrome/Edge recente.");
    }
    throw new Error("llama.cpp não encontrado em localhost:8778");
  }
  offlineMode = true;
  OFFLINE_CONFIG.enabled = true;
}

// ================= Provedor: llama.cpp (servidor externo) =================

async function detectLlamaCpp() {
  try {
    const resp = await offlineFetchWithTimeout(`${OFFLINE_CONFIG.model_url}/v1/models`, {}, 3000);
    if (resp.ok) {
      const data = await resp.json();
      return data.data?.length > 0;
    }
  } catch { }
  return false;
}

// Tool-calling loop local: agente chama tools, executa, itera
async function runOfflineAgentLlamaCpp(task, tools_available) {
  const messages = [
    {
      role: "system",
      content: `Você é agente autônomo offline da Mangaba AI. Você tem acesso a ferramentas do navegador para:
- Navegar: navegar, nova_aba, voltar, avancar, fechar_aba
- Agir: clicar, digitar, preencher, selecionar, marcar, curtir
- Observar: olhar, ler, snapshot, formulario, links
- Esperar: esperar, esperar_por, aguarda_carregamento
- Extrair: extrair, detectar_paginacao

Você é LOCAL (sem internet) — use APENAS ferramentas do navegador da aba ativa.
Não especule sobre dados externos. Se precisar de internet, diga "preciso de conexão".

Tarefa: ${task}

Quando terminar, use "concluir" com o resultado.`
    },
    { role: "user", content: task }
  ];

  let step = 0;
  const MAX_STEPS = 20;

  while (step < MAX_STEPS) {
    step++;

    try {
      // Chamar modelo local
      const resp = await offlineFetchWithTimeout(`${OFFLINE_CONFIG.model_url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OFFLINE_CONFIG.model_name,
          messages,
          max_tokens: OFFLINE_CONFIG.max_tokens,
          temperature: OFFLINE_CONFIG.temperature,
          tools: tools_available  // Schema de ferramentas em JSON Schema
        })
      }, OFFLINE_CONFIG.timeout);

      if (!resp.ok) {
        throw new Error(`Modelo offline indisponível: ${resp.status}`);
      }

      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice) break;

      // Verificar se há tool_calls
      if (choice.message?.tool_calls?.length) {
        const tool_calls = choice.message.tool_calls;

        for (const call of tool_calls) {
          const tool_name = call.function.name;
          const tool_args = JSON.parse(call.function.arguments || "{}");

          // Executar ferramenta via chrome.runtime.sendMessage
          let tool_result = null;
          try {
            tool_result = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { type: "OFFLINE_TOOL", tool: tool_name, args: tool_args },
                (response) => resolve(response)
              );
            });
          } catch (e) {
            tool_result = { ok: false, error: e.message };
          }

          // Adicionar resultado ao histórico
          messages.push({
            role: "assistant",
            content: choice.message.content || "",
            tool_calls
          });
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_result",
              tool_use_id: call.id,
              content: tool_result.ok
                ? String(tool_result.out).slice(0, 2000)
                : `ERRO: ${tool_result.error}`
            })
          });
        }
      } else {
        // Resposta final sem tool_calls
        const content = choice.message?.content || "";

        if (content.includes("concluir") || content.includes("fim") || step >= MAX_STEPS) {
          return {
            ok: true,
            result: content,
            steps: step
          };
        }

        messages.push({
          role: "assistant",
          content
        });
      }
    } catch (e) {
      return {
        ok: false,
        error: e.message,
        steps: step
      };
    }
  }

  return {
    ok: false,
    error: `Excedeu ${MAX_STEPS} passos`,
    steps: step
  };
}

// Esquema de ferramentas em JSON Schema (usado pelo provedor llama.cpp, que aceita `tools` nativo)
const TOOLS_SCHEMA = [
  {
    type: "function",
    function: {
      name: "navegar",
      description: "Navega para uma URL",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clicar",
      description: "Clica em elemento pelo índice",
      parameters: {
        type: "object",
        properties: { i: { type: "number" } },
        required: ["i"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "digitar",
      description: "Digita texto em campo",
      parameters: {
        type: "object",
        properties: {
          i: { type: "number" },
          texto: { type: "string" }
        },
        required: ["i", "texto"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "snapshot",
      description: "Captura snapshot da página",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "concluir",
      description: "Concluir tarefa e retornar resultado",
      parameters: {
        type: "object",
        properties: { resposta: { type: "string" } },
        required: ["resposta"]
      }
    }
  }
];

// ================= Provedor: WebLLM (WebGPU, dentro do navegador) =================

let webllmEngine = null;
let webllmModulePromise = null;
let webllmLoadingPromise = null;

async function detectWebLLM() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// Import dinâmico do módulo local vendorizado — nunca de CDN: MV3 proíbe código remoto.
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

// Extrai o primeiro objeto JSON balanceado de um texto (versão simples e isolada de
// parseAction do sidepanel.js — não reaproveitamos aquela porque offline.js carrega antes
// dela no HTML, e este uso não precisa do suporte a lotes/thinking-tags que ela trata).
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

// Llama-3.2-1B não tem function-calling nativo no WebLLM — documenta as ferramentas como
// texto no prompt (mesmo padrão do modo agente principal) em vez de usar `tools` da API.
function toolsSchemaToPromptDoc(tools) {
  return tools.map((t) => {
    const f = t.function;
    const props = f.parameters?.properties ? Object.keys(f.parameters.properties) : [];
    const argsExample = props.length ? `{${props.map((p) => `"${p}":...`).join(",")}}` : "{}";
    return `{"tool":"${f.name}","args":${argsExample}} — ${f.description}`;
  }).join("\n");
}

async function runOfflineAgentWebLLM(task, tools_available, onProgress) {
  const engine = await ensureWebLLMEngine(onProgress);
  const toolsDoc = toolsSchemaToPromptDoc(tools_available || TOOLS_SCHEMA);

  const messages = [
    {
      role: "system",
      content: `Você é agente autônomo offline da Mangaba AI, rodando localmente no navegador (WebLLM).
Responda SEMPRE com um único objeto JSON de ação, sem texto fora dele:
${toolsDoc}

Você é LOCAL — use APENAS as ferramentas acima na aba ativa. Tarefa: ${task}
Quando terminar, responda {"tool":"concluir","args":{"resposta":"..."}}.`
    },
    { role: "user", content: task }
  ];

  const MAX_STEPS = 20;
  for (let step = 1; step <= MAX_STEPS; step++) {
    let content;
    try {
      const resp = await engine.chat.completions.create({
        messages,
        max_tokens: OFFLINE_CONFIG.max_tokens,
        temperature: OFFLINE_CONFIG.temperature
      });
      content = resp.choices?.[0]?.message?.content || "";
    } catch (e) {
      return { ok: false, error: "WebLLM: " + e.message, steps: step };
    }

    const action = extractJsonAction(content);
    if (!action?.tool) {
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: 'Responda EXATAMENTE com {"tool":"nome","args":{...}}, sem texto fora do JSON.' });
      continue;
    }

    if (action.tool === "concluir") {
      return { ok: true, result: action.args?.resposta || content, steps: step };
    }

    let tool_result;
    try {
      tool_result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: action.tool, args: action.args || {} }, resolve);
      });
    } catch (e) {
      tool_result = { ok: false, error: e.message };
    }

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: tool_result?.ok
        ? `Resultado de "${action.tool}": ${String(tool_result.out).slice(0, 1500)}`
        : `ERRO em "${action.tool}": ${tool_result?.error || "?"}`
    });
  }

  return { ok: false, error: `Excedeu ${MAX_STEPS} passos`, steps: MAX_STEPS };
}
