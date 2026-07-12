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
// Os elementos ficam em window.__mgbEls (referências vivas): funciona com
// Shadow DOM e iframes same-origin, onde seletores por atributo falhariam.
const snapshotFn = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const SEL = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
  const els = [];
  let varridos = 0;
  const walk = (root) => {
    if (!root || els.length >= 90 || varridos > 4000) return;
    for (const el of root.querySelectorAll(SEL)) {
      if (els.length >= 90) break;
      if (vis(el)) els.push(el);
    }
    for (const el of root.querySelectorAll("*")) {
      if (els.length >= 90 || ++varridos > 4000) break;
      if (el.shadowRoot) walk(el.shadowRoot);
      else if (el.tagName === "IFRAME") { try { walk(el.contentDocument); } catch { /* cross-origin */ } }
    }
  };
  walk(document);
  window.__mgbEls = els;
  const alt = Math.max(1, document.documentElement.scrollHeight);
  return {
    url: location.href,
    title: document.title,
    rolagem: Math.min(100, Math.round(((scrollY + innerHeight) / alt) * 100)),
    elements: els.map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      tipo: el.type || el.getAttribute("role") || "",
      texto: (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "")
        .trim().replace(/\s+/g, " ").slice(0, 70),
      href: el.tagName === "A" && el.href ? String(el.href).slice(0, 70) : undefined,
      valor: el.value && el.type !== "password" ? String(el.value).slice(0, 40) : undefined
    })),
    trecho: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200)
  };
};
const flashFn = (el) => {
  const o = el.style.outline;
  el.style.outline = "3px solid #F0781E";
  setTimeout(() => (el.style.outline = o), 700);
};
const clickFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado (a página mudou? refaça o snapshot agindo de novo)";
  el.scrollIntoView({ block: "center" });
  const o = el.style.outline;
  el.style.outline = "3px solid #F0781E";
  setTimeout(() => (el.style.outline = o), 700);
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const [Ctor, type] of [[PointerEvent, "pointerdown"], [MouseEvent, "mousedown"], [PointerEvent, "pointerup"], [MouseEvent, "mouseup"]])
    el.dispatchEvent(new Ctor(type, opts));
  el.click();
  return "cliquei em [" + i + "]";
};
const typeFn = (i, texto) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado";
  if (el.type === "password") return "recusado: campo de senha — peça que o usuário digite manualmente";
  const o = el.style.outline;
  el.style.outline = "3px solid #F0781E";
  setTimeout(() => (el.style.outline = o), 700);
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
  const el = (window.__mgbEls || [])[i] || document.activeElement;
  for (const type of ["keydown", "keypress", "keyup"])
    el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
  if (key === "Enter") el.closest("form")?.requestSubmit?.();
  return "pressionei " + key;
};
const scrollFn = (dir) => {
  window.scrollBy({ top: dir === "cima" ? -600 : 600, behavior: "instant" });
  return "rolei para " + dir;
};
const readFn = (offset) => {
  const t = document.body?.innerText || "";
  const o = Math.max(0, offset | 0);
  const parte = t.slice(o, o + 6000);
  return parte + (t.length > o + 6000
    ? `\n[...a página tem ${t.length} caracteres; para continuar use "ler" com offset=${o + 6000}]`
    : "");
};

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
      if (msg.type === "GET_PAGE_CONTEXT") {
        const tab = await getTab();
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
      if (tool === "esperar") {
        const s = Math.min(10, Math.max(1, +args.segundos || 1));
        await sleep(s * 1000);
        out = `esperei ${s}s`;
      } else if (tool === "nova_aba") {
        const nt = await chrome.tabs.create({ url: args.url, active: true });
        await sleep(500); await waitLoad(nt.id);
        out = "abri nova aba em " + args.url;
      } else if (tool === "listar_abas") {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        out = tabs.map((t) => `[${t.id}]${t.active ? "*" : ""} ${(t.title || "").slice(0, 50)} — ${(t.url || "").slice(0, 60)}`).join("\n");
      } else if (tool === "trocar_aba") {
        await chrome.tabs.update(+args.id, { active: true });
        await sleep(400);
        out = "fui para a aba [" + args.id + "]";
      } else if (tool === "olhar") {
        const tab = await getTab();
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
        out = { dataUrl };
      } else {
        const tab = await getTab();
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
        } else if (tool === "voltar") {
          try { await chrome.tabs.goBack(tab.id); } catch { out = "não há página anterior"; }
          await sleep(500); await waitLoad(tab.id, 6000);
          out = out || "voltei para a página anterior";
        } else if (tool === "rolar") out = await exec(tab.id, scrollFn, [args.dir || "baixo"]);
        else if (tool === "ler") out = await exec(tab.id, readFn, [args.offset | 0]);
        else out = "ferramenta desconhecida: " + tool;
      }
      sendResponse({ ok: true, out });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // resposta assíncrona
});
