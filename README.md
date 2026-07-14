# Mangaba AI — Extensão Chrome 🥭

📄 **Página / download:** https://dheiver2.github.io/mangaba-chrome/ (via GitHub Pages, pasta `docs/`)

Assistente de IA no painel lateral do Chrome, conectado ao **Mangaba Gateway** (modelos GGUF locais). Código 100% original, Manifest V3, zero dependências.

## Funcionalidades
- Chat no **side panel** (clique no ícone da extensão)
- **Contexto da página**: lê título, URL e texto da aba ativa e responde sobre ela
- **🤖 Modo agente**: equipe de agentes (Orquestrador + Navegador, Pesquisador, Leitor, Preenchedor) que executa tarefas no navegador — abre URLs, clica, digita, rola e lê páginas, decidindo passo a passo via LLM
- **🔌 Ferramentas MCP externas**: o agente conecta a servidores **MCP** (Model Context Protocol) por HTTP, descobre as ferramentas e as usa junto das ações do navegador. Vem com 2 servidores públicos somente-leitura pré-configurados (DeepWiki e Context7); edite/remova em ⚙︎ → *Servidores MCP*
- **Streaming** de resposta (SSE, compatível com API estilo OpenAI)
- Configurável: URL do gateway, modelo e API key (⚙︎ no topo)

## Modo agente
Marque **🤖 Modo agente** e peça a tarefa. O fluxo: planejador gera um plano curto → Orquestrador (ou o agente escolhido no dropdown) executa em passos JSON com status ao vivo e lista de passos colapsável. Ferramentas: navegar, nova_aba, voltar, clicar, digitar, tecla, rolar, ler (com offset), esperar, perguntar (ao usuário) e concluir. Segurança: campos de senha são bloqueados; cliques/preenchimentos sensíveis (comprar, pagar, excluir, cartão, CPF...) pedem confirmação sua; botão ■ para a tarefa a qualquer momento.

## Instalação
1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **Carregar sem compactação** e selecione esta pasta

## Configuração
Padrão: `http://localhost:8080/v1/chat/completions` (Mangaba Gateway local).
Para usar via cloudflared, troque a URL nas configurações (⚙︎).

## Arquivos
| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3: side panel, scripting, storage |
| `background.js` | Service worker: extrai texto da aba ativa e executa as ferramentas do agente |
| `mcp.js` | Cliente MCP sobre HTTP (JSON-RPC 2.0): conecta, lista e chama ferramentas externas |
| `sidepanel.html/css/js` | UI do chat, config e streaming |
| `icons/` | Fruta oficial mangaba.ai (`mark.png`) + ícones PNG 16/48/128 |
