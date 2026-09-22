# Segurança — Mangaba Chrome v1.19.0

## Princípios de Segurança

### 1️⃣ Nunca Armazenar Secrets Localmente

**❌ NÃO fazemos:**
```javascript
// Ruim: API key no localStorage
localStorage.setItem("api_key", "sk-abc123...")
```

**✅ FAZEMOS:**
```javascript
// Bom: Gateway remoto com rate-limit
const gateway = "https://llm.mangaba.ia.br/v1/chat/completions"
// Chave fica no servidor, não no cliente
```

### 2️⃣ Validação de Origem

```javascript
// Validar que requests vêm de domínios esperados
const ALLOWED_GATEWAYS = [
  "https://llm.mangaba.ia.br",
  "https://api.openai.com",
];
```

### 3️⃣ Dados do Usuário

**O que armazenamos localmente (encriptado):**
- ✅ Histórico de chat (IndexedDB, 30 dias TTL)
- ✅ Agent history (últimas 5 tarefas)
- ✅ Configurações de preferência

**O que NUNCA armazenamos:**
- ❌ Senhas
- ❌ Tokens de 2FA
- ❌ Cartão de crédito
- ❌ SSN/documentos
- ❌ API keys

### 4️⃣ Permissões Mínimas

```json
{
  "permissions": [
    "sidePanel",      // UI
    "activeTab",      // Detectar aba
    "scripting",      // Injetar scripts
    "storage",        // localStorage
    "tabs"            // Gerenciar abas
  ],
  "host_permissions": [
    "http://*/*",     // Qualquer site HTTP
    "https://*/*"     // Qualquer site HTTPS
  ]
}
```

**Por que não pedimos mais:**
- Não lemos histórico de navegação
- Não acessamos webcam/microfone
- Não lemos downloads
- Não modificamos configurações do navegador

## Proteção Contra Engenharia Reversa

### Build Process

```bash
# 1. Minificação (80% redução)
terser sidepanel.js --compress --mangle

# 2. Obfuscação
terser sidepanel.js --mangle=reserved

# 3. Remover source maps
# (production build não inclui .map)

# 4. Verificar tamanho
du -sh dist/
```

### Técnicas Aplicadas

| Técnica | Resultado |
|---------|-----------|
| Minificação | `function handleAct(act,snap,passo)` |
| Obfuscação | `function a(b,c,d)` |
| Compressão | .js → .gz (50% menores) |
| Remoção de comentários | -40% linhas |
| Tree-shaking | Remove código morto |

## Auditoria de Segurança

### Checklist Periódico

- [ ] Verificar permissões necessárias
- [ ] Revisar storage local (não guardar secrets)
- [ ] Testar CORS/CSP headers
- [ ] Verificar injeção de conteúdo
- [ ] Revisar URLs de gateway
- [ ] Testar com Charles Proxy

### Ferramentas

```bash
# Scan de vulnerabilidades
npm audit

# Análise estática
eslint --security *.js

# Decompile check (manual)
# Tentar desofuscar com deobfuscator.io
```

## Relatório de Vulnerabilidades

**Encontrou um problema?** Por favor NÃO:
- 🚫 Publicar issue pública
- 🚫 Postar em Twitter/Discord
- 🚫 Vender para bug bounty

**Faça isto:**
1. Email: security@mangaba.ai
2. Descrição: versão, passos, impacto
3. PGP key: (disponível no site)
4. Aguarde resposta em 48h

## Conformidade

- ✅ **LGPD** — Dados de usuários (artigo 5)
- ✅ **GDPR** — Privacy by design
- ✅ **Chrome Web Store** — Política de segurança
- ✅ **OWASP Top 10** — Proteção contra ataques comuns

## Versão

- **v1.19.0** — Build automatizado com obfuscação
- **Data:** 22 de setembro de 2026
- **Revisor:** Dheiver Santos
