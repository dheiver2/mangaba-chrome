# 📦 Guia: Carregar Extensão Mangaba Chrome v1.19.0

## ✅ Pré-requisitos
- ✅ Build completo: `npm run build:dev` (já feito)
- ✅ Pasta dist/ existe com todos os arquivos
- ✅ Chrome instalado

## 🚀 Passo a Passo (Manual via UI)

### 1️⃣ Abrir Extensões
```bash
# Abrir Chrome nas extensões:
open -a "Google Chrome"
# Depois: Cmd+Shift+L (abrir últimas abas)
# OU digitar na barra de endereço: chrome://extensions/
```

### 2️⃣ Habilitar Developer Mode
No canto superior direito da página chrome://extensions/:
- [ ] Clicar no toggle "Developer mode" (fica azul)

### 3️⃣ Load Unpacked
Após habilitar Developer mode, aparece botão:
- [ ] Clicar "Load unpacked"
- [ ] Selecionar pasta: `/Users/dheiver/Downloads/Projetos/mangaba-chrome/`
- [ ] Confirmar

### 4️⃣ Extensão Carregada ✅
Você verá:
```
Mangaba AI
🥭 mangaba.ai [1.19.0]
✅ Enabled
ID: ... (gerado automaticamente)
```

### 5️⃣ Abrir Extensão
- [ ] Clicar no ícone da extensão (🥭) na barra de ferramentas
- [ ] Selecionar "Mangaba AI"
- [ ] Side panel abre com a interface

## 🧪 Testar Após Carregar

### Teste 1: Navegue para https://github.com/login
```javascript
// No console (F12 na side panel):
console.log("✅ Extensão carregada")
showLoginModal(5000)
// Esperado: Modal com "🔐 Login Necessário" apareça
```

### Teste 2: Verificar MCP Status
```javascript
updateMcpStatus()
// Verificar se #mcpStatus fica visível com servidores
```

### Teste 3: Testar Snapshot Segmentado
```javascript
chrome.tabs.query({active: true}, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, {type: "SNAPSHOT"}, resp => {
    console.log("Snapshot:", resp.elements?.length || "erro");
  });
});
```

### Teste 4: Offline Mode
```javascript
// Se localhost:8778 (llama.cpp) estiver rodando:
detectOfflineModel().then(ok => {
  console.log("Offline mode:", ok ? "✅ OK" : "❌ llama.cpp não encontrado");
});
```

## 🛠️ Troubleshooting

### ❌ "Load unpacked" não aparece
→ Habilitar "Developer mode" primeiro

### ❌ Erro: "Manifest not valid"
→ Verificar se manifest.json está em `/dist/` (não em raiz)

### ❌ Extensão carrega mas side panel vazio
→ Abrir DevTools (F12) e verificar console para erros

### ❌ Modal não abre
→ Verificar se função `showLoginModal` existe
```javascript
typeof showLoginModal  // deve retornar "function"
```

## 📝 Notas
- Extension ID será aleatório (dev mode)
- Dados armazenados em storage.sync e sessionStorage
- Offline mode requer llama.cpp em localhost:8778
- Fonte não é minificada em `npm run build:dev`

## 🎯 Próximos Passos
1. ✅ Carregar extensão
2. ✅ Abrir https://github.com/login
3. ✅ Testar modal (deve pausar ao detectar password field)
4. ✅ Seguir TEST_MANUAL.md para testes completos

---
**v1.19.0** • 22 de setembro de 2026
