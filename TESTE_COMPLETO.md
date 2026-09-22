# Teste Local Completo — v1.19.0

## 🚀 Setup (5 minutos)

### Passo 1: Carregar Extensão
```bash
# 1. Abrir Chrome
open -a "Google Chrome"

# 2. Ir para extensões
chrome://extensions/

# 3. Ativar "Developer mode" (canto superior direito)

# 4. Clicar "Load unpacked"

# 5. Selecionar pasta:
/Users/dheiver/Downloads/Projetos/mangaba-chrome/

# ✅ Extensão carregada
```

---

## 🧪 Teste 1: Teste Automatizado (3 minutos)

### Execute na console do side panel:

```bash
# 1. Abrir extensão Mangaba Chrome (side panel)

# 2. Pressionar F12 (DevTools)

# 3. Colar este comando:
```

```javascript
// Copiar e colar na console:
fetch("TEST_LOCAL.js").then(r => r.text()).then(code => eval(code));

// OU manualmente:
// 1. Ir até o final deste arquivo (TEST_LOCAL.js)
// 2. Copiar código inteiro
// 3. Colar na console (F12)
```

### Resultado esperado:
```
🧪 INICIANDO TESTE LOCAL COMPLETO...

📋 TESTE 1: Funções existem?
  ✓ showLoginModal: ✅
  ✓ hideLoginModal: ✅
  ✓ updateMcpStatus: ✅

📋 TESTE 2: Modal HTML existe?
  ✓ #pauseLogin: ✅ Encontrada
  ✓ #btnLoginOK: ✅ Encontrado

📋 TESTE 3: Event listeners do botão?
  ✓ onclick: ✅ Existe
  ✓ getAttribute onclick: ✅ Existe

📋 TESTE 4: Testar modal visualmente (vai abrir por 3 seg)
  ℹ️ A modal deve aparecer no centro da tela...
  ✓ Modal abriu: ✅ SIM
  ✓ Modal resolveu: ✅ SIM

📋 TESTE 5: Testar clique no botão (vai abrir por 10 seg)
  ℹ️ Clique no botão '✓ Pronto, continuar' AGORA!
  [VOCÊ CLICA AQUI]
  ✓ Você clicou no botão: ✅ SIM
  ✓ Modal fechou: ✅ SIM

🎉 TESTE LOCAL COMPLETO FINALIZADO!

✅ Checklist:
  [✅] Funções existem
  [✅] Modal HTML existe
  [✅] Botão tem listeners
  [✅] Modal abre/fecha
  [✅] Timeout funciona
```

---

## 🌐 Teste 2: Teste Real com GitHub (5 minutos)

### Passo 1: Navegar para GitHub
```
https://github.com/login
```

### Passo 2: Executar tarefa no Mangaba
```
"Clique no campo username e digite 'test'"
```

### Passo 3: Verificar Modal
Esperado:
1. ✅ Agente preenche username
2. ✅ Agente detecta campo "Password"
3. ✅ Modal abre: "🔐 Login Necessário"
4. ✅ Clique botão "✓ Pronto, continuar"
5. ✅ Modal fecha
6. ✅ Agente retoma
7. ✅ Console mostra: "✅ Modal fechada"

### Se algo falhar:
```javascript
// Verificar no console:
console.log(modalVisible)              // deve ser false
sessionStorage.getItem("_loginAttempted")  // deve ser null
showLoginModal()                        // testar manualmente
```

---

## 📊 Teste 3: Teste de Timeout (2 minutos)

### Executar na console:
```javascript
// Abrir modal por 10 seg
showLoginModal(10000);

// NÃO clique no botão - deixar timeout acontecer
// Após 10 seg, modal deve fechar automaticamente
// Console deve mostrar: "⏱️ Timeout 5 min — retomando"
```

---

## ✅ Checklist Final

Execute esto na console para validar tudo:

```javascript
// Copiar blocos de código do final de TEST_LOCAL.js
testShowModal();     // Abre modal 3 seg
// Esperar fechar...

testLogin();         // Simula fluxo login
// Esperar 10 seg...

testSnapshot();      // Verifica snapshot
testDeadlock();      // Verifica deadlock
```

---

## 🐛 Debug: Se algo não funcionar

### Modal não abre?
```javascript
// Verificar no console:
document.getElementById("pauseLogin")     // deve retornar elemento
showLoginModal()                          // tentar manualmente
```

### Botão não funciona?
```javascript
// Verificar listeners:
const btn = document.getElementById("btnLoginOK");
console.log(btn.onclick);                 // deve ser function
btn.click();                              // testar clique direto
```

### Promise não resolve?
```javascript
// Verificar estado:
console.log(loginResolve)                 // deve ser function
console.log(modalVisible)                 // deve ser boolean
```

### Limpar storage:
```javascript
sessionStorage.removeItem("_loginAttempted");
sessionStorage.removeItem("_2faAttempted");
```

---

## 📋 Relatório de Teste

Após completar, crie um relatório com:

```markdown
## Teste Local Completo — v1.19.0

**Data:** 22 de setembro de 2026
**Navegador:** Chrome 127
**Sistema:** macOS

### Testes Automatizados
- [ ] Funções existem: SIM/NÃO
- [ ] Modal HTML: SIM/NÃO
- [ ] Listeners: SIM/NÃO
- [ ] Modal abre/fecha: SIM/NÃO
- [ ] Timeout funciona: SIM/NÃO

### Teste Real (GitHub)
- [ ] Campo username preenche: SIM/NÃO
- [ ] Modal abre em password: SIM/NÃO
- [ ] Botão OK funciona: SIM/NÃO
- [ ] Agente retoma: SIM/NÃO

### Teste de Timeout
- [ ] Modal abre 10 seg: SIM/NÃO
- [ ] Fecha automaticamente: SIM/NÃO

### Resultado Final
[ ] PASSOU — Pronto para beta
[ ] FALHOU — Bugs encontrados:
    1. [descrição]
    2. [descrição]
```

---

## 🎯 Próximos Passos

Se todos testes **PASSARAM**:
1. ✅ Carregar em Chrome Web Store
2. ✅ Compartilhar com beta testers
3. ✅ Coletar feedback
4. ✅ v2.0.0 planning

Se algum teste **FALHOU**:
1. ⚠️ Coletar descrição do bug
2. ⚠️ Screenshots/logs da console
3. ⚠️ Criar issue no GitHub
4. ⚠️ Corrigir e re-testar

---

**Tempo total esperado:** ~15 minutos  
**Nível de confiança:** 95%+
