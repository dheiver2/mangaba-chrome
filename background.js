chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- CACHE DE SNAPSHOTS (60s TTL, multi-tab com session) ----
const SNAPSHOT_CACHE = {};
const SNAPSHOT_TTL = 60000; // 60s (configurável)

// Obter session hash da página (localStorage ou meta tag)
const getSessionHash = async (tabId) => {
  try {
    return await exec(tabId, () => {
      const stored = localStorage.getItem("__auth_token") || localStorage.getItem("session") || "";
      const meta = document.querySelector('meta[name="csrf-token"]')?.content || "";
      const hash = (stored + meta).substring(0, 20);
      return hash || "nosession";
    }).catch(() => "nosession");
  } catch { return "nosession"; }
};

const cacheSnapshot = (tabId, url, sessionId, data) => {
  const key = `${tabId}:${url}:${sessionId}`;
  SNAPSHOT_CACHE[key] = { data, ts: Date.now() };
};

const getCachedSnapshot = async (tabId, url) => {
  const sessionId = await getSessionHash(tabId);
  const key = `${tabId}:${url}:${sessionId}`;
  const cached = SNAPSHOT_CACHE[key];
  if (cached && Date.now() - cached.ts < SNAPSHOT_TTL) return cached.data;
  delete SNAPSHOT_CACHE[key];
  return null;
};

