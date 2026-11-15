// Duas ações ao mesmo tempo, de agentes diferentes: duas setas na página, cada uma com o seu nome.
// Rodar com: node tests/setas-paralelas.mjs <arquivo.png>
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { abrirChrome, espera } from "./chrome-teste.mjs";

const saida = process.argv[2] || "setas-paralelas.png";
const c = await abrirChrome("https://httpbin.org/forms/post");
try {
  await espera(1500);
  await c.acao("snapshot");
  const janela = await c.painel.avaliar(`chrome.windows.getAll({ populate: true }).then((ws) => ws.find((w) => w.tabs.some((t) => t.id && !t.url.startsWith("chrome-extension://"))).id)`);
  const envia = (agente, i, texto) => c.painel.avaliar(`chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: "digitar", args: { i: ${i}, texto: ${JSON.stringify(texto)} }, windowId: ${janela}, agente: ${JSON.stringify(agente)} })`);
  const resultados = await Promise.all([envia("Pesquisador", 0, "Ana"), envia("Preenchedor", 1, "8299")]);
  console.log("   ↳", resultados.map((r) => String(r?.out ?? r?.error ?? JSON.stringify(r)).slice(0, 60)).join(" | "));
  await espera(300);
  const duas = await c.naPagina(`["__mangaba_seta_Pesquisador","__mangaba_seta_Preenchedor"].map((id) => !!document.getElementById(id))`);
  assert.deepEqual(duas, [true, true], "as duas setas precisam existir");
  const cap = await c.pagina.enviar("Page.captureScreenshot", { format: "png" });
  writeFileSync(saida, Buffer.from(cap.result.data, "base64"));
  console.log("OK: duas setas simultâneas; captura em", saida);
} finally {
  await c.fechar?.();
}
