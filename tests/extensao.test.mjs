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

test("Ler a página aberta: o texto da aba vai junto, sem os valores de Meus dados", async () => {
  const ctx = carregarHermes({ tool: async (t) => (t === "ler" ? { ok: true, out: "Olá ana@exemplo.com, seu pedido 42 saiu." } : { ok: false }) });
  ctx.cfg.dados = "email: ana@exemplo.com";
  const texto = await ctx.textoDaAba();
  assert.match(texto, /pedido 42/);
  assert.match(texto, /\{\{email\}\}/);
  assert.doesNotMatch(texto, /ana@exemplo/);
  ctx.cfg.lerPagina = false;
  assert.equal(await ctx.textoDaAba(), "");
});

test("Ler a página aberta: página que não dá para ler não atrapalha o pedido", async () => {
  const ctx = carregarHermes({ tool: async () => ({ ok: false, error: "Página não acessível" }) });
  assert.equal(await ctx.textoDaAba(), "");
});

// ---- Acesso: conta obrigatória + chave do Router (acesso.js) ----
function carregarAcesso({ fetch, local = {}, sync = {} } = {}) {
  const storage = {
    local: {
      get: async (padrao) => Object.fromEntries(Object.entries(padrao).map(([k, v]) => [k, k in local ? local[k] : v])),
      set: async (o) => Object.assign(local, o),
      remove: async (k) => { delete local[k]; },
    },
    sync: {
      get: (padrao, cb) => cb(Object.fromEntries(Object.entries(padrao).map(([k, v]) => [k, k in sync ? sync[k] : v]))),
      remove: (k, cb) => { delete sync[k]; cb(); },
    },
  };
  const ctx = vm.createContext({ fetch, chrome: { storage } });
  vm.runInContext(ler("acesso.js"), ctx);
  return { ctx, local, sync };
}
const conta = { apiUrl: "https://conta.exemplo", token: "jwt", user: { id: "u1", email: "ana@exemplo.com" } };

test("estadoAcesso: sem sessão → entrada; sem chave → chave; as duas → pronto", () => {
  const { ctx } = carregarAcesso();
  assert.equal(ctx.estadoAcesso(null, "mr-1"), "entrada");
  assert.equal(ctx.estadoAcesso({ token: "jwt", user: {} }, "mr-1"), "entrada");
  assert.equal(ctx.estadoAcesso(conta, ""), "chave");
  assert.equal(ctx.estadoAcesso(conta, "mr-1"), "pronto");
});

test("chave fica separada por usuário em storage.local", async () => {
  const { ctx, local } = carregarAcesso();
  await ctx.chaveSave("u1", "mr-ana");
  assert.equal(await ctx.chaveLoad("u1"), "mr-ana");
  assert.equal(await ctx.chaveLoad("u2"), "");
  await ctx.chaveRemove("u1");
  assert.equal(local.mangaba_chave_u1, undefined);
});

test("chave da 2.16.0 (storage.sync) migra para o primeiro usuário e sai do sync", async () => {
  const { ctx, local, sync } = carregarAcesso({ sync: { key: "mr-antiga" } });
  assert.equal(await ctx.chaveMigrar("u1"), "mr-antiga");
  assert.equal(local.mangaba_chave_u1, "mr-antiga");
  assert.equal(sync.key, undefined);
  assert.equal(await ctx.chaveMigrar("u2"), "");
});

test("validarChaveRouter: 200 aceita, 401 recusa, falha de rede pede nova tentativa", async () => {
  let pedido;
  const resposta = (status) => async (url, opts) => { pedido = { url, opts }; return { ok: status === 200, status }; };
  assert.equal((await carregarAcesso({ fetch: resposta(200) }).ctx.validarChaveRouter(" mr-boa ")).ok, true);
  assert.equal(pedido.url, "https://mangabarouter.store/v1/models");
  assert.equal(pedido.opts.headers.Authorization, "Bearer mr-boa");
  const ruim = await carregarAcesso({ fetch: resposta(401) }).ctx.validarChaveRouter("mr-ruim");
  assert.equal(ruim.motivo, "invalida");
  const offline = await carregarAcesso({ fetch: async () => { throw new TypeError("rede"); } }).ctx.validarChaveRouter("mr-x");
  assert.equal(offline.motivo, "rede");
  assert.equal((await carregarAcesso().ctx.validarChaveRouter("  ")).motivo, "invalida");
});

test("confirmarSessao: 401 expira, rede fora mantém a sessão local", async () => {
  const com = (f) => carregarAcesso({ fetch: f }).ctx;
  assert.equal(await com(async () => ({ ok: true, status: 200 })).confirmarSessao(conta), "ok");
  assert.equal(await com(async () => ({ ok: false, status: 401 })).confirmarSessao(conta), "expirada");
  assert.equal(await com(async () => { throw new TypeError("rede"); }).confirmarSessao(conta), "offline");
  assert.equal(await com(async () => ({ ok: true })).confirmarSessao(null), "expirada");
});

test("Hermes: chave recusada pelo Router volta para a tela da chave", async () => {
  const chamadas = [];
  const corpo = corpoSSE('event: erro\ndata: {"erro":"chave do Mangaba Router recusada: revogada"}\n\n');
  const ctx = carregarHermes({
    addMsg: () => ({}), setAssistant: () => {}, setStop: () => {}, agentRun: null,
    chat: { appendChild: () => {} }, document: { createElement: () => ({}) },
    tool: async () => ({ ok: false }),
    fetch: async (url) => (url.endsWith("/instalacao") ? { ok: true, json: async () => ({ instalacao: "i", chave: "c" }) } : { ok: true, body: corpo }),
    AbortController, chaveRouterRecusada: (m) => chamadas.push(m),
  });
  ctx.cfg.lerPagina = false;
  await ctx.runHermes("resuma");
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0], /recusada/);
});
