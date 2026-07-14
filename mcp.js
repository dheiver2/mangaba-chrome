// ---------- Cliente MCP (Model Context Protocol) sobre HTTP ----------
// Conecta a servidores MCP expostos por HTTP(S) usando o transporte "Streamable HTTP"
// (JSON-RPC 2.0). stdio não existe numa extensão; o transporte HTTP sim.
// Fica exposto no escopo global (window) e é usado pelo modo agente em sidepanel.js.

const mcpServers = new Map(); // nome -> {url, auth, sessionId, protocol, tools, erro}
let mcpId = 0;

// config vinda do textarea: uma linha por servidor — "nome | https://url | Authorization (opcional)"
// linhas em branco e começadas por # são ignoradas
function parseMcpConfig(txt) {
  const servers = [];
  (txt || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((l) => {
    const parts = l.split("|").map((p) => p.trim());
    let nome, url, auth = "";
    if (parts.length >= 2) { nome = parts[0]; url = parts[1]; auth = parts[2] || ""; }
    else { url = parts[0]; nome = (url.match(/\/\/([^/]+)/)?.[1] || url).replace(/^www\./, ""); }
    if (/^https?:\/\//.test(url)) servers.push({ nome, url, auth });
  });
  return servers;
}

// uma requisição JSON-RPC ao servidor; aceita resposta application/json OU text/event-stream
async function mcpRpc(server, method, params, notify) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
  if (server.auth) headers.Authorization = /\s/.test(server.auth) ? server.auth : "Bearer " + server.auth;
  if (server.sessionId) headers["Mcp-Session-Id"] = server.sessionId;
  if (server.protocol) headers["MCP-Protocol-Version"] = server.protocol;
  const body = { jsonrpc: "2.0", method, ...(notify ? {} : { id: ++mcpId }), ...(params ? { params } : {}) };
  const resp = await fetch(server.url, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = resp.headers.get("Mcp-Session-Id");
  if (sid) server.sessionId = sid;
  if (notify) return null; // notificações não têm corpo de resposta útil
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  let msg;
  if ((resp.headers.get("content-type") || "").includes("text/event-stream")) {
    const txt = await resp.text();
    for (const line of txt.split("\n")) {           // pega o último evento com result/error
      const d = line.replace(/^data:\s*/, "").trim();
      if (!d || d === "[DONE]") continue;
      try { const j = JSON.parse(d); if (j.jsonrpc && (j.result !== undefined || j.error)) msg = j; } catch { /* linha parcial */ }
    }
  } else {
    msg = await resp.json();
  }
  if (!msg) throw new Error("resposta MCP vazia");
  if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error).slice(0, 160));
  return msg.result;
}

// handshake completo + descoberta das ferramentas de um servidor
async function mcpConnect(server) {
  server.protocol = "2025-06-18";
  const init = await mcpRpc(server, "initialize", {
    protocolVersion: server.protocol,
    capabilities: {},
    clientInfo: { name: "Mangaba AI", version: "1.16" }
  });
  server.protocol = init?.protocolVersion || server.protocol;
  await mcpRpc(server, "notifications/initialized", null, true).catch(() => {});
  const list = await mcpRpc(server, "tools/list", {});
  server.tools = (list?.tools || []).slice(0, 30);
  return server.tools;
}

// conecta a TODOS os servidores configurados (em paralelo) e devolve o catálogo
async function mcpDiscover(cfgTxt) {
  mcpServers.clear();
  const catalogo = [];
  await Promise.all(parseMcpConfig(cfgTxt).map(async (s) => {
    try { await mcpConnect(s); s.erro = null; }
    catch (e) { s.erro = String(e.message || e); s.tools = []; }
    mcpServers.set(s.nome, s);
    catalogo.push({ nome: s.nome, tools: s.tools || [], erro: s.erro });
  }));
  return catalogo;
}

// catálogo em texto para injetar no prompt do agente (só quando há MCP conectado)
function mcpCatalogText(catalogo) {
  const ativos = catalogo.filter((c) => !c.erro && c.tools.length);
  if (!ativos.length) return "";
  const linhas = ativos.map((c) => {
    const ts = c.tools.map((t) => {
      const props = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties).join(", ") : "";
      const req = Array.isArray(t.inputSchema?.required) && t.inputSchema.required.length ? ` [obrigatórios: ${t.inputSchema.required.join(", ")}]` : "";
      return `   - ${t.name}(${props})${req}${t.description ? " — " + String(t.description).replace(/\s+/g, " ").slice(0, 90) : ""}`;
    }).join("\n");
    return `• servidor "${c.nome}":\n${ts}`;
  }).join("\n");
  return `\nFERRAMENTAS MCP EXTERNAS conectadas — chame com {"tool":"mcp","args":{"servidor":"nome","ferramenta":"nome_da_ferramenta","argumentos":{...}}}:\n${linhas}\n`;
}

// executa uma ferramenta MCP e normaliza o resultado para texto
async function mcpCall(servidor, ferramenta, argumentos) {
  const s = mcpServers.get(servidor) || [...mcpServers.values()].find((x) => (x.tools || []).some((t) => t.name === ferramenta));
  if (!s) return { ok: false, error: `servidor MCP "${servidor}" não está conectado (confira as Configurações)` };
  if (s.erro) return { ok: false, error: `servidor "${servidor}" offline: ${s.erro}` };
  try {
    const r = await mcpRpc(s, "tools/call", { name: ferramenta, arguments: argumentos || {} });
    let texto;
    if (Array.isArray(r?.content)) {
      texto = r.content.map((c) =>
        c.type === "text" ? c.text
          : c.type === "resource" ? JSON.stringify(c.resource).slice(0, 800)
          : `[${c.type}]`).join("\n");
    } else {
      texto = typeof r === "string" ? r : JSON.stringify(r);
    }
    if (r?.isError) return { ok: false, error: String(texto).slice(0, 500) };
    return { ok: true, out: String(texto).slice(0, 4000) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
