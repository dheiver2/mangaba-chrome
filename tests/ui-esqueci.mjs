// Tela de entrada: o botão "Esqueci minha senha" pede o link e mostra a mensagem genérica.
// Usa um e-mail que não existe, então nenhum e-mail é enviado. Rodar com: node tests/ui-esqueci.mjs
import assert from "node:assert/strict";
import { abrirChrome, espera } from "./chrome-teste.mjs";

const c = await abrirChrome("https://example.com/");
try {
  await espera(1500);
  await c.painel.avaliar(`(() => { document.getElementById("entEmail").value = "ninguem-ui-teste@exemplo.com"; document.getElementById("btnEsqueci").click(); return true; })()`);
  let texto = "";
  for (let i = 0; i < 30; i++) {
    await espera(500);
    texto = await c.painel.avaliar(`document.getElementById("entErro").textContent`);
    if (texto && !texto.startsWith("Enviando")) break;
  }
  console.log("   ↳ mensagem:", texto);
  assert.match(texto, /Se o e-mail estiver cadastrado/);
  console.log("OK: botão Esqueci minha senha funciona na tela de entrada");
} finally {
  await c.fechar?.();
}
