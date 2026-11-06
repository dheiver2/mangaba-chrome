// Caso isolado: o aviso antes da primeira tarefa aparece e a segunda tarefa envia.
// Rodar com: MANGABA_KEY=mr-... node tests/aviso-primeira.mjs
import assert from "node:assert/strict";
import { abrirChrome, espera } from "./chrome-teste.mjs";

const CHAVE = process.env.MANGABA_KEY;
if (!CHAVE) { console.error("defina MANGABA_KEY"); process.exit(2); }

const c = await abrirChrome("https://example.com/");
try {
  await c.painel.avaliar(`(async () => {
    const ws = await chrome.windows.getAll({ populate: true });
    myWindowId = ws.find((w) => w.tabs.some((t) => !t.url.startsWith("chrome-extension://"))).id;
    cfg.key = ${JSON.stringify(CHAVE)};
    cfg.motor = "hermes";
    // sessão de teste só em memória: o aviso não fala com o servidor, então basta para este caso
    account = { token: "teste-local", user: { id: "teste-local", email: "teste@local" } };
    render();
    document.getElementById("chat").innerHTML = "";
    return { visto: localStorage.getItem("avisoEnvioVisto"), estado: estadoAcesso(account, cfg.key), agente: agentRun };
  })()`).then((x) => console.log("   estado inicial:", JSON.stringify(x)));

  const primeiraTela = await c.painel.avaliar(`(async () => {
    localStorage.removeItem("avisoEnvioVisto");
    input.value = "Leia esta página.";
    await send();
    await new Promise((r) => setTimeout(r, 1000));
    return JSON.stringify({ textos: [...document.querySelectorAll("#chat *")].map((e) => e.innerText).filter((t) => t && t.includes("Antes da primeira")).slice(0, 2), aviso: localStorage.getItem("avisoEnvioVisto"), campo: input.value });
  })()`);
  console.log("   primeira tentativa:", primeiraTela);
  assert.match(primeiraTela, /Antes da primeira tarefa/);
  console.log("OK: aviso exibido na primeira tentativa");
} finally {
  await c.fechar?.();
}
