# Mangaba AI (extensão Chrome) — Benchmarketing

Versão analisada: **2.16.0** (manifest, landing em `docs/`, textos em `store/`). Data: 31/10/2026.
Fontes de mercado: buscas na web de out/2026 (sites de comparação e blogs; cifras não verificadas nas lojas).

## 1. O que o produto é hoje

- Extensão MV3 com painel lateral (side panel), chat sobre a página e **modo agente** (navegar, clicar, digitar, rolar, ler, preencher formulários, editar no Google Docs).
- Agente com planejador + equipe de especialistas; confirmação antes de ações sensíveis (compra, pagamento, envio, exclusão); bloqueio de campos de senha; pausa em login/2FA.
- Raciocínio em servidores da Mangaba no Brasil (Hermes + Mangaba Router); usuário traz a própria chave do Router.
- MCP externo (DeepWiki, Context7), memória de longo prazo, histórico em IndexedDB, modo offline via WebLLM/llama.cpp.
- Distribuição: **ainda não publicada na Chrome Web Store** (checklist em `store/checklist-publicacao.md`). Hoje: ZIP em `docs/` + "Carregar sem compactação".

## 2. Concorrentes e referências

| Produto | Tipo | Preço (fonte) | Força | Fraqueza frente à Mangaba | Ameaça |
|---|---|---|---|---|---|
| **Claude in Chrome** (Anthropic) | Extensão oficial | Incluso nos planos pagos Claude (Pro/Max/Team); sem cobrança extra | Agente com clique/digitação, gravação de fluxos, tarefas agendadas, modo "perguntar antes de agir" | Só Chrome; sem pt-BR nativo nem dados no Brasil; exige assinatura Claude | **Alta** — mesma categoria, marca forte |
| **Perplexity Comet** | Navegador próprio (Chromium) | Núcleo gratuito (fonte) | Agente executa passos sozinho entre sites; roda extensões Chrome | Não é extensão; troca de navegador é barreira | Média |
| **Gemini in Chrome** | Embutido no Chrome | Recursos básicos gratuitos; chegou ao Brasil em jun/2026 (Google for Brasil) | Já vem no navegador; em pt-BR; distribuição de Chrome | Agente de ações ainda limitado; sem controle do usuário sobre o modelo | **Alta** — distribuição gratuita |
| **ChatGPT Atlas** | Navegador (OpenAI) | — | — | Fontes divergem; uma diz que encerra em 09/08/2026 — **não confirmado**, não usar como referência | Baixa / incerta |
| **Sider, Monica** | Sidebar multimodelo | Freemium | Milhões de usuários (sites de terceiros indicam 3–5 mi; notas 4.5–4.9) | Foco em chat e escrita, pouco em agente de ações | Média (base instalada) |
| **HARPA AI** | Extensão multimodelo + automação | Freemium | Automação web + vários provedores; ~4,7 na loja (terceiros) | Interface densa; automação irregular segundo reviews | Média |
| **BrowseWiz** | Agente de navegador | Pago | Suporta pt-BR; ~2 mil usuários | Pouca tração | Baixa |
| **WebBrain** | Open source (Firefox) | Grátis | Self-hostable | Não mira o Brasil | Baixa |

Não foi possível levantar o Nanobrowser nem concorrentes brasileiros com agente de ações na Chrome Web Store (busca sem resultado útil).

## 3. Matriz de posicionamento

