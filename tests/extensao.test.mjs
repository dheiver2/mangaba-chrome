// Testes de partes puras da extensão. Rodar com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("..", import.meta.url);
const ler = (arq) => readFileSync(new URL(arq, raiz), "utf8");

// Carrega hermes.js num contexto com os globais que o painel fornece.
function carregarHermes(globais = {}) {
  const ctx = vm.createContext({
    TextDecoder, setTimeout, console,
    cfg: { hermesUrl: "https://hermes.exemplo", key: "mr-teste" },
    DEFAULTS: { hermesUrl: "https://hermes.exemplo" },
    myWindowId: 7,
    chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }, runtime: { sendMessage: async () => ({}) } },
    ...globais,
  });
  vm.runInContext(ler("hermes.js"), ctx);
  return ctx;
}

const corpoSSE = (texto, pedaco = 7) => new ReadableStream({
  start(c) { const b = new TextEncoder().encode(texto); for (let i = 0; i < b.length; i += pedaco) c.enqueue(b.slice(i, i + pedaco)); c.close(); },
});

test("lerSSEHermes separa eventos e preserva o nome mesmo com pedaços quebrados", async () => {
  const ctx = carregarHermes();
  const texto = 'data: {"a":1}\n\nevent: navegador.acao\ndata: {"id":"x","tool":"ler"}\n\n: ping\n\nevent: erro\ndata: {"erro":"limite"}\n\ndata: [DONE]\n\n';
  const quadros = [];
  for await (const q of ctx.lerSSEHermes(corpoSSE(texto))) quadros.push(q);
  assert.deepEqual(quadros.map((q) => q.evento), [null, "navegador.acao", "erro", null]);
  assert.equal(JSON.parse(quadros[1].dados).tool, "ler");
  assert.equal(quadros[3].dados, "[DONE]");
});

test("contextoDaAba inclui título e URL da aba ativa", async () => {
  const ctx = carregarHermes({
    chrome: { runtime: { sendMessage: async (m) => (m.type === "GET_PAGE_CONTEXT" && m.windowId === 7 ? { ok: true, page: { title: "Doc", url: "https://docs.google.com/x" } } : {}) } },
  });
  const texto = await ctx.contextoDaAba();
  assert.match(texto, /\[aba atual: Doc — https:\/\/docs\.google\.com\/x\]/);
});

test("contextoDaAba fica vazio quando não há aba acessível", async () => {
  const ctx = carregarHermes({ chrome: { runtime: { sendMessage: async () => ({ ok: false }) } } });
  assert.equal(await ctx.contextoDaAba(), "");
});

// escreverFn é injetada na página; aqui roda com um document de mentira.
function escreverFn(document) {
  const fonte = ler("background.js").match(/const escreverFn = \(texto\) => \{[\s\S]*?\n\};/)[0];
  const ctx = vm.createContext({ document, location: { hostname: "docs.google.com" } });
  vm.runInContext(fonte, ctx);
  return vm.runInContext("escreverFn", ctx);
}

test("escrever só confirma quando o texto aparece no editor", () => {
  let texto = "";
  const editor = { isContentEditable: true, focus() {}, get innerText() { return texto; } };
  const fn = escreverFn({ body: editor, execCommand: (_c, _u, t) => { texto += t; return true; } });
  assert.equal(fn("Ouviram do Ipiranga").ok, true);
});

test("escrever recusa quando o editor ignora o texto", () => {
  const editor = { isContentEditable: true, focus() {}, innerText: "" };
  const fn = escreverFn({ body: editor, execCommand: () => true });
  assert.equal(fn("Ouviram do Ipiranga").ok, false);
});

test("escrever ignora frames sem área editável", () => {
  const fn = escreverFn({ body: { isContentEditable: false }, execCommand: () => true });
  assert.equal(fn("x").ok, false);
});

test("perguntar mostra a pergunta e devolve a resposta do usuário ao Hermes", async () => {
  const mensagens = [];
  const ctx = carregarHermes({ addMsg: (c, t) => mensagens.push([c, t]), input: { placeholder: "" }, agentRun: {}, tool: async () => ({ ok: true }) });
  const pendente = ctx.executarAcaoHermes({ tool: "perguntar", args: { pergunta: "Qual o CPF?" } });
  await new Promise((r) => setTimeout(r, 10));
  assert.match(mensagens[0][1], /Qual o CPF\?/);
  ctx.agentRun.waiting("123");
  assert.equal(await pendente, "resposta do usuário: 123");
});

test("extrair entrega o texto da página para o modelo extrair", async () => {
  const ctx = carregarHermes({ tool: async (t) => (t === "ler" ? { ok: true, out: "Total: R$ 10" } : { ok: false }) });
  const saida = await ctx.executarAcaoHermes({ tool: "extrair", args: { o_que: "valor total" } });
  assert.match(saida, /valor total/);
  assert.match(saida, /Total: R\$ 10/);
});

test("demais ações vão ao background e erros voltam como erro", async () => {
  const ctx = carregarHermes({ tool: async (t) => (t === "clicar" ? { ok: false, error: "saiu da página" } : { ok: true, out: "x" }) });
  assert.equal(await ctx.executarAcaoHermes({ tool: "clicar", args: { i: 1 } }), "erro: saiu da página");
  assert.equal(await ctx.executarAcaoHermes({ tool: "ler" }), "x");
});

test("Meus dados: o valor vai à página, o modelo só vê o marcador", async () => {
  const chamadas = [];
  const ctx = carregarHermes({ tool: async (t, a) => { chamadas.push(a); return { ok: true, out: `digitado: ${a.texto}` }; } });
  ctx.cfg.dados = "email: ana@exemplo.com\nnome: Ana Souza\nlinha sem dois pontos";
  const saida = await ctx.executarAcaoHermes({ tool: "digitar", args: { i: 3, texto: "{{email}} / {{ nome }} / {{cpf}}" } });
  assert.equal(chamadas[0].texto, "ana@exemplo.com / Ana Souza / {{cpf}}");
  assert.equal(chamadas[0].i, 3);
  assert.equal(saida, "digitado: {{email}} / {{nome}} / {{cpf}}");
  assert.match(ctx.contextoDosDados(), /\{\{email\}\}, \{\{nome\}\}/);
  assert.doesNotMatch(ctx.contextoDosDados(), /ana@exemplo/);
});
