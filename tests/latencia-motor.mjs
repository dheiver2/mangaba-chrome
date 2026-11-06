// Latência de ponta a ponta de um motor, com o painel real num Chrome isolado.
// Mede o tempo entre pedir a tarefa e o fim do turno. Gasta cota da chave. Rodar com:
//   MANGABA_KEY=mr-... MOTOR=claude node tests/latencia-motor.mjs
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, espera } from "./chrome-teste.mjs";

const CHAVE = process.env.MANGABA_KEY;
const MOTOR = process.env.MOTOR || "claude";
if (!CHAVE) { console.error("defina MANGABA_KEY"); process.exit(2); }

async function tarefa(c, texto, limiteMs = 240000) {
  await c.painel.avaliar(`(async () => {
    const ws = await chrome.windows.getAll({ populate: true });
    myWindowId = ws.find((w) => w.tabs.some((t) => !t.url.startsWith("chrome-extension://"))).id;
    cfg.key = ${JSON.stringify(CHAVE)};
    cfg.motor = ${JSON.stringify(MOTOR)};
    document.getElementById("chat").innerHTML = "";
    window.__inicio = Date.now();
    runHermes(${JSON.stringify(texto)});
    return true;
  })()`);
  const inicio = Date.now();
  await espera(1500);
  while (Date.now() - inicio < limiteMs) {
    if (await c.painel.avaliar("agentRun === null")) break;
    await espera(500);
  }
  const fim = Date.now();
  const r = await c.painel.avaliar(`JSON.stringify({
    resposta: [...document.querySelectorAll(".msg.assistant, .assistant")].map((e) => e.innerText).join("\\n").slice(-800),
    erros: [...document.querySelectorAll(".msg.err, .err")].map((e) => e.innerText).join(" | "),
  })`).then(JSON.parse);
  return { ...r, segundos: ((fim - inicio) / 1000).toFixed(1) };
}

const c = await abrirChrome("https://example.com/");
let falhas = 1;
try {
  falhas = await rodarCasos([
    [`motor ${MOTOR}: lê a página e responde`, async () => {
      const r = await tarefa(c, "Leia esta página e me diga em uma frase qual é o título dela.");
      console.log(`   ↳ ${r.segundos}s · ${r.resposta.slice(0, 160).replace(/\n/g, " ")}`);
      assert.equal(r.erros, "", r.erros);
      assert.match(r.resposta, /example/i);
    }],
  ]);
} finally {
  await c.fechar?.();
}
process.exit(falhas ? 1 : 0);