| Critério | Mangaba AI 2.16 | Claude in Chrome | Gemini in Chrome | Sider/Monica | HARPA |
|---|---|---|---|---|---|
| Agente que age na página | Sim | Sim | Parcial | Parcial | Sim |
| pt-BR nativo | **Sim** | Parcial | Sim | Sim | Sim |
| Infra no Brasil | **Sim** (Hermes/Router) | Não | Não | Não | Não |
| Confirmação antes de ação sensível | Sim | Sim | Parcial | Não claro | Não claro |
| Bloqueio de campo de senha | **Sim** | Não divulgado | Não divulgado | Não divulgado | Não divulgado |
| Modo offline / modelo local | **Sim** (WebLLM, llama.cpp) | Não | Não | Não | Não |
| Código próprio e auditável | Sim (sem dependências) | Não | Não | Não | Não |
| Na Chrome Web Store | **Não** | Sim | Sim (nativo) | Sim | Sim |
| Prova social / avaliações | **Zero** | Alta | Alta | Alta | Média |
| Preço para o usuário | Chave própria do Router | Plano Claude | Grátis (básico) | Freemium | Freemium |

**Diferencial real:** agente de ações em pt-BR, com dados processados no Brasil, bloqueio de senha, confirmação de ações sensíveis e opção offline. Nenhum concorrente da tabela junta os quatro.

**Ponto fraco real:** não existe ainda na loja e não tem prova social. Sem isso, a comparação de recursos não converte.

## 4. Ângulos de marketing sugeridos

1. **Soberania e LGPD:** "O agente que roda no Brasil e não guarda sua senha." Ancorar na política de privacidade já escrita.
2. **Ações com freio:** "Ele age, mas pede sua confirmação antes de comprar, enviar ou apagar." Concorre direto com o modo de confirmação do Claude, sem exigir plano caro.
3. **Para o Brasil cotidiano:** preencher cadastros, portais do governo, órgãos e formulários em pt-BR.
4. **Aberto e offline:** para quem não quer nuvem — modo WebLLM/local.
5. **Evitar:** comparação direta de "qual modelo é melhor" (perde para Claude e Gemini) e promessa de automação total (o próprio README admite que modelo pequeno trava).

## 5. Lacunas que travam o marketing (ordem de prioridade)

1. **Publicar na Chrome Web Store.** Sem a loja, não há descoberta nem confiança. Pendências do checklist: conta de desenvolvedor, URL pública da política (repo privado), e-mail de contato.
2. **Exclusão de conta:** a política promete o botão e a rota `DELETE`, mas o checklist diz que ainda não existem. A revisão pode recusar; e a promessa na loja não pode estar à frente do produto.
3. **Permissões amplas:** `debugger` e `http(s)://*/*` geram revisão lenta e desconfiança. A justificativa existe (`store/justificativas-permissoes.md`); o marketing deve apresentá-la como "só age quando você pede".
4. **Texto da landing ("Chrome e Edge"):** não testado no Edge. Ou testar e manter, ou tirar.
5. **README desatualizado:** ainda descreve o gateway local em `localhost:8080`, não o Mangaba Router. Corrigir antes de qualquer link público.
6. **LEGAL.md** diz "sem coleta de dados sem consentimento" e não cita conta nem sincronização (já apontado no checklist). Alinhar à política.
7. **Prova social:** conseguir 10–20 testers com depoimento e print real (capturas de `docs/captura-painel.png` já existem) antes do lançamento.
8. **Métrica:** definir antes do lançamento — instalações, tarefas concluídas por usuário, taxa de confirmação aceita.

## 6. Próximos passos sugeridos

- Semana 1: fechar pendências 1, 2 e 5; gerar o ZIP de produção.
- Semana 2: submissão à loja; 10 testers em sites reais brasileiros (cadastro, órgão público, Google Docs).
- Semana 3: landing com um caso real por ângulo (ver §4) e o comparativo honesto da §3 (sem tabela com "vence em tudo").

## Limites deste levantamento

- Preços e contagens vêm de sites de terceiros e de uma busca; não conferidos nas lojas.
- Não foram medidas a qualidade do agente nem a velocidade contra os concorrentes (benchmark de desempenho ficou fora; só marketing/posicionamento).
- A extensão de VS Code (`Projetos/mangaba-vscode`, v0.12.0) não entrou na análise; se o pedido era ela, dá para refazer.
