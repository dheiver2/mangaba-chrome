// Abre um Chrome isolado (perfil temporário) com a extensão de dist/ carregada e devolve
// funções para chamar as ferramentas do background.js e inspecionar a página de teste.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function conectar(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const pronto = new Promise((r) => (ws.onopen = r));
  const enviar = (method, params = {}) => new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  return {
    pronto, enviar,
    async avaliar(expr) {
      const r = await enviar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    },
    fechar: () => ws.close(),
  };
}

export async function abrirChrome(urlInicial, { porta = 9333, dist = resolve("dist") } = {}) {
  const perfil = mkdtempSync(join(tmpdir(), "mgb-chrome-"));
  // O Chrome de marca não aceita mais --load-extension; a extensão entra pelo comando
  // Extensions.loadUnpacked do CDP, que só existe no transporte por pipe.
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${porta}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
    `--user-data-dir=${perfil}`, "--no-first-run", "--window-size=1280,900", "--lang=pt-BR", "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const [, , , entradaPipe, saidaPipe] = chrome.stdio;
  let buf = "";
  const pendPipe = new Map();
  saidaPipe.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.id && pendPipe.has(m.id)) { pendPipe.get(m.id)(m); pendPipe.delete(m.id); }
    }
  });
  let idPipe = 0;
  const pipe = (method, params = {}) => new Promise((res) => { const n = ++idPipe; pendPipe.set(n, res); entradaPipe.write(JSON.stringify({ id: n, method, params }) + "\0"); });

  const json = async (caminho, metodo = "GET") => {
    for (let i = 0; i < 50; i++) {
      try { return await (await fetch(`http://127.0.0.1:${porta}${caminho}`, { method: metodo })).json(); } catch { await espera(200); }
    }
    throw new Error("Chrome não respondeu em " + caminho);
  };

  const fecharTudo = async () => {
    chrome.kill();
    await espera(300);
    rmSync(perfil, { recursive: true, force: true });
  };

  try {
    await json("/json/version");
    const carregado = await pipe("Extensions.loadUnpacked", { path: dist });
    if (carregado.error) throw new Error("loadUnpacked: " + JSON.stringify(carregado.error));
    const extId = carregado.result.id;

    const pag = await json(`/json/new?${encodeURIComponent(urlInicial)}`, "PUT");
    const navegador = conectar((await json("/json/version")).webSocketDebuggerUrl);
    await navegador.pronto;
    const novo = await navegador.enviar("Target.createTarget", { url: `chrome-extension://${extId}/sidepanel.html`, newWindow: true });
    await espera(1500);
    const painelAlvo = (await json("/json/list")).find((a) => a.id === novo.result.targetId);
    const painel = conectar(painelAlvo.webSocketDebuggerUrl);
    const pagina = conectar(pag.webSocketDebuggerUrl);
    await Promise.all([painel.pronto, pagina.pronto]);
    await espera(800);
    const janela = await painel.avaliar(`chrome.windows.getAll({ populate: true }).then((ws) => ws.find((w) => w.tabs.some((t) => t.id && !t.url.startsWith("chrome-extension://"))).id)`);

    return {
      painel, pagina,
      acao: (tool, args = {}) => painel.avaliar(`chrome.runtime.sendMessage({ type: "AGENT_TOOL", tool: ${JSON.stringify(tool)}, args: ${JSON.stringify(args)}, windowId: ${janela} })`),
      naPagina: (expr) => pagina.avaliar(expr),
      async fechar() { painel.fechar(); pagina.fechar(); navegador.fechar(); await fecharTudo(); },
    };
  } catch (e) {
    await fecharTudo();
    throw e;
  }
}

// Executa casos nomeados e imprime o placar; devolve o número de falhas.
export async function rodarCasos(casos) {
  const res = [];
  for (const [nome, fn] of casos) {
    try { await fn(); res.push(["✔", nome]); } catch (e) { res.push(["✖", nome + " — " + String(e.message).slice(0, 300)]); }
  }
  for (const [s, n] of res) console.log(s, n);
  const falhas = res.filter(([s]) => s === "✖").length;
  console.log(`\n${res.length - falhas}/${res.length} passaram`);
  return falhas;
}

// Índice do elemento do snapshot cujo texto contém o rótulo (ou que satisfaz o filtro).
export function indice(snap, filtro) {
  const els = snap.out?.elements || [];
  const f = typeof filtro === "string" ? (x) => (x.texto || "").includes(filtro) : filtro;
  const e = els.find(f);
  if (!e) throw new Error("não achei o elemento no snapshot: " + JSON.stringify(els.slice(0, 15).map((x) => [x.i, x.tag, x.texto])));
  return e.i;
}
