const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");
const btnSend = $("btnSend");
const history = []; // {role, content}

const DEFAULTS = {
  url: "http://localhost:8080/v1/chat/completions",
  model: "",
  key: ""
};
let cfg = { ...DEFAULTS };

chrome.storage.sync.get(DEFAULTS, (saved) => {
  cfg = saved;
  $("cfgUrl").value = cfg.url;
  $("cfgModel").value = cfg.model;
  $("cfgKey").value = cfg.key;
});

$("btnSettings").onclick = () => $("settings").classList.toggle("hidden");
$("btnSave").onclick = () => {
  cfg = {
    url: $("cfgUrl").value.trim() || DEFAULTS.url,
    model: $("cfgModel").value.trim(),
    key: $("cfgKey").value.trim()
  };
  chrome.storage.sync.set(cfg);
  $("settings").classList.add("hidden");
};

function addMsg(cls, text) {
  const div = document.createElement("div");
  div.className = "msg " + cls;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

async function getPageContext() {
  const res = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" });
  if (!res?.ok) return null;
  const { title, url, text } = res.page;
  return `Contexto da página aberta:\nTítulo: ${title}\nURL: ${url}\nConteúdo:\n${text}`;
}

async function send() {
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  btnSend.disabled = true;
  addMsg("user", question);

  const messages = [{
    role: "system",
    content: "Você é a Mangaba, assistente de IA brasileira. Responda em português do Brasil, de forma clara e objetiva."
  }];
  if ($("usePage").checked) {
    const ctx = await getPageContext();
    if (ctx) messages.push({ role: "system", content: ctx });
  }
  messages.push(...history, { role: "user", content: question });

  const bubble = addMsg("assistant", "…");
  try {
    const headers = { "Content-Type": "application/json" };
    if (cfg.key) headers.Authorization = "Bearer " + cfg.key;
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.model || undefined, messages, stream: true })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

    let answer = "";
    if (resp.headers.get("content-type")?.includes("event-stream")) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "").trim();
          if (!data || data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) { answer += delta; bubble.textContent = answer; chat.scrollTop = chat.scrollHeight; }
          } catch { /* linha parcial */ }
        }
      }
    } else {
      const json = await resp.json();
      answer = json.choices?.[0]?.message?.content || JSON.stringify(json).slice(0, 500);
      bubble.textContent = answer;
    }
    history.push({ role: "user", content: question }, { role: "assistant", content: answer });
  } catch (e) {
    bubble.remove();
    addMsg("err", "Erro ao falar com o gateway: " + e.message);
  } finally {
    btnSend.disabled = false;
    input.focus();
  }
}

btnSend.onclick = send;
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
