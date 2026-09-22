# 📋 MAPA DE ERROS — Mangaba Chrome v1.19.0

## ✅ Status da Build
- ✅ Compilação: Sucesso (516K built, 259K zip)
- ✅ Sintaxe JS: OK (5/5 arquivos)
- ✅ JSON válido: OK (manifest.json v1.19.0)
- ✅ Funções críticas: OK (showLoginModal, hideLoginModal, detectDeadlock, etc)

## 🔍 Verificação de Potenciais Erros

### 1. Event Listeners no Modal (btnLoginOK)
**Localização:** sidepanel.js, linha 1200+  
**Tipos de listeners:**
- ✅ onclick HTML direto
- ✅ JS assignment (btn.onclick = hideLoginModal)
- ✅ addEventListener com bubbling false
- ✅ keydown Enter support
- ⚠️ setInterval retry a cada 1s (pode ser agressivo)

**Possíveis erros:**
- ❓ Modal não fecha se Promise não resolve
- ❓ Timeout 5min nem sempre dispara
- ❓ Multiple event listeners causam múltiplos fires

---

### 2. Session Storage Flags
**Localização:** sidepanel.js, linhas ~100-150  
**Verificações:**
- ✅ sessionStorage.setItem("_loginAttempted", "1")
- ✅ sessionStorage.removeItem("_loginAttempted")
- ⚠️ Flags não limpam se extensão reinicia

**Possíveis erros:**
- ❓ Flag preso em sessionStorage → agente fica travado em pausa infinita
- ❓ Múltiplas abas com sessionStorage compartilhado

---

### 3. Deadlock Detection
**Localização:** sidepanel.js, `detectDeadlock()` ~linha 900  
**Lógica:**
- Rastreia lastActions (max 3 repetições)
- Diagnostica causa se 3 repeats
- Para após 2 avisos

**Possíveis erros:**
- ❓ lastActions array não limpa entre tarefas
- ❓ Ação "screenshot" conta como repetição (falso positivo)
- ❓ Aguardava_carregamento causa deadlock falso

---

### 4. MCP Status UI
**Localização:** sidepanel.js, `updateMcpStatus()` ~linha 1050  
**Dependências:**
- ✅ DOM: #mcpStatus, #mcpList, #btnRefreshMcps
- ✅ Fetch: GET /v1/models (gateway)
- ⚠️ Timeout: 5s default

**Possíveis erros:**
- ❓ Gateway offline → panel fica vazio
- ❓ CORS error ao chamar gateway
- ❓ Botão refresh não faz POST ou GET correto

---

### 5. Snapshot Segmentado
**Localização:** background.js, `segmentaSnapshotFn()` ~linha 400  
**Lógica:**
- Detecta 5 seções: header, nav, main, sidebar, footer
- Organiza 80 elementos viewport + 80 offscreen

**Possíveis erros:**
- ❓ Página com layout incomum (CSS Grid, Flexbox) não reconhecido
- ❓ Elementos com role vazio/mal formado
- ❓ Limite 80 elementos insuficiente em SPA dinâmicas

---

### 6. Offline Mode (llama.cpp)
**Localização:** offline.js, `runOfflineAgent()` ~linha 33  
**Requisitos:**
- Servidor: localhost:8778 (llama.cpp)
- Modelo: qwen-1b-q8
- Tool-calling: Nativo JSON Schema

**Possíveis erros:**
- ❌ localhost:8778 não acessível → agente não inicia
- ❌ Modelo não tem tool-calling (llama.cpp sem --jinja)
- ❌ tool_calls parsing quebra em response_format
- ⚠️ Timeout 30s pode ser curto para M2/M1

---

### 7. Minificação/Obfuscação
**Localização:** build.sh, flags Terser  
**Configuração:**
- ✅ --compress passes=3
- ✅ --mangle
- ✅ Remove source maps

**Possíveis erros:**
- ❓ Variable names mangled → debugging impossível
- ❓ Funções críticas renomeadas → chrome.runtime.sendMessage quebra?
- ❓ Source map não removido corretamente

---

## 🧪 Como Testar Erros

### Teste 1: Modal Interação
```javascript
// No console (F12) da side panel:
showLoginModal(5000);  // Abre por 5 seg
// Esperado: Modal fecha automaticamente após timeout
```

### Teste 2: Deadlock
```javascript
// Simular 3 ações repetidas:
for (let i = 0; i < 3; i++) {
  detectDeadlock({ type: "click", target: "username" });
}
// Esperado: console mostra "Deadlock detectado"
```

### Teste 3: MCP Status
```javascript
// No console:
updateMcpStatus();
// Verificar: #mcpStatus fica visible?
// Verificar: #mcpList tem servidores listados?
```

### Teste 4: Snapshot
```javascript
// Background script:
chrome.tabs.query({active: true}, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, {type: "SNAPSHOT"}, (resp) => {
    console.log("Snapshot:", resp.elements.length, "elementos");
  });
});
```

### Teste 5: Offline Mode
```javascript
// Verificar se localhost:8778 está rodando:
curl http://localhost:8778/v1/models

// Se disponível:
toggleOfflineMode(true);
runOfflineAgent("Clique em Submit", []);
```

---

## 📊 Resumo de Riscos

| Componente | Risco | Severidade | Teste |
|-----------|-------|-----------|-------|
| Modal Close | Promise não resolve | 🔴 Alta | Test1 |
| Session Storage | Flag preso | 🟡 Média | Manual |
| Deadlock Detect | False positives | 🟡 Média | Test2 |
| MCP Status | Gateway offline | 🟡 Média | Test3 |
| Snapshot | Layout não reconhecido | 🟡 Média | Test4 |
| Offline llama.cpp | localhost:8778 não existe | 🔴 Alta | Test5 |
| Minificação | Debug impossível | 🟢 Baixo | Build |

---

**Gerado:** 22/set/2026  
**Versão:** v1.19.0  
**Status:** Pronto para testes em Chrome
