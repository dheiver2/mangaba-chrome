// Teste de integração com a extensão carregada num Chrome isolado (perfil temporário).
// Exercita o background.js real: snapshot, clicar, digitar, tecla e escrever, incluindo a
// entrada via chrome.debugger. Rodar com: node tests/integracao-chrome.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIST = resolve("dist");
const PORTA_CDP = 9333;
const perfil = mkdtempSync(join(tmpdir(), "mgb-chrome-"));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// servidor da página de teste
const pagina = readFileSync(resolve("tests/paginas/acoes.html"));
const srv = http.createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(pagina); }).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const URL_TESTE = `http://127.0.0.1:${srv.address().port}/acoes.html`;

// O Chrome de marca não aceita mais --load-extension; a extensão entra pelo comando
// Extensions.loadUnpacked do CDP, que só existe no transporte por pipe.
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORTA_CDP}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  `--user-data-dir=${perfil}`, "--no-first-run", "--window-size=1280,900", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const [, , , entradaPipe, saidaPipe] = chrome.stdio;
let bufPipe = "";
const pendPipe = new Map();
saidaPipe.on("data", (d) => {
  bufPipe += d.toString();
  let i;
  while ((i = bufPipe.indexOf("\0")) >= 0) {
    const m = JSON.parse(bufPipe.slice(0, i));
    bufPipe = bufPipe.slice(i + 1);
    if (m.id && pendPipe.has(m.id)) { pendPipe.get(m.id)(m); pendPipe.delete(m.id); }
  }
});
let idPipe = 0;
const pipe = (method, params = {}) => new Promise((res) => { const n = ++idPipe; pendPipe.set(n, res); entradaPipe.write(JSON.stringify({ id: n, method, params }) + "\0"); });
const carregado = await pipe("Extensions.loadUnpacked", { path: DIST });
if (carregado.error) throw new Error("loadUnpacked: " + JSON.stringify(carregado.error));