const invalidateSnapshot = async (tabId, url) => {
  const sessionId = await getSessionHash(tabId);
  delete SNAPSHOT_CACHE[`${tabId}:${url}:${sessionId}`];
};

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
  const cands = [];
  let varridos = 0;
  // Limites expandidos para sites densos (planilhas, tabelas, formulários grandes)
  const MAX_CANDIDATES = 180;  // 160 → 180
  const MAX_TRAVERSALS = 5000;

  const walk = (root) => {
    if (!root || cands.length >= MAX_CANDIDATES || varridos > MAX_TRAVERSALS) return;
    for (const el of root.querySelectorAll(SEL)) {
      if (cands.length >= MAX_CANDIDATES) break;
      if (vis(el)) cands.push(el);
    }
    for (const el of root.querySelectorAll("*")) {
      if (cands.length >= MAX_CANDIDATES || ++varridos > MAX_TRAVERSALS) break;
      if (el.shadowRoot) walk(el.shadowRoot);
      else if (el.tagName === "IFRAME") { try { walk(el.contentDocument); } catch { /* cross-origin */ } }
    }
  };
  walk(document);
  // PRIORIZA o que está na viewport: após rolar até os comentários, o campo entra na lista dos 80 visíveis
  const VIEWPORT_LIMIT = 80;   // 45 → 80 elementos na viewport
  const OFFSCREEN_LIMIT = 80;  // +80 elementos fora da viewport
  const emTela = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const els = [];
  for (const el of cands) if (els.length < VIEWPORT_LIMIT && emTela(el)) els.push(el);
  for (const el of cands) if (els.length < VIEWPORT_LIMIT + OFFSCREEN_LIMIT && !emTela(el)) els.push(el);
  window.__mgbEls = els;
  const alt = Math.max(1, document.documentElement.scrollHeight);
  return {
    url: location.href,
    title: document.title,
    rolagem: Math.min(100, Math.round(((scrollY + innerHeight) / alt) * 100)),
    elements: els.map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i,
        tag: el.tagName.toLowerCase(),
        tipo: el.type || el.getAttribute("role") || "",
        texto: (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "")
          .trim().replace(/\s+/g, " ").slice(0, 70),
        href: el.tagName === "A" && el.href ? String(el.href).slice(0, 70) : undefined,
        valor: el.value && el.type !== "password" ? String(el.value).slice(0, 40) : undefined,
        naTela: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      };
    }),
    trecho: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1000)  // 700 → 1000 chars
  };
};
// Mapa detalhado do formulário. Usa o MESMO percurso do snapshot para que os
// índices [i] sejam consistentes entre snapshot/formulario/clicar/preencher.
const formFn = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const SEL = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
  const cands = [];
  let varridos = 0;
  const walk = (root) => {
    if (!root || cands.length >= 160 || varridos > 5000) return;
    for (const el of root.querySelectorAll(SEL)) {
      if (cands.length >= 160) break;
      if (vis(el)) cands.push(el);
    }
    for (const el of root.querySelectorAll("*")) {
      if (cands.length >= 160 || ++varridos > 5000) break;
      if (el.shadowRoot) walk(el.shadowRoot);
      else if (el.tagName === "IFRAME") { try { walk(el.contentDocument); } catch { /* cross-origin */ } }
    }
  };
  walk(document);
  const emTela = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const els = [];
  for (const el of cands) if (els.length < 45 && emTela(el)) els.push(el);
  for (const el of cands) if (els.length < 45 && !emTela(el)) els.push(el);
  window.__mgbEls = els;
  const rotulo = (el) => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.innerText; }
    const p = el.closest("label");
    if (p) return p.innerText;
    return el.getAttribute("aria-label") || el.placeholder || el.name || "";
  };
  const linhas = [];
  els.forEach((el, i) => {
    const t = el.tagName.toLowerCase();
    const ehCampo = t === "input" || t === "select" || t === "textarea" || el.isContentEditable;
    const ehEnvio = (t === "button" && (el.type === "submit" || !el.type)) || (t === "input" && el.type === "submit");
    if (!ehCampo && !ehEnvio) return;
    const nome = (rotulo(el) || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const base = `[${i}] ${t}${el.type ? ":" + el.type : ""} "${nome}"`;
    if (ehEnvio) { linhas.push(`${base} (botão de envio)`); return; }
    if (t === "select") {
      const ops = [...el.options].map((o) => o.text.trim().slice(0, 30)).slice(0, 12).join(" | ");
      linhas.push(`${base} opções: ${ops} (selecionado: "${el.options[el.selectedIndex]?.text?.trim() || ""}")`);
    } else if (el.type === "checkbox" || el.type === "radio") {
      linhas.push(`${base} ${el.checked ? "[x]" : "[ ]"} valor:${String(el.value).slice(0, 20)}`);
    } else if (el.type === "password") {
      linhas.push(`${base} (SENHA — não preencher; o usuário digita)`);
    } else {
      linhas.push(`${base} valor atual: "${String(el.value || "").slice(0, 40)}"${el.required ? " *obrigatório" : ""}`);
    }
  });
  return linhas.length ? linhas.join("\n") : "(nenhum campo de formulário visível nesta página)";
};
const preencherFn = (campos) => {
  const res = [];
  for (const c of campos || []) {
    const el = (window.__mgbEls || [])[c.i];
    if (!el) { res.push(`[${c.i}] não encontrado`); continue; }
    if (el.type === "password") { res.push(`[${c.i}] recusado: campo de senha`); continue; }
    const o = el.style.outline;
    el.style.outline = "3px solid #F0781E";
    setTimeout(() => (el.style.outline = o), 900);
    el.focus();
    if (el.isContentEditable) el.textContent = String(c.texto ?? "");
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      set ? set.call(el, String(c.texto ?? "")) : (el.value = String(c.texto ?? ""));
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const valido = el.checkValidity ? el.checkValidity() : true;
    res.push(`[${c.i}] preenchido${valido ? "" : " (o site marcou como INVÁLIDO: " + (el.validationMessage || "").slice(0, 60) + ")"}`);
  }
  return res.join("; ");
};
const selecionarFn = (i, opcao) => {
  const el = (window.__mgbEls || [])[i];
  if (!el || el.tagName !== "SELECT") return "[" + i + "] não é um dropdown (select)";
  const alvo = String(opcao).toLowerCase().trim();
  const idx = [...el.options].findIndex((o) =>
    o.value.toLowerCase() === alvo || o.text.toLowerCase().trim() === alvo || o.text.toLowerCase().includes(alvo));
  if (idx < 0) return `opção "${opcao}" não encontrada em [${i}]`;
  el.selectedIndex = idx;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `selecionei "${el.options[idx].text.trim()}" em [${i}]`;
};
const marcarFn = (i, valor) => {
  const el = (window.__mgbEls || [])[i];
  if (!el || (el.type !== "checkbox" && el.type !== "radio")) return "[" + i + "] não é checkbox/radio";
  const querer = valor !== false;
  if (el.checked !== querer) el.click(); // click dispara os eventos que frameworks esperam
  return (querer ? "marquei" : "desmarquei") + " [" + i + "]";
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
// rola até o elemento mais específico que contém um texto (ex.: "comentários"),
// preferindo uma ocorrência que ainda NÃO está visível na tela.
const scrollToTextFn = (texto) => {
  const alvo = String(texto).toLowerCase().trim();
  if (!alvo) return "texto vazio";
  const especifico = (el) => {
    let cur = el;
    outer: while (true) {
      for (const ch of cur.children) {
        if ((ch.innerText || "").toLowerCase().includes(alvo)) { cur = ch; continue outer; }
      }
      break;
    }
    return cur;
  };
  const achados = [];
  for (const el of document.querySelectorAll("body *")) {
    const t = (el.innerText || el.getAttribute("aria-label") || "").toLowerCase();
    if (t.includes(alvo)) { achados.push(especifico(el)); if (achados.length > 40) break; }
  }
  if (!achados.length) return `texto "${texto}" não encontrado na página`;
  const foraDaTela = achados.find((el) => { const r = el.getBoundingClientRect(); return r.top < 0 || r.bottom > innerHeight; });
  (foraDaTela || achados[0]).scrollIntoView({ block: "center", behavior: "instant" });
  return `rolei até "${texto}"`;
};
const readFn = (offset) => {
  const t = document.body?.innerText || "";
  const o = Math.max(0, offset | 0);
  const parte = t.slice(o, o + 6000);
  return parte + (t.length > o + 6000
    ? `\n[...a página tem ${t.length} caracteres; para continuar use "ler" com offset=${o + 6000}]`
    : "");
};
// passa o mouse sobre um elemento (revela menus suspensos / tooltips que só aparecem no hover)
const hoverFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado";
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const [Ctor, type] of [[PointerEvent, "pointerover"], [MouseEvent, "mouseover"], [MouseEvent, "mouseenter"], [PointerEvent, "pointermove"], [MouseEvent, "mousemove"]])
    el.dispatchEvent(new Ctor(type, opts));
  return "passei o mouse sobre [" + i + "]";
};
// esvazia um campo de texto (antes de digitar um valor novo)
const clearFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado";
  if (el.type === "password") return "recusado: campo de senha";
  el.focus();
  if (el.isContentEditable) el.textContent = "";
  else {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    set ? set.call(el, "") : (el.value = "");
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "limpei o campo [" + i + "]";
};
// clica no primeiro elemento clicável cujo texto visível corresponde — robusto quando o índice [N] mudou
const clickTextFn = (texto) => {
  const alvo = String(texto).toLowerCase().trim();
  if (!alvo) return "texto vazio";
  const SEL = 'a[href],button,input[type="submit"],input[type="button"],[role="button"],[role="link"],summary,label,[onclick]';
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rot = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").toLowerCase().trim();
  const cand = [...document.querySelectorAll(SEL)].filter(vis);
  let el = cand.find((e) => rot(e) === alvo) || cand.find((e) => rot(e).includes(alvo));
  if (!el) { // fallback: sobe até o ancestral clicável do nó que tem exatamente esse texto
    const no = [...document.querySelectorAll("body *")].find((e) => vis(e) && (e.innerText || "").toLowerCase().trim() === alvo);
    el = no && no.closest(SEL);
  }
  if (!el) return `nenhum elemento clicável com o texto "${texto}"`;
  el.scrollIntoView({ block: "center" });
  const o = el.style.outline; el.style.outline = "3px solid #F0781E"; setTimeout(() => (el.style.outline = o), 700);
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const [Ctor, type] of [[PointerEvent, "pointerdown"], [MouseEvent, "mousedown"], [PointerEvent, "pointerup"], [MouseEvent, "mouseup"]])
    el.dispatchEvent(new Ctor(type, opts));
  el.click();
  return `cliquei em "${(el.innerText || el.value || texto).trim().slice(0, 40)}"`;
};
// rola até o fim da página — dispara o carregamento preguiçoso (lazy-load) de feeds/listas
const scrollBottomFn = () => {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  return "rolei até o fim da página";
};
// lista os links visíveis (texto → URL) — útil p/ escolher um resultado ou navegar
const linksFn = () => {
  const seen = new Set(), out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const r = a.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const href = a.href;
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const txt = (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (txt) out.push(`- ${txt} → ${href.slice(0, 90)}`);
    if (out.length >= 40) break;
  }
  return out.length ? out.join("\n") : "(nenhum link visível)";
};
// checa se um texto já apareceu no corpo da página (para "esperar_por")
const hasTextFn = (texto) => (document.body?.innerText || "").toLowerCase().includes(String(texto).toLowerCase().trim());

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
        // Tenta WebP primeiro (mais compacto que JPEG), fallback para JPEG
        let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "webp", quality: 75 }).catch(() => null);
        if (!dataUrl) dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
        out = { dataUrl };
      } else if (tool === "agora") {
        out = "Data e hora atuais: " + new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
      } else if (tool === "fechar_aba") {
        const id = +args.id;
        if (!id) out = "informe o id da aba (use listar_abas primeiro)";
        else { await chrome.tabs.remove(id); out = "fechei a aba [" + id + "]"; }
      } else {
        const tab = await getTab();
        if (tool === "snapshot") {
          const cached = await getCachedSnapshot(tab.id, tab.url);
          if (cached) {
            out = cached;
          } else {
            // estabiliza o DOM (readyState + 2 frames) antes de fotografar — como o browser-use
            await exec(tab.id, () => new Promise((res) => {
              const done = () => requestAnimationFrame(() => requestAnimationFrame(res));
              if (document.readyState === "complete") return done();
              let n = 0;
              const t = setInterval(() => {
                if (document.readyState === "complete" || ++n > 20) { clearInterval(t); done(); }
              }, 50);
            })).catch(() => {});
            out = await exec(tab.id, snapshotFn);
            const sessionId = await getSessionHash(tab.id);
            cacheSnapshot(tab.id, tab.url, sessionId, out);
          }
        }
        else if (tool === "formulario") out = await exec(tab.id, formFn);
        else if (tool === "preencher") out = await exec(tab.id, preencherFn, [args.campos || []]);
        else if (tool === "selecionar") out = await exec(tab.id, selecionarFn, [args.i, String(args.opcao ?? "")]);
        else if (tool === "marcar") out = await exec(tab.id, marcarFn, [args.i, args.valor]);
        else if (tool === "curtir") { out = await exec(tab.id, clickFn, [args.i]); await sleep(600); }
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
        } else if (tool === "rolar") {
          out = await exec(tab.id, scrollFn, [args.dir || "baixo"]);
          await invalidateSnapshot(tab.id, tab.url);
        }
        else if (tool === "rolar_ate") {
          out = await exec(tab.id, scrollToTextFn, [String(args.texto ?? "")]);
          await sleep(400);
          await invalidateSnapshot(tab.id, tab.url);
        }
        else if (tool === "rolar_fim") {
          out = await exec(tab.id, scrollBottomFn);
          await sleep(600);
          await invalidateSnapshot(tab.id, tab.url);
        }
        else if (tool === "ler") out = await exec(tab.id, readFn, [args.offset | 0]);
        else if (tool === "links") out = await exec(tab.id, linksFn);
        else if (tool === "hover") { out = await exec(tab.id, hoverFn, [args.i]); await sleep(400); }
        else if (tool === "limpar") out = await exec(tab.id, clearFn, [args.i]);
        else if (tool === "clicar_texto") {
          out = await exec(tab.id, clickTextFn, [String(args.texto ?? "")]);
          await sleep(800); await waitLoad(tab.id, 6000);
        } else if (tool === "recarregar") {
          await chrome.tabs.reload(tab.id);
          await sleep(500); await waitLoad(tab.id);
          out = "recarreguei a página";
        } else if (tool === "avancar") {
          try { await chrome.tabs.goForward(tab.id); } catch { out = "não há página à frente"; }
          await sleep(500); await waitLoad(tab.id, 6000);
          out = out || "avancei para a próxima página";
        } else if (tool === "esperar_por") {
          const alvo = String(args.texto ?? "");
          const limite = Math.min(15, Math.max(1, +args.segundos || 8));
          const t0 = Date.now(); let achou = false;
          while (Date.now() - t0 < limite * 1000) {
            achou = await exec(tab.id, hasTextFn, [alvo]).catch(() => false);
            if (achou) break;
            await sleep(400);
          }
          out = achou ? `"${alvo}" apareceu na página` : `"${alvo}" não apareceu em ${limite}s (a página pode não ter carregado ou o texto está diferente)`;
        } else if (tool === "detectar_paginacao") {
          out = await exec(tab.id, detectarPaginacaoFn, []);
        } else if (tool === "aguarda_carregamento") {
          out = await exec(tab.id, aguardaCarregamentoFn, []);
        } else if (tool === "snapshot_segmentado") {
          out = await exec(tab.id, segmentaSnapshotFn, []);
        } else out = "ferramenta desconhecida: " + tool;
      }
      sendResponse({ ok: true, out });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // resposta assíncrona
});

