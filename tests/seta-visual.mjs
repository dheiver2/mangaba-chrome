// Verifica a seta do agente na página real: a seta aparece, vai até o campo e fica visível.
// Salva uma captura. Rodar com: node tests/seta-visual.mjs <arquivo.png>
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { abrirChrome, espera } from "./chrome-teste.mjs";

const saida = process.argv[2] || "seta.png";
const c = await abrirChrome("https://httpbin.org/forms/post");
try {
  await espera(1500);
  await c.acao("snapshot");
  const r = await c.acao("digitar", { i: 0, texto: "Ana" });
  console.log("   ↳ ação:", String(r.out ?? r.error ?? JSON.stringify(r)).slice(0, 120));
  await espera(150);
  const existe = await c.naPagina(`!!document.getElementById("__mangaba_seta")`);
  assert.equal(existe, true, "a seta não foi desenhada na página");
  const cap = await c.pagina.enviar("Page.captureScreenshot", { format: "png" });
  writeFileSync(saida, Buffer.from(cap.result.data, "base64"));
  console.log("OK: seta desenhada; captura em", saida);
} finally {
  await c.fechar?.();
}
