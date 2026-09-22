# Teste Manual — Login/2FA v1.19.0

## Setup Rápido (5 minutos)

```bash
# 1. Instalar dependências (opcional, para build)
cd /Users/dheiver/Downloads/Projetos/mangaba-chrome
npm install --legacy-peer-deps

# 2. Abrir Chrome extensions
open "chrome://extensions/"

# 3. Ativar "Developer mode" (canto superior direito)

# 4. Clicar "Load unpacked"

# 5. Selecionar pasta: /Users/dheiver/Downloads/Projetos/mangaba-chrome/
```

---

## Teste 1: Visualizar a Modal

### Teste Direto na Console

Abra DevTools (F12) no side panel e execute:

```javascript
// 1. Abrir a modal
showLoginModal()

// Resultado: Modal aparece no centro da tela com:
// - Fundo escuro (overlay)
// - "🔐 Login Necessário"
// - Botão "✓ Pronto, continuar"

// 2. Clicar botão OK (ou executar):
hideLoginModal()

// Resultado: Modal desaparece, promise resolve
```

**Verificação:**
```javascript
// Verificar funções existem
typeof showLoginModal      // "function"
typeof hideLoginModal      // "function"

// Verificar listener do botão
document.getElementById("btnLoginOK").onclick
// Result: function hideLoginModal()
```

---

## Teste 2: Simular Fluxo Completo

### Passo 1: Preparar

1. Abrir Mangaba Chrome side panel
2. Configurar modelo (ex: qwen3-4b)
3. Configurar gateway (ex: http://localhost:8080)

### Passo 2: Executar Tarefa

**Digite na caixa de chat:**
```
"Acesse https://github.com/login e preencha username 'test' no campo Username"
```

**Agente fará:**
1. Navega para GitHub login
2. Detecta campo "Username or email address"
3. Clica e preenche com "test"
4. Detecta próximo campo: "Password"
5. **PAUSA**: Abre modal "🔐 Login Necessário"

**Você faz:**
1. Vê a modal na tela
2. Clica botão "✓ Pronto, continuar"
3. Modal fecha

**Agente retoma:**
1. Re-fotografa a página
2. Continua tarefa ou para se concluída

---

## Teste 3: Verificar Logs

### Console Logs

Abra DevTools (F12) do side panel e veja se aparecem:

```
✓ Campo de senha detectado — pausando para você fazer login
✓ Verificação de 2 passos detectada — pausando com timeout de 5 min
```

### Verificar Storage

```javascript
// Session storage (durante pausa)
sessionStorage.getItem("_loginAttempted")    // "1" quando pausado
sessionStorage.getItem("_2faAttempted")      // "1" quando pausado

// Após resumir (clique OK)
sessionStorage.getItem("_loginAttempted")    // null (foi limpo)
```

---

## Teste 4: Testar Diferentes Sites

### Sites com Login Recomendados

| Site | URL | Tipo |
|------|-----|------|
| **GitHub** | github.com/login | Simples |
| **Google** | accounts.google.com | Com 2FA |
| **LinkedIn** | linkedin.com/login | Complexo |
| **Facebook** | facebook.com/login | Complexo |

### Teste GitHub (Simples)

```bash
# No side panel Mangaba:
"Acesse github.com/login e preencha o formulário para fazer login com usuario 'test' e senha 'test123'"

# Esperado:
# 1. Agente preenche username
# 2. Agente para ao ver password
# 3. Modal abre
# 4. Você clica OK
# 5. Agente retoma (pode ficar em erro se credenciais inválidas, mas teste passou)
```

### Teste Google (Com 2FA)

```bash
# No side panel Mangaba:
"Acesse google.com/login e faça login na sua conta"

# Esperado:
# 1. Agente preenche email/password
# 2. Pausa 1ª vez (password)
# 3. Você clica OK, continua no Google
# 4. Quando aparecer verificação 2 passos, Mangaba detecta e pausa
# 5. Você completa SMS/email/app
# 6. Clica OK novamente
# 7. Agente retoma
```

---

## Teste 5: Deadlock Detection

### Simular Loop Infinito

Se agente ficar tentando clicar no mesmo botão 3x:

**Esperado:**
```
⚠️ Loop detectado: repetindo "clicar". Se continuar, vou parar...
[2º clique na mesma coisa]
❌ DEADLOCK DETECTADO
Ação repetida 3x: clicar [5]
🔍 Possível causa: Elemento [5] não encontrado — página mudou
💡 Sugestão: Recarregue a página ou use 'snapshot'
```

**Como testar:**
1. Forçar erro no LLM (usar modelo 1B que erra mais)
2. Deixar agente tentar mesma ação 3x
3. Verificar que deadlock é detectado

---

## Teste 6: Verificar Regex de Detecção

### Campos que Deveriam Pausar

Abra console do navegador (F12, não do side panel):

```javascript
// Regex de detecção de password (do sidepanel.js)
const SENSITIVE_FIELD = /senha|password|cart[ãa]o|cvv|cpf|cnpj|\brg\b|c[óo]digo|token|2fa|otp|pin|c[óo]digo de verifica[çc][ãa]o|c[óo]digo .{0,10}f?fa/i;

// Testar diferentes labels
console.log(SENSITIVE_FIELD.test("Password"))           // true
console.log(SENSITIVE_FIELD.test("Senha"))              // true
console.log(SENSITIVE_FIELD.test("2FA Code"))           // true
console.log(SENSITIVE_FIELD.test("Código de verificação"))  // true
console.log(SENSITIVE_FIELD.test("Username"))           // false
```

**Esperado:** `true` para campos sensíveis, `false` para outros

---

## Checklist Final

- [ ] Modal aparece ao digitar em campo password
- [ ] Botão OK fecha modal
- [ ] Agente retoma após clique OK
- [ ] 2FA é detectada em sites que usam
- [ ] Session storage flags funcionam
- [ ] Deadlock é detectado após 3 repeticoes
- [ ] Console não tem erros (vermelho)
- [ ] Funciona em múltiplos sites

---

## Troubleshooting

### "Modal não aparece"
```javascript
// Debug no console do side panel:
document.getElementById("pauseLogin")              // deve retornar elemento
document.getElementById("pauseLogin").style.display  // "none" ou "flex"
showLoginModal()                                    // testar manualmente
```

### "Botão OK não funciona"
```javascript
// Verificar listener:
document.getElementById("btnLoginOK").onclick      // deve ser function
// Se vazio, adicionar:
document.getElementById("btnLoginOK").onclick = hideLoginModal
```

### "Agente não pausa em password"
```javascript
// Verificar se campo é detectado:
document.querySelectorAll('input[type="password"]')  // deve ter elementos
// Se vazio, o site usa campo customizado (testar "snapshot" no agente)
```

### "SessionStorage não limpa"
```javascript
// Limpar manualmente:
sessionStorage.removeItem("_loginAttempted")
sessionStorage.removeItem("_2faAttempted")
```

---

**Versão:** v1.19.0  
**Data:** 22 de setembro de 2026  
**Tempo estimado de teste:** 15-30 minutos
