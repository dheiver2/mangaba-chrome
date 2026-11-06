// Bateria no painel real (Chrome isolado, extensão de dist/, servidor de produção).
// Gasta cota da chave. Rodar com: MANGABA_KEY=mr-... node tests/bateria-painel.mjs
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, espera } from "./chrome-teste.mjs";

const CHAVE = process.env.MANGABA_KEY;
if (!CHAVE) { console.error("defina MANGABA_KEY"); process.exit(2); }

async function preparar(c, motor) {
  await c.painel.avaliar(`(async () => {
    const ws = await chrome.windows.getAll({ populate: true });
    myWindowId = ws.find((w) => w.tabs.some((t) => !t.url.startsWith("chrome-extension://"))).id;
    cfg.key = ${JSON.stringify(CHAVE)};
    cfg.motor = ${JSON.stringify(motor)};
    document.getElementById("chat").innerHTML = "";
    return true;
  })()`);
}

async function tarefa(c, texto, limiteMs = 240000) {
  await c.painel.avaliar(`(() => { runHermes(${JSON.stringify(texto)}); return true; })()`);
  const inicio = Date.now();
  await espera(1500);
  while (Date.now() - inicio < limiteMs) {
    if (await c.painel.avaliar("agentRun === null")) break;
    await espera(500);
  }
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  const r = await c.painel.avaliar(`JSON.stringify({
    resposta: [...document.querySelectorAll(".msg.assistant, .assistant")].map((e) => e.innerText).join("\\n").slice(-800),
    erros: [...document.querySelectorAll(".msg.err, .err")].map((e) => e.innerText).join(" | "),
  })`).then(JSON.parse);
  return { ...r, segundos };
}

const c = await abrirChrome("https://example.com/");
let falhas = 1;
try {
  falhas = await rodarCasos([
    ["motor hermes: lê a página e responde", async () => {
      await preparar(c, "hermes");
      const r = await tarefa(c, "Leia esta página e me diga em uma frase qual é o título dela.");
      console.log(`   ↳ ${r.segundos}s · ${r.resposta.slice(0, 120).replace(/\n/g, " ")}`);
      assert.equal(r.erros, "", r.erros);
      assert.match(r.resposta, /example/i);
    }],
    ["motor claude: lê a página e responde (3 vezes)", async () => {
      await preparar(c, "claude");
      const tempos = [];
      for (let i = 0; i < 3; i++) {
        const r = await tarefa(c, "Leia esta página e me diga em uma frase qual é o título dela.");
        console.log(`   ↳ rodada ${i + 1}: ${r.segundos}s`);
        assert.equal(r.erros, "", r.erros);
        assert.match(r.resposta, /example/i);
        tempos.push(Number(r.segundos));
      }
      console.log(`   ↳ tempos: ${tempos.join(", ")}`);
    }],
    ["motor codex: lê a página e responde", async () => {
      await preparar(c, "codex");
      const r = await tarefa(c, "Leia esta página e me diga em uma frase qual é o título dela.");
      console.log(`   ↳ ${r.segundos}s · ${r.resposta.slice(0, 120).replace(/\n/g, " ")}`);
      assert.equal(r.erros, "", r.erros);
      assert.match(r.resposta, /example/i);
    }],
    ["aviso antes da primeira tarefa aparece uma vez e a segunda envia", async () => {
      await preparar(c, "hermes");
      const primeira = await c.painel.avaliar(`(async () => {
        document.getElementById("input").value = "Leia esta página.";
        send();
        await new Promise((r) => setTimeout(r, 800));
        return [...document.querySelectorAll(".msg.assistant, .assistant")].map((e) => e.innerText).join(" ");
      })()`);
      assert.match(primeira, /Antes da primeira tarefa/);
      await espera(1000);
      const segunda = await c.painel.avaliar(`(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        document.getElementById("input").value = "Leia esta página.";
        send();
        await new Promise((r) => setTimeout(r, 800));
        return agentRun !== null;
      })()`);
      assert.equal(segunda, true, "a segunda tarefa não começou");
    }],
  ]);
} finally {
  await c.fechar?.();
}
process.exit(falhas ? 1 : 0);
