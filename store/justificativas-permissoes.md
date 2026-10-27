# Justificativas de permissão (campo "Justify your use of permissions")

Use estes textos na revisão da Chrome Web Store. Cada permissão do manifest tem um motivo concreto no código.

| Permissão | Justificativa |
|---|---|
| `sidePanel` | Abre o painel lateral onde o usuário escreve as tarefas e acompanha o agente. |
| `activeTab` | Dá acesso à aba que o usuário está vendo no momento em que ele pede uma tarefa. |
| `scripting` | Executa as ações da tarefa na página atual: ler o texto, localizar botões e campos, clicar, digitar e preencher formulários. Só roda quando o usuário pede uma tarefa. |
| `storage` | Guarda as configurações, a chave do Mangaba Router e os dados da conta no próprio navegador. |
| `tabs` | Lista as abas da janela e troca de aba quando a tarefa exige. Não lê histórico de navegação. |
| `windows` | Identifica a janela onde o painel está aberto, para agir na aba certa. |
| `host_permissions: http://*/*, https://*/*` | O agente precisa funcionar em qualquer site que o usuário escolher para uma tarefa. Não há acesso em segundo plano: nada é lido ou alterado sem um pedido do usuário. |

**Pergunta provável do revisor:** "Por que todos os sites?"
Resposta sugerida: as tarefas são definidas pelo usuário e podem envolver qualquer site. A extensão só age na aba ativa e apenas após um pedido explícito no painel. Não há coleta de navegação nem execução em páginas fora da tarefa pedida.

**debugger:** usado só para entregar à página o clique, a digitação e as teclas que o usuário pediu, como eventos de entrada reais (protocolo do DevTools: Input.dispatchMouseEvent, Input.insertText, Input.dispatchKeyEvent). Muitos sites e editores, como o Google Docs e aplicativos de chat, ignoram eventos simulados por script. A extensão se anexa apenas à aba da tarefa, apenas durante as ações pedidas, e se desconecta sozinha após 20 segundos sem ações. Não lê tráfego de rede, não altera páginas e não fica anexada em segundo plano. Enquanto anexada, o Chrome mostra o aviso padrão de depuração.

## Campos da aba "Privacy practices"

**Single purpose (finalidade única):**
Assistente de navegador que executa, na aba que o usuário está vendo, as tarefas que ele descreve no painel lateral (ler, preencher formulários, navegar e clicar).

**Remote code (código remoto):**
Não usamos código remoto. Todo o JavaScript da extensão está no pacote enviado. Não há `eval`, `new Function` nem scripts carregados de servidores. A extensão só troca dados (texto, JSON) com o servidor do agente e com o Mangaba Router.

**activeTab:** o agente age apenas na aba ativa, e só quando o usuário pede uma tarefa no painel.

**host permissions (http://*/*, https://*/*):** a tarefa pode envolver qualquer site escolhido pelo usuário. Não há leitura nem ação em segundo plano.

**scripting:** executa as ações da tarefa na página (ler texto, localizar botões e campos, clicar, digitar, preencher). Só roda após um pedido do usuário.

**sidePanel:** exibe o painel onde o usuário escreve as tarefas e acompanha o andamento.

**storage:** guarda configurações, a chave do Mangaba Router e os dados da conta no navegador.

**tabs:** lista as abas da janela e troca de aba quando a tarefa exige. Não lê histórico de navegação.

**windows:** identifica a janela onde o painel está aberto, para agir na aba correta.

**debugger (campo da aba Privacy):** entrega o clique, a digitação e as teclas pedidas pelo usuário como eventos reais, que sites e editores aceitam (Google Docs, chats, formulários com validação). Anexa só à aba da tarefa, só durante as ações, e se desconecta após 20 segundos sem uso. Não lê rede nem conteúdo fora da tarefa.
