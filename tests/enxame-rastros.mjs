// Enxame de setas com rastros: três movimentos de um agente deixam linhas e fantasmas.
// Rodar com: node tests/enxame-rastros.mjs <arquivo.png>
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { abrirChrome, espera } from "./chrome-teste.mjs";

const saida = process.argv[2] || "enxame.png";
const c = await abrirChrome("https://httpbin.org/forms/post");
try {
  await espera(1500);
  await c.acao("snapshot");
  const janela = await c.painel.avaliar(`chrome.windows.getAll({ populate: true }).then((ws) => ws.find((w) => w.tabs.some((t) => t.id && !t.url.startsWith("chrome-extension://"))).id)`);
  for (const [i, t] of [[0, "Ana"], [1, "8299"], [2, "ana@exemplo.com"]]) {
    await c.painel.avaliar(`chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: "digitar", args: { i: ${i}, texto: ${JSON.stringify(t)} }, windowId: ${janela}, agente: "Enxame" })`);
    await espera(120);
  }
  const rastros = await c.naPagina(`document.getElementById("__mangaba_seta_Enxame").shadowRoot.querySelectorAll(".rastro").length`);
  const fantasmas = await c.naPagina(`document.getElementById("__mangaba_seta_Enxame").shadowRoot.querySelectorAll(".fantasma").length`);
  assert.ok(rastros >= 2, `esperava rastros, achei ${rastros}`);
  assert.ok(fantasmas >= 1, `esperava fantasmas do enxame, achei ${fantasmas}`);
  const cap = await c.pagina.enviar("Page.captureScreenshot", { format: "png" });
  writeFileSync(saida, Buffer.from(cap.result.data, "base64"));
  console.log(`OK: ${rastros} rastros e ${fantasmas} fantasmas; captura em`, saida);
} finally {
  await c.fechar?.();
}