async function json(caminho, metodo = "GET") {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORTA_CDP}${caminho}`, { method: metodo })).json(); } catch { await espera(200); }
  }
  throw new Error("Chrome não respondeu em " + caminho);
}

function conectar(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const pronto = new Promise((r) => (ws.onopen = r));
  return {
    pronto,
    enviar: (method, params = {}) => new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); }),
    async avaliar(expr) {
      const r = await this.enviar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    },
    fechar: () => ws.close(),
  };
}

const resultados = [];
const caso = async (nome, fn) => {
  try { await fn(); resultados.push(["ok", nome]); }
  catch (e) { resultados.push(["FALHOU", nome + " — " + e.message]); }
};

try {
  await json("/json/version");
  // id da extensão pelo service worker
  let extId;
  for (let i = 0; i < 50 && !extId; i++) {
    const alvos = await json("/json/list");
    const sw = alvos.find((a) => a.type === "service_worker" && a.url.startsWith("chrome-extension://") && a.url.endsWith("/background.js"));
    if (sw) extId = new URL(sw.url).host; else await espera(200);
  }
  assert.ok(extId, "extensão não carregou");

  // página de teste numa aba; painel da extensão em outra janela
  const pag = await json(`/json/new?${encodeURIComponent(URL_TESTE)}`, "PUT");
  const navegador = conectar((await json("/json/version")).webSocketDebuggerUrl);
  await navegador.pronto;
  const novo = await navegador.enviar("Target.createTarget", { url: `chrome-extension://${extId}/sidepanel.html`, newWindow: true });
  await espera(1500);
  const painelAlvo = (await json("/json/list")).find((a) => a.id === novo.result.targetId);
  const painel = conectar(painelAlvo.webSocketDebuggerUrl);
  const pagina = conectar(pag.webSocketDebuggerUrl);
  await Promise.all([painel.pronto, pagina.pronto]);
  await espera(800);
  const diag = await painel.avaliar(`JSON.stringify({ href: location.href, chaves: typeof chrome === "object" ? Object.keys(chrome) : null })`);
  if (!diag.includes("windows")) throw new Error("painel sem chrome.windows: " + diag);

  const janela = await painel.avaliar(`chrome.windows.getAll({populate:true}).then(ws => ws.find(w => w.tabs.some(t => t.url.includes("acoes.html"))).id)`);
  const acao = (tool, args = {}) => painel.avaliar(`chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)}, windowId: ${janela} })`);
  const naPagina = (expr) => pagina.avaliar(expr);

  const snap = await acao("snapshot");
  assert.ok(snap.ok, "snapshot falhou: " + snap.error);
  const lista = String(snap.out?.elements ? JSON.stringify(snap.out.elements) : snap.out);
  const indice = (rotulo) => {
    const els = snap.out.elements || [];
    const e = els.find((x) => (x.texto || "").includes(rotulo));
    if (!e) throw new Error("não achei " + rotulo + " em " + lista.slice(0, 300));
    return e.i;
  };

  await caso("clique real em botão que só aceita isTrusted", async () => {
    const r = await acao("clicar", { i: indice("Confirmar pedido") });
    assert.ok(r.ok, r.error);
    assert.equal(await naPagina(`document.getElementById("real-st").textContent`), "confirmado");
  });

  await caso("digitação real em campo que recusa texto sintético", async () => {
    const r = await acao("digitar", { i: indice("Nome completo"), texto: "Ana Souza" });
    assert.ok(r.ok, r.error);
    assert.equal(await naPagina(`document.getElementById("nome").value`), "Ana Souza");
  });

  await caso("Enter real envia mensagem no chat", async () => {
    const i = indice("Mensagem");
    const d = await acao("digitar", { i, texto: "Olá" });
    assert.ok(d.ok, d.error);
    const t = await acao("tecla", { i, tecla: "Enter" });
    assert.ok(t.ok, t.error);
    assert.equal(await naPagina(`document.querySelector("#msgs li")?.textContent`), "Olá");
  });

  await caso("digitar substitui o conteúdo do editor rico", async () => {
    const r = await acao("digitar", { i: indice("texto antigo"), texto: "texto novo" });
    assert.ok(r.ok, r.error);
    assert.equal(await naPagina(`document.getElementById("editor").innerText.trim()`), "texto novo");
  });

  await caso("clique em botão coberto avisa que havia algo por cima", async () => {
    const r = await acao("clicar", { i: indice("Botão coberto") });
    assert.ok(r.ok, r.error);
    assert.match(String(r.out), /por cima/, "resposta: " + JSON.stringify(r) + " | pos: " + await naPagina(`JSON.stringify([document.getElementById("coberto").getBoundingClientRect(), document.getElementById("capa").getBoundingClientRect()])`));
  });

  await caso("escrever em editor dentro de iframe (como o Google Docs) depois de clicar nele", async () => {
    const corpo = (snap.out.elements || []).find((x) => x.tag === "body");
    if (!corpo) throw new Error("snapshot não trouxe o corpo editável do iframe");
    const c = await acao("clicar", { i: corpo.i });
    assert.ok(c.ok, c.error);
    const r = await acao("escrever", { texto: "Ouviram do Ipiranga" });
    assert.ok(r.ok, r.error);
    assert.equal(await naPagina(`document.getElementById("doc").contentDocument.body.innerText.trim()`), "Ouviram do Ipiranga");
  });

  await caso("elemento que saiu da página gera erro, não sucesso falso", async () => {
    const i = indice("Confirmar pedido");
    await naPagina(`document.getElementById("real").remove()`);
    const r = await acao("clicar", { i });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /saiu da página/);
  });

  painel.fechar(); pagina.fechar(); navegador.fechar();
} finally {
  chrome.kill();
  srv.close();
  await espera(300);
  rmSync(perfil, { recursive: true, force: true });
}

for (const [st, nome] of resultados) console.log(st === "ok" ? "✔" : "✖", nome);
const falhas = resultados.filter(([st]) => st !== "ok").length;
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`);
process.exit(falhas ? 1 : 0);