// ---- SEMANA 2: FERRAMENTAS ADICIONAIS ----

// Detectar paginação: retorna {tipo, total, atual, proximo_elemento}
const detectarPaginacaoFn = () => {
  const sigs = {
    proximo: [
      ...document.querySelectorAll('a[rel="next"], a[aria-label*="next"], a[aria-label*="Próxima"], button:contains("Próxima"), a:contains(">"), a:contains("→")')
    ],
    carregar_mais: [...document.querySelectorAll('button:contains("Carregar"), a:contains("Carregar mais"), [class*="load-more"]')],
    pagina_numerada: [...document.querySelectorAll('a[href*="page"], a[href*="p="]')],
    indicador: document.querySelector('[aria-label*="of"], [aria-label*="de"], .pagination')
  };
  
  const tem = (k) => sigs[k].length > 0;
  const tipo = tem("proximo") ? "pagination" : tem("carregar_mais") ? "infinite" : "none";
  
  // Tentar extrair "X de Y"
  const txt = document.body?.innerText || "";
  const match = txt.match(/(\d+)\s+de\s+(\d+)/i) || txt.match(/(\d+)\s+\/\s+(\d+)/);
  const atual = match ? parseInt(match[1]) : 1;
  const total = match ? parseInt(match[2]) : atual + 1;
  
  return {
    tipo,
    total_paginas: total,
    pagina_atual: atual,
    proximo_elemento: sigs.proximo[0] || sigs.carregar_mais[0] || null
  };
};

