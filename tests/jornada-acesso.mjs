// Jornada de acesso no painel real (Chrome isolado, extensão de dist/): cadastro → chave →
// chat, sessão expirada, sair/entrar, migração da chave da 2.16.0 e chave recusada pelo
// Router no meio de uma tarefa. Conta, Router e Hermes são simulados dentro do painel, então
// nada é criado em produção. Rodar com: bash build.sh dev && node tests/jornada-acesso.mjs
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, espera } from "./chrome-teste.mjs";

// Servidores falsos: trocam o fetch do painel antes de qualquer script dele rodar.
// O estado fica no sessionStorage para sobreviver aos recarregamentos do painel.
const SIMULADOR = `(() => {
  const real = window.fetch.bind(window);
  const est = () => JSON.parse(sessionStorage.getItem("sim") || '{"usuarios":{},"expirada":false,"recusar":false}');
  const grava = (s) => sessionStorage.setItem("sim", JSON.stringify(s));
  const json = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const corpo = opts.body ? JSON.parse(opts.body) : {};
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "";
    const s = est();
    if (u.host === "mangaba-chrome-backend.vercel.app") {
      if (u.pathname === "/auth/signup") {
        if (s.usuarios[corpo.email]) return json(409, { error: "já existe uma conta com este e-mail" });
        s.usuarios[corpo.email] = { id: "id-" + corpo.email, senha: corpo.password, name: corpo.name };
        grava(s);
        return json(201, { token: "jwt-" + corpo.email, user: { id: "id-" + corpo.email, email: corpo.email, name: corpo.name } });
      }
      if (u.pathname === "/auth/login") {
        const x = s.usuarios[corpo.email];
        if (!x || x.senha !== corpo.password) return json(401, { error: "e-mail ou senha incorretos" });
        return json(200, { token: "jwt-" + corpo.email, user: { id: x.id, email: corpo.email, name: x.name } });
      }
      if (u.pathname === "/auth/me") return s.expirada ? json(401, { error: "sessão inválida ou expirada" }) : json(200, { user: {} });
      if (u.pathname.startsWith("/sync/")) return json(200, { payload: null });
    }
    if (u.host === "mangabarouter.store" && u.pathname === "/v1/models") {
      return auth === "Bearer mr-valida" ? json(200, { data: [] }) : json(401, { error: { message: "chave inválida ou revogada" } });
    }
    if (u.host === "hermes.mangaba.ia.br") {
      if (u.pathname === "/instalacao") return json(200, { instalacao: "i1", chave: "c1" });
      if (u.pathname === "/v1/chat/completions") {
        const sse = s.recusar
          ? 'event: erro\\ndata: {"erro":"chave do Mangaba Router recusada: revogada"}\\n\\n'
          : 'data: {"choices":[{"delta":{"content":"feito"}}]}\\n\\ndata: [DONE]\\n\\n';
        return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
    }
    return real(url, opts);
  };
})();`;

