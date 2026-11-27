// Testes avançados de operação de páginas, com a extensão num Chrome isolado.
// Página de teste local (tests/paginas/avancado.html): iframe, shadow DOM, editor
// contenteditable, combobox customizado, select, lista com carregamento, modal e
// elemento fora da tela. Rodar com: node tests/avancados.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { abrirChrome, rodarCasos, indice, espera } from "./chrome-teste.mjs";

const html = readFileSync(resolve("tests/paginas/avancado.html"));
const srv = createServer((_, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}/`;

const c = await abrirChrome("about:blank");
const ler = async (js) => c.naPagina(js);
const ir = async () => { const r = await c.acao("navegar", { url: base }); assert.ok(r.ok, r.error); await espera(1200); };
const achar = (snap, texto) => indice(snap, (x) => (x.texto || "").trim().includes(texto));

let falhas = 1;
try {
  falhas = await rodarCasos([
    ["Iframe: clica no botão dentro do iframe", async () => {
      await ir();
      const snap = await c.acao("snapshot");
      const i = achar(snap, "Botão no iframe");
      assert.ok(Number.isInteger(i), "botão do iframe não apareceu no mapa da página: " + String(snap.out ?? snap).slice(0, 300));
      const r = await c.acao("clicar", { i });
      assert.ok(r.ok, r.error);
      await espera(300);
      assert.equal(await ler(`document.getElementById('quadro').contentDocument.getElementById('dentro').textContent`), "clicado no iframe");
    }],
    ["Iframe: digita no campo dentro do iframe", async () => {
      await ir();
      const snap = await c.acao("snapshot");
      const i = indice(snap, (x) => x.tag === "input" && (x.texto || "").includes("campo no iframe") || (x.placeholder === "campo no iframe"));
      assert.ok(Number.isInteger(i), "campo do iframe não apareceu no mapa");
      const r = await c.acao("digitar", { i, texto: "Ana no iframe" });
      assert.ok(r.ok, r.error);
      await espera(200);
      assert.equal(await ler(`document.getElementById('quadro').contentDocument.getElementById('campo-dentro').value`), "Ana no iframe");
    }],
    ["Shadow DOM: clica no botão dentro de web component aberto", async () => {
      await ir();
      const snap = await c.acao("snapshot");
      const i = achar(snap, "Botão no shadow");
      assert.ok(Number.isInteger(i), "botão do shadow DOM não apareceu no mapa");
      const r = await c.acao("clicar", { i });
      assert.ok(r.ok, r.error);
      await espera(300);
      assert.equal(await ler(`document.querySelector('sombra-widget').shadowRoot.getElementById('sombra-st').textContent`), "clicado no shadow");
    }],
    ["Editor contenteditable: digita um texto e ele é gravado no editor", async () => {
      await ir();
      const snap = await c.acao("snapshot");
      const i = indice(snap, (x) => (x.texto || "").includes("Editor de texto") || (x.rotulo || "").includes("Editor de texto") || /contenteditable|textbox/i.test(x.tag + " " + (x.papel || "")));
      assert.ok(Number.isInteger(i), "editor não apareceu no mapa");
      const r = await c.acao("digitar", { i, texto: "Proposta para Ana Souza" });
      assert.ok(r.ok, r.error);
      await espera(300);
      assert.equal(await ler(`document.getElementById('editor').textContent`), "Proposta para Ana Souza");
    }],
    ["Combobox customizado: abre, escolhe a opção pelo texto", async () => {
      await ir();
      const r1 = await c.acao("clicar_texto", { texto: "Escolha a cidade" });
      assert.ok(r1.ok, r1.error);
      await espera(300);
      const r2 = await c.acao("clicar_texto", { texto: "Recife" });
      assert.ok(r2.ok, r2.error);
      await espera(300);
      assert.equal(await ler(`document.getElementById('combo-resultado').textContent`), "Recife");
    }],
    ["Select nativo: escolhe Alagoas", async () => {
      await ir();
      const snap = await c.acao("snapshot");
      const i = indice(snap, (x) => x.tag === "select");
      assert.ok(Number.isInteger(i), "select não apareceu no mapa");
      const r = await c.acao("selecionar", { i, opcao: "Alagoas" });
      assert.ok(r.ok, r.error);
      await espera(200);
      assert.equal(await ler(`document.getElementById('uf-resultado').textContent`), "AL");
    }],
    ["Modal: abre, confirma, e Escape fecha outro modal", async () => {
      await ir();
      assert.ok((await c.acao("clicar_texto", { texto: "Abrir modal" })).ok);
      await espera(300);
      const esp = await c.acao("esperar_por", { texto: "Sim, confirmar", segundos: 5 });
      assert.ok(esp.ok, esp.error);
      assert.ok((await c.acao("clicar_texto", { texto: "Sim, confirmar" })).ok);
      await espera(300);
      assert.equal(await ler(`document.getElementById('modal-resultado').textContent`), "confirmado");
      await c.acao("clicar_texto", { texto: "Abrir modal" });
      await espera(300);
      assert.ok((await c.acao("tecla", { tecla: "Escape" })).ok);
      await espera(300);
      assert.equal(await ler(`getComputedStyle(document.getElementById('modal')).display`), "none");
    }],
    ["Elemento fora da tela: rola até o texto e clica", async () => {
      await ir();
      const r0 = await c.acao("rolar_ate", { texto: "Botão lá embaixo" });
      assert.ok(r0.ok, r0.error);
      const snap = await c.acao("snapshot");
      const i = achar(snap, "Botão lá embaixo");
      assert.ok(Number.isInteger(i), "botão do fim não apareceu no mapa depois de rolar");
      assert.ok((await c.acao("clicar", { i })).ok);
      await espera(300);
      assert.equal(await ler(`document.getElementById('fim-resultado').textContent`), "clicado");
    }],
    ["Lista com carregamento ao rolar: o agente consegue carregar mais itens", async () => {
      await ir();
      const antes = Number(await ler(`document.getElementById('lista-total').textContent`));
      const r = await c.acao("rolar_ate", { texto: "Item 20" });
      assert.ok(r.ok, r.error);
      await espera(500);
      const depois = Number(await ler(`document.getElementById('lista-total').textContent`));
      assert.ok(depois > antes, `a lista não carregou mais itens (antes ${antes}, depois ${depois})`);
    }],
  ]);
} finally {
  await c.fechar();
  srv.close();
}
process.exit(falhas ? 1 : 0);