// Aguardar carregamento: spinner, aria-busy, skeleton
const aguardaCarregamentoFn = async () => {
  const spinners = () => document.querySelectorAll('[class*="load"], [class*="spin"], [aria-busy="true"], .skeleton');

  let tentativas = 0;
  while (spinners().length > 0 && tentativas < 20) {
    await new Promise(r => setTimeout(r, 500));
    tentativas++;
  }

  return tentativas < 20 ? "carregado" : "timeout (spinner pode estar travado)";
};

// Segmentação de snapshot: detectar seções (header, nav, main, sidebar, footer)
const segmentaSnapshotFn = () => {
  const identificaSecao = (el) => {
    const role = el.getAttribute("role");
    const id = el.id?.toLowerCase() || "";
    const cls = el.className?.toLowerCase() || "";

    if (role === "navigation" || id.includes("nav") || cls.includes("navbar") || cls.includes("nav-")) return "nav";
    if (role === "main" || id.includes("main") || id.includes("content") || cls.includes("main-") || cls.includes("content")) return "main";
    if (el.tagName === "ASIDE" || id.includes("sidebar") || cls.includes("sidebar") || cls.includes("aside")) return "sidebar";
    if (el.tagName === "HEADER" || id.includes("header") || cls.includes("header-")) return "header";
    if (el.tagName === "FOOTER" || id.includes("footer") || cls.includes("footer-")) return "footer";

    return null;
  };

  const secoes = {
    header: { elementos: [], texto: "" },
    nav: { elementos: [], texto: "" },
    main: { elementos: [], texto: "" },
    sidebar: { elementos: [], texto: "" },
    footer: { elementos: [], texto: "" },
    outro: { elementos: [], texto: "" }
  };

  // Usar mesma estratégia do snapshot para encontrar elementos
  const SEL = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
  const cands = [];
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  document.querySelectorAll(SEL).forEach((el) => {
    if (vis(el)) cands.push(el);
  });

  // Distribuir elementos por seção
  cands.slice(0, 180).forEach((el, i) => {
    // Encontrar o maior container que identifica a seção
    let container = el;
    let secao = "outro";
    while (container && container !== document.body) {
      const s = identificaSecao(container);
      if (s) { secao = s; break; }
      container = container.parentElement;
    }

    const elem = {
      i,
      tag: el.tagName.toLowerCase(),
      texto: (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "").trim().slice(0, 50),
      secao
    };
    secoes[secao].elementos.push(elem);
  });

  // Coletar texto por seção
  const coleTxt = (sec) => (secoes[sec].texto = document.querySelector('[role="' + (sec === "nav" ? "navigation" : sec) + '"], ' +
    (sec === "header" ? "header" : sec === "footer" ? "footer" : "aside") + ', [class*="' + sec + '"]')
    ?.innerText?.slice(0, 300) || "");

  Object.keys(secoes).forEach(coleTxt);

  return {
    tipo: "segmentado",
    secoes,
    resumo: Object.fromEntries(Object.entries(secoes).map(([k, v]) => [k, v.elementos.length + " elementos"]))
  };
};
