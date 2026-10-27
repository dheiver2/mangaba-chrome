// Testes das ações em sites reais, com a extensão carregada num Chrome isolado.
// Precisa de internet. Rodar com: npm run test:sites
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, indice, espera } from "./chrome-teste.mjs";

const c = await abrirChrome("about:blank");
const url = () => c.naPagina("location.href");
const ir = async (u) => { const r = await c.acao("navegar", { url: u }); assert.ok(r.ok, r.error); await espera(1500); };
// índice de um campo no mapa do formulário, pelo rótulo visível
const campo = (mapa, rotulo) => {
  const linha = String(mapa).split("\n").find((l) => l.includes(`"${rotulo}`));
  if (!linha) throw new Error(`campo "${rotulo}" não está no formulário: ${String(mapa).slice(0, 300)}`);
  return Number(linha.match(/^\[(\d+)\]/)[1]);
};

let falhas = 1;
try {
  falhas = await rodarCasos([
    ["Wikipédia: digita na busca, aperta Enter e chega no artigo", async () => {
      await ir("https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:P%C3%A1gina_principal");
      const snap = await c.acao("snapshot");
      const busca = indice(snap, (x) => x.tag === "input" && /pesquis/i.test(x.texto || ""));
      assert.ok((await c.acao("digitar", { i: busca, texto: "Hino Nacional Brasileiro" })).ok);
      const t = await c.acao("tecla", { i: busca, tecla: "Enter" });
      assert.ok(t.ok, t.error);
      await espera(2500);
      assert.match(await url(), /Hino_Nacional_Brasileiro/);
      assert.match(String((await c.acao("ler")).out), /Hino Nacional Brasileiro/);
    }],
    ["Formulário real (httpbin): texto, telefone, e-mail, rádio, caixas, área de texto e envio", async () => {
      await ir("https://httpbin.org/forms/post");
      const mapa = (await c.acao("formulario")).out;
      for (const [rot, val] of [["Customer name", "Ana Souza"], ["Telephone", "82999990000"], ["E-mail address", "ana@exemplo.com"], ["Delivery instructions", "Deixar na portaria"]]) {
        const r = await c.acao("digitar", { i: campo(mapa, rot), texto: val });
        assert.ok(r.ok, `${rot}: ${r.error}`);
      }
      assert.ok((await c.acao("marcar", { i: campo(mapa, "Medium"), valor: true })).ok);
      assert.ok((await c.acao("marcar", { i: campo(mapa, "Bacon"), valor: true })).ok);
      assert.ok((await c.acao("marcar", { i: campo(mapa, "Onion"), valor: true })).ok);
      const env = await c.acao("clicar", { i: campo(mapa, "Submit order") });
      assert.ok(env.ok, env.error);
      await espera(2000);
      const resposta = String((await c.acao("ler")).out);
      for (const esperado of ["Ana Souza", "82999990000", "ana@exemplo.com", "medium", "bacon", "onion", "Deixar na portaria"])
        assert.ok(resposta.includes(esperado), `o envio não levou "${esperado}": ${resposta.slice(0, 300)}`);
    }],
    ["Loja de livros: detecta paginação e vai para a página 2 clicando em next", async () => {
      await ir("https://books.toscrape.com/");
      const pag = await c.acao("detectar_paginacao");
      assert.ok(pag.ok, pag.error);
      assert.equal(pag.out.tipo, "paginacao", JSON.stringify(pag.out));
      assert.equal(pag.out.total_paginas, 50);
      assert.equal(pag.out.proximo.texto, "next");
      const snap = await c.acao("snapshot");
      const prox = indice(snap, (x) => x.tag === "a" && /^next$/i.test((x.texto || "").trim()));
      const r = await c.acao("clicar", { i: prox });
      assert.ok(r.ok, r.error);
      assert.match(await url(), /page-2\.html/);
    }],
    ["Ler várias páginas de uma vez para comparar fontes", async () => {
      const r = await c.acao("ler_varias", { urls: ["https://example.com/", "https://httpbin.org/html"] });
      assert.ok(r.ok, r.error);
      const t = JSON.stringify(r.out);
      assert.match(t, /documentation examples/);
      assert.match(t, /Herman Melville|Moby/);
    }],
    ["Voltar no histórico depois de navegar", async () => {
      await ir("https://example.com/");
      await ir("https://httpbin.org/html");
      const r = await c.acao("voltar");
      assert.ok(r.ok, r.error);
      await espera(1500);
      // O Chrome pula, no voltar, entradas criadas sem gesto do usuário; o que importa é
      // sair da página atual e informar com verdade para onde foi.
      const agora = await url();
      assert.doesNotMatch(agora, /httpbin\.org\/html/);
      assert.ok(String(r.out).includes(agora), "voltar respondeu: " + JSON.stringify(r) + " | url: " + agora);
    }],
    // Google Docs: precisa de um documento com "qualquer pessoa com o link pode editar"
    ...(process.env.DOCS_TESTE_ID ? [["Google Docs: escreve no documento e lê o conteúdo de volta", async () => {
      await ir(`https://docs.google.com/document/d/${process.env.DOCS_TESTE_ID}/edit`);
      await espera(7000);
      const snap = await c.acao("snapshot");
      indice(snap, (x) => /área de edição do documento/.test(x.texto || ""));
      const marca = "Mangaba teste " + Date.now();
      const r = await c.acao("escrever", { texto: marca });
      assert.ok(r.ok, r.error);
      await espera(6000);
      assert.match(String((await c.acao("ler")).out), new RegExp(marca));
    }]] : []),
  ]);
} finally {
  await c.fechar();
}
process.exit(falhas ? 1 : 0);
