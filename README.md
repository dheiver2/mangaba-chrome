# Mangaba AI — Extensão Chrome 🥭

Assistente de IA no painel lateral do Chrome, conectado ao **Mangaba Gateway** (modelos GGUF locais). Código 100% original, Manifest V3, zero dependências.

## Funcionalidades
- Chat no **side panel** (clique no ícone da extensão)
- **Contexto da página**: lê título, URL e texto da aba ativa e responde sobre ela
- **🤖 Modo agente**: equipe de agentes (Orquestrador + Navegador, Pesquisador, Leitor, Preenchedor) que executa tarefas no navegador — abre URLs, clica, digita, rola e lê páginas, decidindo passo a passo via LLM
- **Streaming** de resposta (SSE, compatível com API estilo OpenAI)
- Configurável: URL do gateway, modelo e API key (⚙︎ no topo)

## Modo agente
Marque **🤖 Modo agente** e peça, por exemplo: *"pesquise o preço da mangaba no Google"* ou *"abra g1.com e resuma a manchete"*. O Orquestrador escolhe o agente; ele age em até 15 passos (JSON por passo) e mostra cada ação no chat. Por segurança, os agentes nunca digitam senhas/cartões nem confirmam compras — devolvem a tarefa ao usuário nesses casos.

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
| `background.js` | Service worker: extrai texto da aba ativa |
| `sidepanel.html/css/js` | UI do chat, config e streaming |
| `icons/` | Logo oficial Mangaba (`logo.svg`) + ícones PNG derivados do símbolo |
