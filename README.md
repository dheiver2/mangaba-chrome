# Mangaba AI — Extensão Chrome 🥭

Assistente de IA no painel lateral do Chrome, conectado ao **Mangaba Gateway** (modelos GGUF locais). Código 100% original, Manifest V3, zero dependências.

## Funcionalidades
- Chat no **side panel** (clique no ícone da extensão)
- **Contexto da página**: lê título, URL e texto da aba ativa e responde sobre ela
- **Streaming** de resposta (SSE, compatível com API estilo OpenAI)
- Configurável: URL do gateway, modelo e API key (⚙︎ no topo)

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
| `icons/` | Ícones gerados por script (laranja #E94A12) |
