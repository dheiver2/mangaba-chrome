# Plano — jornada com login obrigatório + chave do Mangaba Router

Data: 31/10/2026 · Extensão 2.16.0 · Backend `backend/` (Vercel + Neon)

## Hoje (como está no código)

- A conta é **opcional** e fica escondida em ⚙︎ Configurações; só sincroniza histórico e memória (`sync.js`).
- A chave do Router (`mr-...`) é colada em ⚙︎ e só é checada na hora da tarefa (`runHermes` em `hermes.js`: "Sem chave").
- A chave fica em `chrome.storage.sync`, que é sincronizado pela conta Google do Chrome. Isso contradiz a política de privacidade ("a chave fica só no seu navegador").
- Não há recuperação de senha no backend.
- São **duas contas diferentes**: a da extensão (`mangaba-chrome-backend.vercel.app`) e a do Router (`mangabarouter.store/signup` → console → Chaves), onde a chave é emitida.

## Jornada alvo

```
Abrir painel
  └─ sem sessão ──────────► [1] Tela de entrada: Entrar | Criar conta
                                   │ login/cadastro ok
  └─ sessão, sem chave ───► [2] Tela "Conecte sua chave do Mangaba Router"
                                   │  campo mr-...  ·  Validar  ·  "Não tem chave? Criar no Router ↗"
                                   │ chave válida
  └─ sessão + chave ──────► [3] Chat liberado (cabeçalho com e-mail e menu: Configurações, Trocar chave, Sair)
```

| Estado | O que o painel mostra | Como sai |
|---|---|---|
| Sem sessão | Tela 1; chat e campo de tarefa ocultos | Login ou cadastro |
| Sessão expirada (JWT de 30 dias, `GET /auth/me` → 401) | Tela 1 com aviso "sessão expirou"; histórico local preservado | Login |
| Sessão sem chave | Tela 2 | Chave validada |
| Chave revogada (Router → 401 na tarefa) | Volta à Tela 2 com aviso | Nova chave |
| Pronto | Chat | Sair → Tela 1 |

## Mudanças

### Extensão

1. **`sidepanel.html`**: criar `#telaEntrada` (abas Entrar/Criar conta, e-mail, senha, nome só no cadastro) e `#telaChave` (campo, botão Validar, link para o console do Router). Tirar o bloco de conta de ⚙︎; lá ficam só "Trocar chave", "Meus dados", "Limpar histórico", "Sair" e "Excluir conta".
2. **`sidepanel.js` — máquina de estados no boot**: `accountLoad()` → `GET /auth/me` para confirmar a sessão → ler a chave → mostrar a tela certa. Função única `render(estado)`; nenhum caminho deixa o chat aparecer sem sessão e chave.
3. **Bloqueio no envio**: `send()` checa sessão e chave antes de chamar `runHermes` (hoje só a chave é checada, e só dentro do Hermes).
4. **Validação da chave**: `GET https://mangabarouter.store/v1/models` com `Authorization: Bearer <chave>`; 200 = válida, 401/403 = inválida, rede = "não consegui verificar, tente de novo". *Confirmar que esse endpoint exige chave no Router (rota catch-all em `src/app/v1/[...path]`).*
5. **Chave por usuário e só local**: mover de `chrome.storage.sync` para `chrome.storage.local`, guardada sob o `user.id` (`mangaba_chave_<id>`). Dois usuários no mesmo navegador não herdam a chave um do outro. Migrar a chave existente para o primeiro usuário que logar.
6. **Sair**: apaga a sessão e esconde o chat; a chave daquele usuário fica guardada para o próximo login dele (decisão: ou apagar — ver abaixo).
7. **Erro 401 do Router durante a tarefa**: em vez de mensagem genérica "Hermes respondeu 401", levar à Tela 2.
8. **Primeira tarefa**: aviso único, antes da primeira execução, de que o conteúdo da página vai ao servidor do agente (pendência que já está no checklist da loja).

### Backend (`backend/src/app.js`)

1. `GET /auth/me` já existe — usar no boot. Sem mudança.
2. CORS: incluir `DELETE` em `Access-Control-Allow-Methods` (hoje só `GET, POST, PUT, OPTIONS`; a exclusão de conta usa `DELETE /auth/me`). Testar se o preflight acontece no painel.
3. **Recuperação de senha** (se entrar no MVP): `POST /auth/esqueci` (envia link por e-mail, token de uso único com validade de 1 h) e `POST /auth/redefinir`; tabela `reset_tokens`; e-mail transacional (o Router já tem `/redefinir`; reaproveitar o mesmo provedor).
4. Testes em `backend/test/api.test.js` para as rotas novas.

### Hermes

Sem mudança obrigatória: continua recebendo a chave em `X-Mangaba-Key`. Opcional na fase 2: exigir o JWT da extensão para recusar instalações sem conta.

### Loja, política e site

- `store/descricao.md`: "Requer conta Mangaba e uma chave do Mangaba Router".
- `store/politica-de-privacidade.md`: conta deixa de ser opcional; dados de conta passam a ser necessários para usar.
- **Revisão da Chrome Web Store**: com login obrigatório, o revisor precisa de credenciais. Criar uma conta de teste e uma chave de teste com cota baixa e informar no campo de instruções de teste. Sem isso a extensão é recusada.
- Landing (`docs/index.html`) e README: passo de instalação passa a ter "crie a conta → cole a chave".

## Testes

- Unitário (`tests/extensao.test.mjs`): `render(estado)` para os 5 estados da tabela.
- Integração no Chrome real (`npm run test:chrome`): primeiro uso → cadastro → chave inválida → chave válida → tarefa concluída; sessão expirada; sair e entrar com outro usuário no mesmo navegador; chave revogada no meio da tarefa.
- Atualização a partir da 2.16.0 com histórico e chave já salvos: histórico preservado e enviado no primeiro login; chave migrada.

## Ordem de execução

| Etapa | Entrega | Estimativa |
|---|---|---|
| 1 | Telas 1 e 2, máquina de estados, bloqueio do envio | 4–6 h |
| 2 | Validação da chave, chave por usuário em `storage.local`, migração da 2.16.0 | 2–3 h |
| 3 | Tratamento de 401 (sessão e Router), aviso da primeira tarefa | 1–2 h |
| 4 | CORS `DELETE`, testes do backend e da extensão | 2–3 h |
| 5 | Recuperação de senha (se no MVP) | 4–6 h |
| 6 | Textos da loja, política, landing, README, conta de teste do revisor; release 2.17.0 | 2 h |

## Decisões em aberto

1. **Recuperação de senha no MVP?** Com login obrigatório, quem esquece a senha fica sem usar. Recomendo incluir (etapa 5).
2. **Ao sair, apagar a chave?** Recomendo manter guardada por usuário (item 5 da extensão) e apagar só em "Excluir conta".
3. **Usuários atuais da 2.16.0** passam a ver a tela de login ao atualizar. Precisa de um aviso no e-mail ou na landing.

## Risco principal e fase 2

A jornada pede **dois cadastros**: um na extensão e outro no Router para obter a chave. É o ponto onde o funil mais perde gente. Medir: instalou → criou conta → colou chave válida → primeira tarefa.

Fase 2 recomendada: **usar a conta do Router como login da extensão**. O Router já tem `/api/signup`, sessão e `/api/keys`; após o login, a extensão pede uma chave em nome do usuário e o passo 2 desaparece. Isso elimina o backend de conta separado ou o reduz à sincronização.
