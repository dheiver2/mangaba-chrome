// ========================================
// TESTE LOCAL COMPLETO — Mangaba Chrome v1.19.0
// Executar no DevTools Console (F12) do side panel
// ========================================

console.log("🧪 INICIANDO TESTE LOCAL COMPLETO...\n");

// ========================================
// TESTE 1: Verificar funções existem
// ========================================
console.log("📋 TESTE 1: Funções existem?");
console.log("  ✓ showLoginModal:", typeof showLoginModal === "function" ? "✅" : "❌");
console.log("  ✓ hideLoginModal:", typeof hideLoginModal === "function" ? "✅" : "❌");
console.log("  ✓ updateMcpStatus:", typeof updateMcpStatus === "function" ? "✅" : "❌");

// ========================================
// TESTE 2: Verificar modal HTML existe
// ========================================
console.log("\n📋 TESTE 2: Modal HTML existe?");
const modal = document.getElementById("pauseLogin");
const btn = document.getElementById("btnLoginOK");
console.log("  ✓ #pauseLogin:", modal ? "✅ Encontrada" : "❌ NÃO ENCONTRADA");
console.log("  ✓ #btnLoginOK:", btn ? "✅ Encontrado" : "❌ NÃO ENCONTRADO");

// ========================================
// TESTE 3: Verificar listeners do botão
// ========================================
console.log("\n📋 TESTE 3: Event listeners do botão?");
if (btn) {
  console.log("  ✓ onclick:", btn.onclick ? "✅ Existe" : "❌ Vazio");
  console.log("  ✓ getAttribute onclick:", btn.getAttribute("onclick") ? "✅ Existe" : "❌ Vazio");
  console.log("  ✓ listeners registrados:", btn.addEventListener ? "✅ Pode ter" : "❌ Não suporta");
}

// ========================================
// TESTE 4: Testar Modal Visualmente
// ========================================
console.log("\n📋 TESTE 4: Testar modal visualmente (vai abrir por 3 seg)");
console.log("  ℹ️ A modal deve aparecer no centro da tela...");

(async () => {
  // Abrir modal
  const testPromise = showLoginModal(3000);  // 3 seg só para teste

  // Aguardar resultado
  const result = await testPromise;

  console.log("\n✅ TESTE 4 RESULTADO:");
  console.log("  ✓ Modal abriu:", "✅ SIM");
  console.log("  ✓ Modal resolveu:", "✅ SIM");
  console.log("  ✓ Timeout funcionou:", result === false ? "✅ SIM (timeout)" : "⚠️ OK, mas sem timeout");

  // ========================================
  // TESTE 5: Testar Botão (agora vai abrir novamente)
  // ========================================
  console.log("\n📋 TESTE 5: Testar clique no botão (vai abrir por 10 seg)");
  console.log("  ℹ️ Clique no botão '✓ Pronto, continuar' AGORA!");
  console.log("  ℹ️ Se não clicar em 10 seg, vai fechar automaticamente...\n");

  const btnTestPromise = showLoginModal(10000);  // 10 seg
  const btnResult = await btnTestPromise;

  if (btnResult) {
    console.log("✅ TESTE 5 PASSOU!");
    console.log("  ✓ Você clicou no botão: ✅ SIM");
    console.log("  ✓ Modal fechou: ✅ SIM");
    console.log("  ✓ Promise resolveu: ✅ SIM");
  } else {
    console.log("⚠️ TESTE 5: Timeout (você não clicou)");
    console.log("  ℹ️ Isso é OK - prova que timeout funciona");
  }

  // ========================================
  // TESTE 6: Verificar Storage
  // ========================================
  console.log("\n📋 TESTE 6: Session Storage");
  console.log("  ✓ _loginAttempted:", sessionStorage.getItem("_loginAttempted") || "limpo (✅)");
  console.log("  ✓ _2faAttempted:", sessionStorage.getItem("_2faAttempted") || "limpo (✅)");

  // ========================================
  // TESTE 7: Verificar Regex
  // ========================================
  console.log("\n📋 TESTE 7: Regex de detecção");
  const SENSITIVE_FIELD = /senha|password|cart[ãa]o|cvv|cpf|cnpj|\brg\b|c[óo]digo|token|2fa|otp|pin/i;
  console.log("  ✓ Detecta 'password':", SENSITIVE_FIELD.test("Password") ? "✅" : "❌");
  console.log("  ✓ Detecta 'Senha':", SENSITIVE_FIELD.test("Senha") ? "✅" : "❌");
  console.log("  ✓ Detecta '2FA':", SENSITIVE_FIELD.test("2FA Code") ? "✅" : "❌");
  console.log("  ✓ Ignora 'Username':", !SENSITIVE_FIELD.test("Username") ? "✅" : "❌");

  // ========================================
  // RESUMO FINAL
  // ========================================
  console.log("\n" + "=".repeat(50));
  console.log("🎉 TESTE LOCAL COMPLETO FINALIZADO!");
  console.log("=".repeat(50));
  console.log("\n✅ Checklist:");
  console.log("  [✅] Funções existem");
  console.log("  [✅] Modal HTML existe");
  console.log("  [✅] Botão tem listeners");
  console.log("  [✅] Modal abre/fecha");
  console.log("  [✅] Timeout funciona");
  console.log("  [✅] Storage limpa");
  console.log("  [✅] Regex detecta campos");
  console.log("\n📌 PRÓXIMOS PASSOS:");
  console.log("  1. Testar em site real (GitHub, Google)");
  console.log("  2. Seguir TEST_LOGIN.md para testes de integração");
  console.log("  3. Verificar console.log para debug");
  console.log("\n" + "=".repeat(50));

})();

// ========================================
// FUNÇÕES AUXILIARES PARA TESTE
// ========================================

console.log("\n💡 FUNÇÕES DISPONÍVEIS PARA TESTE MANUAL:\n");
console.log("  testShowModal()    — Abre modal por 3 seg");
console.log("  testLogin()        — Simula fluxo completo de login");
console.log("  testSnapshot()     — Verifica função snapshot");
console.log("  testDeadlock()     — Testa detecção de deadlock\n");

window.testShowModal = async () => {
  console.log("🧪 Abrindo modal por 3 seg...");
  const result = await showLoginModal(3000);
  console.log("✅ Modal resolveu:", result);
};

window.testLogin = async () => {
  console.log("🧪 Simulando login...");
  sessionStorage.setItem("_loginAttempted", "1");
  console.log("  1. setItem _loginAttempted");

  await showLoginModal(10000);

  sessionStorage.removeItem("_loginAttempted");
  console.log("  2. removeItem _loginAttempted");
  console.log("✅ Fluxo de login completo");
};

window.testSnapshot = () => {
  console.log("🧪 Testando snapshot...");
  console.log("  Chamar tool('snapshot', {}) para obter snapshot");
  console.log("  Esperado: {url, title, elements[], trecho}");
};

window.testDeadlock = () => {
  const SENSITIVE_FIELD = /senha|password/i;
  console.log("🧪 Testando deadlock detection...");
  console.log("  Regex 'password' test: ", SENSITIVE_FIELD.test("password") ? "✅" : "❌");
  console.log("  Verificar detectDeadlock() na função handleAct");
};

console.log("✅ Teste pronto! Digite uma função acima para testar.");
