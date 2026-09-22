# Teste de Login/2FA — Mangaba Chrome v1.19.0

## Pré-requisitos

1. ✅ Extensão carregada em `chrome://extensions/` (Load unpacked)
2. ✅ Gateway configurado em Settings
3. ✅ Modelo selecionado (ex: qwen3-4b)

---

## Teste 1: Login Simples

### Cenário: GitHub Login
**URL:** https://github.com/login

**Passos:**

1. Abrir a extensão Mangaba Chrome (side panel)
2. Digitar tarefa: `"Faça login com seu usuário de teste dheiver2"`
3. O agente fará:
   - ✅ Detecta campo "Username or email address"
   - ✅ Preenche com username
   - ✅ Detecta campo "Password"
   - 🔐 **PAUSA AUTOMÁTICA**
   - ✅ Modal aparece: "🔐 Login Necessário"
   - ✅ Você completa login manualmente
   - ✅ Clica "✓ Pronto, continuar"
   - ✅ Modal desaparece
   - ✅ Agente re-observa a página
   - ✅ Continua a tarefa

**Resultado Esperado:**
```
Agente pausa → Modal abre → Você faz login → Clica OK → Agente retoma
```

---

## Teste 2: 2FA (Dois Fatores)

### Cenário: Google Login com 2FA
**URL:** https://accounts.google.com/login

**Passos:**

1. Abrir Mangaba Chrome
2. Digitar: `"Faça login na minha conta Google"`
3. Fluxo:
   - ✅ Preenche email
   - ✅ Preenche senha
   - 🔐 **PAUSA por login**
   - Você faz login até aparecer "Verificação de 2 passos"
   - ✅ Clica "✓ Pronto, continuar"
   - 📞 **PAUSA por 2FA** (se detectar "verificação", "2fa", "SMS", etc)
   - Você completa 2FA (SMS, email, app)
   - ✅ Clica "✓ Pronto, continuar"
   - ✅ Agente continua

**Resultado Esperado:**
```
Pausa login → Você faz → Clica OK → Pausa 2FA → Você faz → Clica OK → Continua
```

---

## Teste 3: Verificar Detecção de Campos

### Checklist de Detecção

Verificar se esses campos são reconhecidos como "password":

- [ ] `<input type="password">` — campo nativo
- [ ] `<input type="password" placeholder="Senha">` — com placeholder
- [ ] `<label>Senha <input>` — com label
- [ ] `<div aria-label="Password"><input></div>` — com aria-label

**Como testar:**
1. Abrir DevTools (F12)
2. Procurar por `<input type="password">`
3. Agente deveria parar nesse campo

---

## Teste 4: Modal UI

### Verificar Funcionamento da Modal

```javascript
// Na console do agente (DevTools > sidepanel.js):
showLoginModal()        // Abre modal
hideLoginModal()        // Fecha modal
```

**Checklist Visual:**

- [ ] Modal aparece no centro da tela
- [ ] Background escuro (overlay) atrás
- [ ] Botão "✓ Pronto, continuar" funciona
- [ ] Clique no botão → Modal fecha
- [ ] Prompt do agente resume

---

## Teste 5: Deadlock Prevention

### Verificar que Não Fica em Loop

Se o agente tentar clicar no campo de password 3 vezes:

- [ ] 1ª tentativa: pausa modal
- [ ] 2ª tentativa: warning "Loop detectado"
- [ ] 3ª tentativa: DEADLOCK → agente pausa com diagnóstico

```
⚠️ DEADLOCK DETECTADO
Ação repetida 3x: digitar {campo password}
🔍 Possível causa: Elemento não encontrado — página mudou
💡 Sugestão: Recarregue a página ou use 'snapshot'
```

---

## Teste 6: Sessão Storage

### Verificar Flags

Abra DevTools e execute:

```javascript
// Verificar que flags de pausa foram resetadas
console.log(sessionStorage.getItem("_loginAttempted"))   // null ou "1"
console.log(sessionStorage.getItem("_2faAttempted"))     // null ou "1"

// Limpar manualmente (if needed)
sessionStorage.removeItem("_loginAttempted")
sessionStorage.removeItem("_2faAttempted")
```

**Esperado:**
- Flags criadas quando pausa
- Flags removidas quando resumem

---

## Problemas Conhecidos & Soluções

### Problema: Modal não aparece

**Solução:**
1. Verificar console (F12) por erros
2. Testar função: `showLoginModal()` na console
3. Recarregar extensão em chrome://extensions/

### Problema: Botão OK não funciona

**Solução:**
1. Verificar se `#btnLoginOK` existe no HTML
2. Testar: `document.getElementById("btnLoginOK").click()`
3. Verificar event listener: `document.getElementById("btnLoginOK").onclick`

### Problema: Agente não pausa em campo password

**Solução:**
1. Verificar regex SENSITIVE_FIELD no console:
   ```javascript
   const SENSITIVE_FIELD = /senha|password|..../i;
   console.log(SENSITIVE_FIELD.test("Password"))  // true
   ```
2. Verificar que campo tem `type="password"`
3. Verificar label contém "password" ou "senha"

---

## Relatório de Teste

Use este template para reportar resultados:

```markdown
## Teste de Login — v1.19.0

**Data:** 22 de setembro de 2026
**Navegador:** Chrome 127.0
**Extensão Version:** 1.19.0

### Teste 1: GitHub Login
- [ ] Pausa ao detectar password? SIM/NÃO
- [ ] Modal aparece? SIM/NÃO
- [ ] Botão OK funciona? SIM/NÃO
- [ ] Agente retoma após OK? SIM/NÃO
- **Status:** ✅ PASSOU / ❌ FALHOU

### Teste 2: Google 2FA
- [ ] Pausa em password? SIM/NÃO
- [ ] Detecta 2FA? SIM/NÃO
- [ ] Duas pausas funcionam? SIM/NÃO
- **Status:** ✅ PASSOU / ❌ FALHOU

### Problemas Encontrados
1. [Descrever bug]
2. [Descrever comportamento esperado vs real]

**Recomendações:**
- [ ] Incluir screenshots
- [ ] Incluir DevTools console errors
- [ ] Incluir passos de reprodução
```

---

**Versão:** v1.19.0  
**Data:** 22 de setembro de 2026  
**Autor:** Dheiver Santos
