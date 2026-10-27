// Tarefas reais pedidas ao agente (Hermes + Mangaba Router) pelo painel da extensão,
// num Chrome isolado. Gasta cota da chave. Rodar com:
//   MANGABA_KEY=mr-... node tests/agente-hermes.mjs
import assert from "node:assert/strict";
import { abrirChrome, rodarCasos, espera } from "./chrome-teste.mjs";

const CHAVE = process.env.MANGABA_KEY;
if (!CHAVE) { console.error("defina MANGABA_KEY"); process.exit(2); }

async function tarefa(c, texto, limiteMs = 360000) {
  // o painel de teste fica noutra janela: aponta as ações para a janela da página
  await c.painel.avaliar(`(async () => {
    const ws = await chrome.windows.getAll({ populate: true });
    myWindowId = ws.find((w) => w.tabs.some((t) => !t.url.startsWith("chrome-extension://"))).id;
    cfg.key = ${JSON.stringify(CHAVE)};
    document.getElementById("chat").innerHTML = "";
    runHermes(${JSON.stringify(texto)});
    return true;
  })()`);
  const inicio = Date.now();
  await espera(1500);
  while (Date.now() - inicio < limiteMs) {
    if (await c.painel.avaliar("agentRun === null")) break;
    await espera(2000);
  }
  return c.painel.avaliar(`JSON.stringify({
    status: [...document.querySelectorAll(".agentstatus")].pop()?.innerText || "",
    resposta: [...document.querySelectorAll(".msg.assistant, .assistant")].map((e) => e.innerText).join("\\n").slice(-1500),
    erros: [...document.querySelectorAll(".msg.err, .err")].map((e) => e.innerText).join(" | "),
  })`).then(JSON.parse);
}

const c = await abrirChrome("about:blank");
const url = () => c.naPagina("location.href");
const ir = async (u) => { await c.acao("navegar", { url: u }); await espera(2000); };
let falhas = 1;
try {
  falhas = await rodarCasos([
    ["Busca na Wikipédia e responde com o conteúdo do artigo", async () => {
      await ir("https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:P%C3%A1gina_principal");
      const r = await tarefa(c, "Use a busca desta página da Wikipédia para encontrar o artigo 'Hino Nacional Brasileiro' e me diga quem compôs a música.");
      console.log("   ↳", JSON.stringify(r).slice(0, 400));
      assert.equal(r.erros, "", r.erros);
      assert.match(await url(), /Hino_Nacional_Brasileiro/);
      assert.match(r.resposta, /Francisco Manuel/i);
    }],
    ["Preenche e envia um formulário completo, conferindo o resultado", async () => {
      await ir("https://httpbin.org/forms/post");
      const r = await tarefa(c, "Preencha o pedido desta página: nome Ana Souza, telefone 82999990000, e-mail ana@exemplo.com, tamanho Medium, coberturas Bacon e Onion, instruções de entrega 'Deixar na portaria'. Envie o pedido e confirme o que foi recebido.");
      console.log("   ↳", JSON.stringify(r).slice(0, 400));
      const pagina = String(await c.naPagina("document.body.innerText"));
      for (const v of ["Ana Souza", "82999990000", "ana@exemplo.com", "medium", "bacon", "onion", "Deixar na portaria"])
        assert.ok(pagina.includes(v), `o pedido enviado não tem "${v}"`);
    }],
    ["Navega pela paginação e lê o resultado", async () => {
      await ir("https://books.toscrape.com/");
      const r = await tarefa(c, "Vá para a segunda página da lista de livros desta loja e me diga o título do primeiro livro dessa página.");
      console.log("   ↳", JSON.stringify(r).slice(0, 400));
      assert.match(await url(), /page-2\.html/);
      assert.match(r.resposta, /In Her Wake/i);
    }],
  ]);
} finally {
  await c.fechar();
}
process.exit(falhas ? 1 : 0);
