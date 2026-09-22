// ---- MODO OFFLINE v2.0.0 ----
// Agente local via llama.cpp (Qwen 1B quantizado)
// Tool-calling nativo: agente pode chamar browser tools diretamente

const OFFLINE_CONFIG = {
  enabled: false,
  model_url: "http://localhost:8778",  // llama.cpp padrão
  model_name: "qwen-1b-q8",
  max_tokens: 500,
  temperature: 0.3,
  timeout: 30000
};

let offlineMode = false;
let localModel = null;

// Detectar llama.cpp disponível
async function detectOfflineModel() {
  try {
    const resp = await fetch(`${OFFLINE_CONFIG.model_url}/v1/models`, {
      timeout: 3000
    });
    if (resp.ok) {
      const data = await resp.json();
      offlineMode = data.data?.length > 0;
      return offlineMode;
    }
  } catch { }
  return false;
}

// Tool-calling loop local: agente chama tools, executa, itera
async function runOfflineAgent(task, tools_available) {
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
      const resp = await fetch(`${OFFLINE_CONFIG.model_url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OFFLINE_CONFIG.model_name,
          messages,
          max_tokens: OFFLINE_CONFIG.max_tokens,
          temperature: OFFLINE_CONFIG.temperature,
          tools: tools_available  // Schema de ferramentas em JSON Schema
        })
      });

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

// Hook no background.js para suportar offline
// Modificar handler de AGENT_TOOL para rotear offline quando mode ativo
async function handleOfflineTool(tool, args) {
  // Encaminhar ao offline agent loop
  // Implementar no background.js message handler
  return { ok: false, error: "offline tool routing não implementado" };
}

// Esquema de ferramentas em JSON Schema (para tool-calling)
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

// Ativar/desativar modo offline
async function toggleOfflineMode(enable) {
  if (enable) {
    const available = await detectOfflineModel();
    if (!available) {
      throw new Error("llama.cpp não encontrado em localhost:8778");
    }
    offlineMode = true;
    OFFLINE_CONFIG.enabled = true;
  } else {
    offlineMode = false;
    OFFLINE_CONFIG.enabled = false;
  }
}
