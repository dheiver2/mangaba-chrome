// Teste de integração das ações com a extensão carregada num Chrome isolado, numa página
// local que só aceita eventos reais. Rodar com: npm run test:chrome
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, indice } from "./chrome-teste.mjs";

const html = readFileSync(resolve("tests/paginas/acoes.html"));
const srv = http.createServer((_q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const c = await abrirChrome(`http://127.0.0.1:${srv.address().port}/acoes.html`);
let falhas = 1;
try {
  const snap = await c.acao("snapshot");
  assert.ok(snap.ok, "snapshot falhou: " + snap.error);
  const i = (rotulo) => indice(snap, rotulo);
  falhas = await rodarCasos([
    ["clique real em botão que só aceita isTrusted", async () => {
      const r = await c.acao("clicar", { i: i("Confirmar pedido") });
      assert.ok(r.ok, r.error);
      assert.equal(await c.naPagina(`document.getElementById("real-st").textContent`), "confirmado");
    }],
    ["digitação real em campo que recusa texto sintético", async () => {
      const r = await c.acao("digitar", { i: i("Nome completo"), texto: "Ana Souza" });
      assert.ok(r.ok, r.error);
      assert.equal(await c.naPagina(`document.getElementById("nome").value`), "Ana Souza");
    }],
    ["Enter real envia mensagem no chat", async () => {
      const k = i("Mensagem");
      assert.ok((await c.acao("digitar", { i: k, texto: "Olá" })).ok);
      const t = await c.acao("tecla", { i: k, tecla: "Enter" });
      assert.ok(t.ok, t.error);
      assert.equal(await c.naPagina(`document.querySelector("#msgs li")?.textContent`), "Olá");
    }],
    ["digitar substitui o conteúdo do editor rico", async () => {
      const r = await c.acao("digitar", { i: i("texto antigo"), texto: "texto novo" });
      assert.ok(r.ok, r.error);
      assert.equal(await c.naPagina(`document.getElementById("editor").innerText.trim()`), "texto novo");
    }],
    ["clique em botão coberto avisa que havia algo por cima", async () => {
      const r = await c.acao("clicar", { i: i("Botão coberto") });
      assert.ok(r.ok, r.error);
      assert.match(String(r.out), /por cima/);
    }],
    ["escrever em editor dentro de iframe (como o Google Docs) depois de clicar nele", async () => {
      const k = indice(snap, (x) => x.tag === "body");
      assert.ok((await c.acao("clicar", { i: k })).ok);
      const r = await c.acao("escrever", { texto: "Ouviram do Ipiranga" });
      assert.ok(r.ok, r.error);
      assert.equal(await c.naPagina(`document.getElementById("doc").contentDocument.body.innerText.trim()`), "Ouviram do Ipiranga");
    }],
    ["elemento que saiu da página gera erro, não sucesso falso", async () => {
      const k = i("Confirmar pedido");
      await c.naPagina(`document.getElementById("real").remove()`);
      const r = await c.acao("clicar", { i: k });
      assert.equal(r.ok, false);
      assert.match(String(r.error), /saiu da página/);
    }],
  ]);
} finally {
  await c.fechar();
  srv.close();
}
process.exit(falhas ? 1 : 0);
