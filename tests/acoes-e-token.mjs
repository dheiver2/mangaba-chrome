// Ações no painel real e token MCP de um cliente externo, contra o servidor de produção.
// Gasta cota da chave. Rodar com: MANGABA_KEY=mr-... node tests/acoes-e-token.mjs
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, espera } from "./chrome-teste.mjs";

const CHAVE = process.env.MANGABA_KEY;
const SERVIDOR = process.env.SERVIDOR || "https://hermes.mangaba.ia.br";
if (!CHAVE) { console.error("defina MANGABA_KEY"); process.exit(2); }

async function preparar(c, motor) {
  await c.painel.avaliar(`(async () => {
    const ws = await chrome.windows.getAll({ populate: true });
    myWindowId = ws.find((w) => w.tabs.some((t) => !t.url.startsWith("chrome-extension://"))).id;
    cfg.key = ${JSON.stringify(CHAVE)};
    cfg.motor = ${JSON.stringify(motor)};
    account = { token: "teste-local", user: { id: "teste-local", email: "teste@local" } };
    render();
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
  return c.painel.avaliar(`JSON.stringify({
    resposta: [...document.querySelectorAll(".msg.assistant, .assistant")].map((e) => e.innerText).join("\\n").slice(-800),
    erros: [...document.querySelectorAll(".msg.err, .err")].map((e) => e.innerText).join(" | "),
  })`).then(JSON.parse);
}

async function rpc(token, metodo, params) {
  const r = await fetch(`${SERVIDOR}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
  });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
}

let falhas = 1;
const c = await abrirChrome("https://httpbin.org/forms/post");
let token = "";
try {
  falhas = await rodarCasos([
    ["formulário: preenche e envia pelo painel (motor hermes)", async () => {
      await preparar(c, "hermes");
      const r = await tarefa(c, "Preencha o pedido desta página: nome Ana Souza, telefone 82999990000, e-mail ana@exemplo.com, tamanho Medium, coberturas Bacon e Onion, instruções de entrega 'Deixar na portaria'. Envie o pedido e confirme o que foi recebido.");
      console.log(`   ↳ ${r.resposta.slice(0, 160).replace(/\n/g, " ")}`);
      assert.equal(r.erros, "", r.erros);
      const pagina = String(await c.naPagina("document.body.innerText"));
      for (const v of ["Ana Souza", "82999990000", "ana@exemplo.com", "Deixar na portaria"])
        assert.ok(pagina.includes(v) || r.resposta.includes(v), `o pedido não tem "${v}"`);
    }],
    ["token gerado pelo painel: escopo de ações age na aba", async () => {
      await preparar(c, "hermes");
      // volta ao formulário: o caso anterior terminou na página de confirmação
      await c.naPagina("location.href = 'https://httpbin.org/forms/post'");
      await espera(3000);
      const instalacao = await c.painel.avaliar(`new Promise((r) => chrome.storage.local.get("hermes_instalacao", (v) => r(JSON.stringify(v.hermes_instalacao?.instalacao || null))))`);
      console.log(`   ↳ instalação do painel: ${instalacao}`);
      token = await c.painel.avaliar(`(async () => {
        document.getElementById("mcpEscopo").value = "acoes";
        document.getElementById("btnGerarToken").click();
        for (let i = 0; i < 40; i++) {
          const t = document.getElementById("mcpSaida").textContent.match(/mcp_[A-Za-z0-9_-]+/);
          if (t) return t[0];
          await new Promise((r) => setTimeout(r, 250));
        }
        return "";
      })()`);
      assert.match(token, /^mcp_/, "o painel não gerou o token");
      await espera(2000); // o canal do painel reconecta depois de gerar o token
      const r = await rpc(token, "tools/call", { name: "snapshot", arguments: {} });
      console.log(`   ↳ status ${r.status} · ${JSON.stringify(r.corpo.result?.content?.[0]?.text || r.corpo).slice(0, 160)}`);
      assert.equal(r.status, 200);
      assert.equal(r.corpo.result.isError, false);
      assert.match(r.corpo.result.content[0].text, /Enviar|Submit|Customer|nome/i);
    }],
    ["token gerado: escopo de ações também clica (com sucesso)", async () => {
      // pega um índice do snapshot mais recente da página e exige um clique que dê certo
      const foto = await rpc(token, "tools/call", { name: "snapshot", arguments: {} });
      const elementos = JSON.parse(foto.corpo.result.content[0].text).elements || [];
      const alvo = elementos.find((e) => e.naTela && e.tag === "input" && e.tipo === "text") || elementos.find((e) => e.naTela);
      assert.ok(alvo, "snapshot sem elemento clicável na tela");
      const r = await rpc(token, "tools/call", { name: "clicar", arguments: { i: alvo.i } });
      const texto = r.corpo.result?.content?.[0]?.text || JSON.stringify(r.corpo);
      console.log(`   ↳ clicou em [${alvo.i}] · status ${r.status} · ${texto.slice(0, 160)}`);
      assert.equal(r.status, 200);
      assert.equal(r.corpo.result.isError, false, texto);
      assert.match(texto, /^cliquei em \[/);
    }],
    ["token inválido é recusado pelo servidor", async () => {
      const r = await rpc("mcp_invalido", "tools/list", {});
      assert.equal(r.status, 401);
    }],
  ]);
} finally {
  await c.fechar?.();
}
process.exit(falhas ? 1 : 0);
