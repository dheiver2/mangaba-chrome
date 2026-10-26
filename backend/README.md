# Mangaba Chrome — backend de conta e sincronização

API em Node + Postgres que dá login (e-mail e senha) à extensão e guarda, por usuário,
as configurações, o histórico de chat, o histórico de agente e a memória.

## Rodando localmente

```bash
docker run -d --name mangaba-chrome-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mangaba_chrome -p 54330:5432 postgres:17
npm install
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/mangaba_chrome
export JWT_SECRET="troque-por-um-segredo-com-mais-de-32-caracteres"
npm start            # sobe em http://localhost:8791 e cria as tabelas
npm test             # testes de integração contra o Postgres
```

## Variáveis

- `DATABASE_URL` — conexão Postgres (obrigatória).
- `JWT_SECRET` — segredo dos tokens, com pelo menos 32 caracteres (obrigatória).
- `PORT` — porta HTTP (padrão 8791).

## Endpoints

- `POST /auth/signup` — `{name, email, password}` → `201 {token, user}`
- `POST /auth/login` — `{email, password}` → `{token, user}`
- `GET /auth/me` — `Authorization: Bearer <token>` → `{user}`
- `GET /sync/:kind` — `kind` = `settings` | `chat` | `agent` | `memory` → `{payload, updated_at}`
- `PUT /sync/:kind` — `{payload}` → `{updated_at}` (máximo 1,5 MB por tipo)
- `GET /health`

## Segurança

- Senhas com bcrypt (custo 12); login falho responde a mesma mensagem para e-mail inexistente e senha errada.
- Tokens JWT de 30 dias.
- No máximo 20 tentativas de login/cadastro por IP a cada 15 minutos.
- Cada usuário lê e grava só os próprios dados.
- A API key do modelo nunca sobe para o servidor: a extensão a retira antes de sincronizar.
- CORS só para `chrome-extension://` e localhost.

## Ainda não feito

- Deploy em produção (ainda não há URL pública; a extensão aponta para `http://localhost:8791` por padrão).
- Recuperação de senha e verificação de e-mail.
