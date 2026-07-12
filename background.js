chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || ""))
    throw new Error("Página não acessível");
  return tab;
}

function exec(tabId, func, args = []) {
  return chrome.scripting
    .executeScript({ target: { tabId }, func, args })
    .then((r) => r[0].result);
}

// ---- funções injetadas na página ----
const snapshotFn = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const els = [...document.querySelectorAll(
    'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]'
  )].filter(vis).slice(0, 80);
  els.forEach((el, i) => el.setAttribute("data-mgb", i));
  return {
    url: location.href,
    title: document.title,
    elements: els.map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      tipo: el.type || el.getAttribute("role") || "",
      texto: (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "")
        .trim().replace(/\s+/g, " ").slice(0, 70)
    })),
    trecho: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200)
  };
};
const clickFn = (i) => {
  const el = document.querySelector(`[data-mgb="${i}"]`);
  if (!el) return "elemento [" + i + "] não encontrado";
  el.scrollIntoView({ block: "center" });
  el.click();
  return "cliquei em [" + i + "]";
};
const typeFn = (i, texto) => {
  const el = document.querySelector(`[data-mgb="${i}"]`);
  if (!el) return "elemento [" + i + "] não encontrado";
  el.focus();
  if (el.isContentEditable) el.textContent = texto;
  else {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    set ? set.call(el, texto) : (el.value = texto);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "digitei em [" + i + "]";
};
const keyFn = (i, key) => {
  const el = document.querySelector(`[data-mgb="${i}"]`) || document.activeElement;
  for (const type of ["keydown", "keypress", "keyup"])
    el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
  if (key === "Enter") el.closest("form")?.requestSubmit?.();
  return "pressionei " + key;
};
const scrollFn = (dir) => {
  window.scrollBy({ top: dir === "cima" ? -600 : 600, behavior: "instant" });
  return "rolei para " + dir;
};
const readFn = () => (document.body?.innerText || "").slice(0, 6000);

async function waitLoad(tabId, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await chrome.tabs.get(tabId)).status === "complete") return;
    } catch { return; }
    await sleep(300);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "GET_PAGE_CONTEXT" && msg.type !== "AGENT_TOOL") return;
  (async () => {
    try {
      const tab = await getTab();
      if (msg.type === "GET_PAGE_CONTEXT") {
        const page = await exec(tab.id, () => ({
          title: document.title,
          url: location.href,
          text: (document.body?.innerText || "").slice(0, 12000)
        }));
        sendResponse({ ok: true, page });
        return;
      }
      const { tool, args = {} } = msg;
      let out;
      if (tool === "snapshot") out = await exec(tab.id, snapshotFn);
      else if (tool === "clicar") {
        out = await exec(tab.id, clickFn, [args.i]);
        await sleep(800); await waitLoad(tab.id, 6000);
      } else if (tool === "digitar") out = await exec(tab.id, typeFn, [args.i, String(args.texto ?? "")]);
      else if (tool === "tecla") {
        out = await exec(tab.id, keyFn, [args.i, args.tecla || "Enter"]);
        await sleep(800); await waitLoad(tab.id, 6000);
      } else if (tool === "navegar") {
        await chrome.tabs.update(tab.id, { url: args.url });
        await sleep(500); await waitLoad(tab.id);
        out = "naveguei para " + args.url;
      } else if (tool === "rolar") out = await exec(tab.id, scrollFn, [args.dir || "baixo"]);
      else if (tool === "ler") out = await exec(tab.id, readFn);
      else out = "ferramenta desconhecida: " + tool;
      sendResponse({ ok: true, out });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // resposta assíncrona
});
