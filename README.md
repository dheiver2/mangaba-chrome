# Mangaba AI — Chrome Extension 🥭

📄 **Page / download:** https://dheiver2.github.io/mangaba-chrome/ (via GitHub Pages, `docs/` folder)

Autonomous browser agent in Chrome's side panel, connected to the **Mangaba Gateway** (local GGUF models) or fully offline via **WebLLM** (WebGPU, in-browser). 100% original code, Manifest V3, zero dependencies.

## Features
- **🤖 Agent mode only**: every message is a task for the agent — a team of specialists (Orchestrator + Navigator, Researcher, Reader, Filler, Social, and more) performs it in the browser: opens URLs, clicks, types, scrolls, reads pages, and decides step by step via LLM
- **Offline mode**: runs entirely in the browser via WebLLM (WebGPU), with native tool-calling, no gateway or external server required
- **🔌 External MCP tools**: the agent connects to **MCP** (Model Context Protocol) servers over HTTP, discovers their tools, and uses them alongside browser actions. Ships with 2 public read-only servers pre-configured (DeepWiki and Context7); edit/remove under ⚙︎ → *MCP Servers*
- **Long-term memory**: the agent can remember facts across tasks (e.g., an exact group name) via ⚙︎ settings
- Response **streaming** (SSE, OpenAI-style API compatible)
- Configurable: gateway URL, model, API key, temperature, max tokens, and max steps (⚙︎ at the top)

## Agent mode
Just type a task and send. Flow: a planner generates a short plan → the Orchestrator (or the agent picked from the dropdown) executes it in JSON steps with a live status and a collapsible step list. Tools: navigate, new_tab, back, click, type, key, scroll, read (with offset), wait, ask (the user), and done. Safety: password fields are blocked; sensitive clicks/fills (buy, pay, delete, card, SSN...) require your confirmation; the ■ button stops the task at any time.

## Installation
1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder

## Configuration
Default: `http://localhost:8080/v1/chat/completions` (local Mangaba Gateway).
To use it over cloudflared, change the URL in settings (⚙︎).

## Files
| File | Role |
|---|---|
| `manifest.json` | MV3: side panel, scripting, storage |
| `background.js` | Service worker: extracts the active tab's text and runs the agent's tools |
| `mcp.js` | MCP client over HTTP (JSON-RPC 2.0): connects, lists, and calls external tools |
| `sidepanel.html/css/js` | Agent UI, settings, and streaming |
| `offline.js` | Offline mode: WebLLM engine + native tool-calling agent loop |
| `icons/` | Official mangaba.ai fruit mark (`mark.png`) + 16/48/128 PNG icons |