const c = await abrirChrome("about:blank");
const p = c.painel;
const visivel = (id) => p.avaliar(`!document.getElementById(${JSON.stringify(id)}).classList.contains("hidden")`);
const texto = (id) => p.avaliar(`document.getElementById(${JSON.stringify(id)}).textContent`);
const recarregar = async () => { await p.enviar("Page.reload"); await espera(1500); };
const sim = (mudanca) => p.avaliar(`(() => { const s = JSON.parse(sessionStorage.getItem("sim") || '{"usuarios":{},"expirada":false,"recusar":false}'); Object.assign(s, ${JSON.stringify(mudanca)}); sessionStorage.setItem("sim", JSON.stringify(s)); return true; })()`);
async function preencher(campos) {
  await p.avaliar(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(campos)})) document.getElementById(id).value = v; return true; })()`);
}
const clicar = (id) => p.avaliar(`(document.getElementById(${JSON.stringify(id)}).click(), true)`);
const enviarForm = async (id) => { await p.avaliar(`(document.getElementById(${JSON.stringify(id)}).requestSubmit(), true)`); await espera(500); };
const tela = async () => ((await visivel("telaEntrada")) ? "entrada" : (await visivel("telaChave")) ? "chave" : (await visivel("chat")) ? "chat" : "nenhuma");

let falhas = 1;
try {
  await p.enviar("Page.enable");
  await p.enviar("Page.addScriptToEvaluateOnNewDocument", { source: SIMULADOR });
  await p.avaliar("chrome.storage.local.clear().then(() => chrome.storage.sync.clear()).then(() => true)");
  await recarregar();

  falhas = await rodarCasos([
    ["Primeiro uso mostra só a tela de entrada", async () => {
      assert.equal(await tela(), "entrada");
      assert.equal(await visivel("rodapeChat"), false);
      assert.equal(await visivel("btnSettings"), false);
    }],
    ["Enviar sem acesso não chega ao agente", async () => {
      await p.avaliar(`(input.value = "resuma", send(), true)`);
      assert.equal(await tela(), "entrada");
      assert.equal(await p.avaliar("agentRun === null"), true);
    }],
    ["Senha curta é recusada no próprio painel", async () => {
      await clicar("abaCriar");
      await preencher({ entNome: "Ana", entEmail: "ana@exemplo.com", entSenha: "curta" });
      await enviarForm("formEntrada");
      assert.match(await texto("entErro"), /8 caracteres/);
      assert.equal(await tela(), "entrada");
    }],
    ["Cadastro leva à tela da chave", async () => {
      await preencher({ entSenha: "senha-forte-123" });
      await enviarForm("formEntrada");
      assert.equal(await tela(), "chave");
    }],
    ["Chave inválida fica na tela da chave com o motivo", async () => {
      await preencher({ chaveInput: "mr-errada" });
      await enviarForm("formChave");
      assert.equal(await tela(), "chave");
      assert.match(await texto("chaveErro"), /inválida ou revogada/);
    }],
    ["Chave válida libera o chat e fica só em storage.local, por usuário", async () => {
      await preencher({ chaveInput: "mr-valida" });
      await enviarForm("formChave");
      assert.equal(await tela(), "chat");
      assert.equal(await texto("usuarioTopo"), "ana@exemplo.com");
      const local = await p.avaliar(`chrome.storage.local.get("mangaba_chave_id-ana@exemplo.com").then((r) => r["mangaba_chave_id-ana@exemplo.com"])`);
      assert.equal(local, "mr-valida");
      assert.equal(await p.avaliar(`chrome.storage.sync.get("key").then((r) => r.key ?? null)`), null);
    }],
    ["Reabrir o painel volta direto ao chat", async () => {
      await recarregar();
      assert.equal(await tela(), "chat");
    }],
    ["Tarefa roda com sessão e chave", async () => {
      await p.avaliar(`(input.value = "resuma esta página", send(), true)`);
      await espera(1500);
      assert.match(await p.avaliar(`[...document.querySelectorAll(".msg.assistant")].pop().innerText`), /feito/);
    }],
    ["Chave recusada pelo Router no meio da tarefa volta à tela da chave", async () => {
      await sim({ recusar: true });
      await p.avaliar(`(input.value = "resuma de novo", send(), true)`);
      await espera(1500);
      assert.equal(await tela(), "chave");
      assert.match(await texto("chaveErro"), /recusou/);
      await sim({ recusar: false });
      await preencher({ chaveInput: "mr-valida" });
      await enviarForm("formChave");
      assert.equal(await tela(), "chat");
    }],
    ["Sair volta à entrada; entrar de novo lembra a chave do usuário", async () => {
      await clicar("btnSair");
      await espera(300);
      assert.equal(await tela(), "entrada");
      await preencher({ entEmail: "ana@exemplo.com", entSenha: "senha-forte-123" });
      await enviarForm("formEntrada");
      assert.equal(await tela(), "chat");
    }],
    ["Outro usuário no mesmo navegador não herda a chave", async () => {
      await clicar("btnSair");
      await clicar("abaCriar");
      await preencher({ entNome: "Bia", entEmail: "bia@exemplo.com", entSenha: "senha-forte-456" });
      await enviarForm("formEntrada");
      assert.equal(await tela(), "chave");
    }],
    ["Sessão expirada volta à entrada com aviso", async () => {
      await sim({ expirada: true });
      await recarregar();
      assert.equal(await tela(), "entrada");
      assert.match(await texto("entErro"), /expirou/);
      await sim({ expirada: false });
    }],
    ["Chave da 2.16.0 (storage.sync) migra no login e sai do sync", async () => {
      await p.avaliar(`chrome.storage.sync.set({ key: "mr-valida" }).then(() => true)`);
      await clicar("abaCriar");
      await preencher({ entNome: "Caio", entEmail: "caio@exemplo.com", entSenha: "senha-forte-789" });
      await enviarForm("formEntrada");
      assert.equal(await tela(), "chat");
      assert.equal(await p.avaliar(`chrome.storage.sync.get("key").then((r) => r.key ?? null)`), null);
    }],
  ]);
} finally {
  await c.fechar();
}
process.exit(falhas ? 1 : 0);
