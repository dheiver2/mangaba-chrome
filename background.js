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

// windowId vem do side panel que enviou a mensagem (ele sabe em qual janela está,
// via chrome.windows.getCurrent()). Sem isso, "currentWindow" aqui no service worker
// resolve pra ÚLTIMA janela com foco do SO, não necessariamente a do side panel que
// pediu — com várias janelas do Chrome abertas, isso lia a aba errada silenciosamente.
async function getTab(windowId) {
  const query = windowId ? { active: true, windowId } : { active: true, currentWindow: true };
  const [tab] = await chrome.tabs.query(query);
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
    const jaCandidato = new Set();
    for (const el of root.querySelectorAll(SEL)) {
      if (cands.length >= MAX_CANDIDATES) break;
      if (vis(el)) { cands.push(el); jaCandidato.add(el); }
    }
    for (const el of root.querySelectorAll("*")) {
      if (cands.length >= MAX_CANDIDATES || ++varridos > MAX_TRAVERSALS) break;
      if (el.shadowRoot) walk(el.shadowRoot);
      else if (el.tagName === "IFRAME") { try { walk(el.contentDocument); } catch { /* cross-origin */ } }
      // Heurística extra: divs/spans "clicáveis" sem tag semântica nem role — comum em
      // SPAs React/Vue que usam onClick em vez de <button> (ex.: cards de dashboard).
      // cursor:pointer é o sinal mais forte disponível sem inspecionar listeners JS
      // (impossível via DOM puro). Ignora elementos grandes demais (prováveis containers
      // com clique delegado, não itens específicos) para não virarem "botões" do tamanho da tela.
      else if (!jaCandidato.has(el) && vis(el)) {
        const r = el.getBoundingClientRect();
        const grandeDemais = r.width > innerWidth * 0.9 && r.height > innerHeight * 0.5;
        if (!grandeDemais && getComputedStyle(el).cursor === "pointer") {
          cands.push(el);
          jaCandidato.add(el);
        }
      }
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
// Localiza o elemento [i] para uma ação "de verdade": rola até ele e devolve o centro em
// coordenadas da janela principal (somando os iframes), avisando se está coberto ou desabilitado.
const alvoFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return { ok: false, erro: "o elemento [" + i + "] não existe; faça snapshot de novo" };
  if (!el.isConnected) return { ok: false, erro: "o elemento [" + i + "] saiu da página (ela mudou); faça snapshot de novo" };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, erro: "o elemento [" + i + "] está invisível" };
  const doc = el.ownerDocument;
  const vw = doc.defaultView;
  // ponto de toque: centro do pedaço visível do elemento
  let x = (Math.max(r.left, 0) + Math.min(r.right, vw.innerWidth)) / 2;
  let y = (Math.max(r.top, 0) + Math.min(r.bottom, vw.innerHeight)) / 2;
  const raiz = el.getRootNode();
  const topo = (raiz.elementFromPoint ? raiz : doc).elementFromPoint(x, y);
  const descrever = (n) => (n.tagName.toLowerCase() + " \"" + (n.innerText || n.getAttribute("aria-label") || "").trim().slice(0, 40) + "\"");
  const coberto = topo && topo !== el && !el.contains(topo) && !topo.contains(el) ? descrever(topo) : null;
  let w = vw;
  while (w && w.frameElement) {
    const fr = w.frameElement.getBoundingClientRect();
    x += fr.left + w.frameElement.clientLeft;
    y += fr.top + w.frameElement.clientTop;
    w = w.parent;
  }
  return { ok: true, x, y, coberto, desabilitado: !!el.disabled || el.getAttribute("aria-disabled") === "true" };
};

// Foca o campo [i] e seleciona o conteúdo, para o texto digitado substituir o que havia.
const focoFn = (i, selecionar) => {
  const el = (window.__mgbEls || [])[i];
  if (!el || !el.isConnected) return { ok: false, erro: "o elemento [" + i + "] não está mais na página; faça snapshot de novo" };
  if (el.type === "password") return { ok: false, erro: "recusado: campo de senha — peça que o usuário digite manualmente" };
  el.scrollIntoView({ block: "center" });
  el.focus();
  if (selecionar) {
    if (typeof el.select === "function" && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.select();
    else if (el.isContentEditable) {
      const sel = el.ownerDocument.getSelection();
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  return { ok: true };
};

// Valor atual do campo [i], para conferir se a digitação pegou.
const valorFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return null;
  return el.isContentEditable ? el.innerText : String(el.value ?? el.innerText ?? "");
};

// Há um campo editável com foco neste frame? (para escrever em editores como o Google Docs)
const focoEditavelFn = () => {
  if (!document.hasFocus()) return false;
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName));
};

const clickFn = (i) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado (a página mudou? refaça o snapshot agindo de novo)";
  if (!el.isConnected) return "o elemento [" + i + "] saiu da página (ela mudou); faça snapshot de novo";
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
// Editores ricos (Google Docs etc.) escrevem num iframe contenteditable que o snapshot
// não enxerga. Roda em TODOS os frames: o que tiver o corpo editável recebe o texto.
const escreverFn = (texto) => {
  const corpo = document.body;
  if (!corpo || !corpo.isContentEditable) return { ok: false };
  const antes = corpo.innerText;
  corpo.focus();
  document.execCommand("insertText", false, texto);
  // só vale se o texto apareceu de fato; sem isto o agente afirmava que escreveu sem escrever
  const depois = corpo.innerText;
  const trecho = texto.trim().slice(0, 25);
  return { ok: depois !== antes && (!trecho || depois.includes(trecho)), frame: location.hostname };
};

const typeFn = (i, texto) => {
  const el = (window.__mgbEls || [])[i];
  if (!el) return "elemento [" + i + "] não encontrado";
  if (el.type === "password") return "recusado: campo de senha — peça que o usuário digite manualmente";
  const o = el.style.outline;
  el.style.outline = "3px solid #F0781E";
  setTimeout(() => (el.style.outline = o), 700);
  el.focus();
  if (el.isContentEditable) {
    const sel = el.ownerDocument.getSelection();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    if (!el.ownerDocument.execCommand("insertText", false, texto)) el.textContent = texto;
  } else {
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
  const codigos = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
  const kc = codigos[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
  for (const type of ["keydown", "keypress", "keyup"]) {
    const ev = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, "keyCode", { get: () => kc });
    Object.defineProperty(ev, "which", { get: () => kc });
    el.dispatchEvent(ev);
  }
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

// ---- entrada real (chrome.debugger) ----
// Eventos sintéticos (dispatchEvent) chegam com isTrusted=false: muitos sites e editores
// (Google Docs, chats, React com validação) os ignoram. Pelo protocolo do DevTools o clique e
// a digitação chegam como se fossem do usuário. Fica anexado só enquanto há ações seguidas.
const anexados = new Map(); // tabId -> timer para soltar
const SOLTAR_APOS_MS = 20000;
async function cdp(tabId, metodo, params = {}) {
  if (anexados.has(tabId)) clearTimeout(anexados.get(tabId));
  else await chrome.debugger.attach({ tabId }, "1.3");
  anexados.set(tabId, setTimeout(() => {
    anexados.delete(tabId);
    chrome.debugger.detach({ tabId }).catch(() => {});
  }, SOLTAR_APOS_MS));
  return chrome.debugger.sendCommand({ tabId }, metodo, params);
}
chrome.debugger.onDetach.addListener(({ tabId }) => {
  clearTimeout(anexados.get(tabId));
  anexados.delete(tabId);
});

async function cliqueReal(tabId, x, y) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

const TECLAS_REAIS = {
  Enter: [13, "\r"], Tab: [9], Escape: [27], Backspace: [8], Delete: [46], Space: [32, " "],
  ArrowUp: [38], ArrowDown: [40], ArrowLeft: [37], ArrowRight: [39], PageUp: [33], PageDown: [34], Home: [36], End: [35],
};
async function teclaReal(tabId, tecla) {
  const [codigo, texto] = TECLAS_REAIS[tecla] || [tecla.length === 1 ? tecla.toUpperCase().charCodeAt(0) : 0, tecla.length === 1 ? tecla : undefined];
  const base = { key: tecla === "Space" ? " " : tecla, code: tecla, windowsVirtualKeyCode: codigo, nativeVirtualKeyCode: codigo };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: texto ? "keyDown" : "rawKeyDown", ...base, ...(texto ? { text: texto } : {}) });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // contexto da aba que o usuário está vendo, para o agente trabalhar nela
  if (msg.type === "GET_PAGE_CONTEXT") {
    getTab(msg.windowId)
      .then((tab) => sendResponse({ ok: true, page: { title: tab.title || "", url: tab.url || "" } }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type !== "AGENT_TOOL") return;
  (async () => {
    try {
      const { tool, args = {} } = msg;
      let out;
      if (tool === "esperar") {
        const s = Math.min(10, Math.max(1, +args.segundos || 1));
        await sleep(s * 1000);
        out = `esperei ${s}s`;
      } else if (tool === "nova_aba") {
        const nt = await chrome.tabs.create({ url: args.url, active: true, ...(msg.windowId ? { windowId: msg.windowId } : {}) });
        await sleep(500); await waitLoad(nt.id);
        out = "abri nova aba em " + args.url;
      } else if (tool === "listar_abas") {
        const tabs = await chrome.tabs.query(msg.windowId ? { windowId: msg.windowId } : { currentWindow: true });
        out = tabs.map((t) => `[${t.id}]${t.active ? "*" : ""} ${(t.title || "").slice(0, 50)} — ${(t.url || "").slice(0, 60)}`).join("\n");
      } else if (tool === "trocar_aba") {
        await chrome.tabs.update(+args.id, { active: true });
        await sleep(400);
        out = "fui para a aba [" + args.id + "]";
      } else if (tool === "olhar") {
        const tab = await getTab(msg.windowId);
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
      } else if (tool === "ler_varias") {
        // lê várias URLs em paralelo (comparar fontes): cada uma abre em aba própria (sem
        // roubar foco), lê o texto, e a aba fecha — nada disso depende da aba ativa.
        const urls = (Array.isArray(args.urls) ? args.urls : []).filter((u) => /^https?:\/\//.test(u)).slice(0, 4);
        if (!urls.length) {
          out = "informe args.urls como lista de 2 a 4 URLs (http/https)";
        } else {
          const resultados = await Promise.all(urls.map(async (url) => {
            let nt;
            try {
              nt = await chrome.tabs.create({ url, active: false });
              await waitLoad(nt.id, 10000);
              const texto = await exec(nt.id, () => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 4000));
              return { url, texto };
            } catch (e) {
              return { url, erro: String(e.message || e).slice(0, 120) };
            } finally {
              if (nt?.id) chrome.tabs.remove(nt.id).catch(() => {});
            }
          }));
          out = resultados.map((r, i) =>
            `--- Fonte ${i + 1}: ${r.url} ---\n${r.erro ? `ERRO: ${r.erro}` : r.texto}`
          ).join("\n\n");
        }
      } else {
        const tab = await getTab(msg.windowId);
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
          const alvo = await exec(tab.id, alvoFn, [args.i]);
          if (!alvo.ok) throw new Error(alvo.erro);
          const antes = (await chrome.tabs.get(tab.id)).url;
          let real = true;
          try { await cliqueReal(tab.id, alvo.x, alvo.y); } catch { real = false; await exec(tab.id, clickFn, [args.i]); }
          await sleep(800); await waitLoad(tab.id, 6000);
          const depois = (await chrome.tabs.get(tab.id)).url;
          out = "cliquei em [" + args.i + "]" + (real ? "" : " (modo simulado)")
            + (alvo.desabilitado ? " — atenção: o elemento estava desabilitado" : "")
            + (alvo.coberto ? " — atenção: havia outro elemento por cima (" + alvo.coberto + "); confira o resultado" : "")
            + (depois !== antes ? " — a página mudou para " + depois : "");
        } else if (tool === "digitar") {
          const texto = String(args.texto ?? "");
          const foco = await exec(tab.id, focoFn, [args.i, true]);
          if (!foco.ok) throw new Error(foco.erro);
          let real = true;
          try { await cdp(tab.id, "Input.insertText", { text: texto }); } catch { real = false; }
          let valor = await exec(tab.id, valorFn, [args.i]);
          if (!real || !String(valor ?? "").includes(texto.slice(0, 30))) {
            await exec(tab.id, typeFn, [args.i, texto]);
            valor = await exec(tab.id, valorFn, [args.i]);
            real = false;
          }
          const pegou = String(valor ?? "").includes(texto.slice(0, 30));
          if (!pegou) throw new Error("o campo [" + args.i + "] não aceitou o texto; valor atual: \"" + String(valor ?? "").slice(0, 80) + "\"");
          out = "digitei em [" + args.i + "]" + (real ? "" : " (modo simulado)") + "; valor agora: \"" + String(valor).slice(0, 80) + "\"";
        }
        else if (tool === "escrever") {
          const texto = String(args.texto ?? "");
          // com foco num editor (ex.: Google Docs depois de clicar no documento), a digitação
          // real funciona mesmo onde o texto não fica no DOM
          const focos = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: focoEditavelFn });
          if (focos.some((f) => f.result)) {
            try {
              await cdp(tab.id, "Input.insertText", { text: texto });
              out = "escrevi o texto como digitação real no ponto do cursor; confira com ler ou olhar";
            } catch { /* sem chrome.debugger: cai no modo simulado abaixo */ }
          }
          if (out === undefined) {
            const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: escreverFn, args: [texto] });
            const feito = frames.map((f) => f.result).find((r) => r && r.ok);
            if (!feito) throw new Error("o editor não aceitou o texto (ou não achei a área de edição); clique dentro do documento e tente de novo. Não escrevi nada.");
            out = "escrevi o texto no documento (modo simulado)";
          }
        }
        else if (tool === "tecla") {
          const tecla = args.tecla || "Enter";
          if (Number.isInteger(args.i)) {
            const foco = await exec(tab.id, focoFn, [args.i, false]);
            if (!foco.ok) throw new Error(foco.erro);
          }
          try { await teclaReal(tab.id, tecla); out = "pressionei " + tecla; }
          catch { out = await exec(tab.id, keyFn, [args.i, tecla]) + " (modo simulado)"; }
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
  // :contains() é seletor do jQuery, não existe no querySelectorAll nativo — lançaria
  // SyntaxError se esta função rodasse (hoje é código morto: nenhuma ferramenta chamada
  // "detectar_paginacao" está em TOOL_NAMES, então o modelo nunca consegue chamá-la).
  // Filtra por texto em JS em vez de tentar :contains() na engine do CSS.
  const porTexto = (sel, termos) => [...document.querySelectorAll(sel)].filter((el) => {
    const t = (el.innerText || el.textContent || "").trim();
    return termos.some((termo) => t.includes(termo));
  });
  const sigs = {
    proximo: [
      ...document.querySelectorAll('a[rel="next"], a[aria-label*="next"], a[aria-label*="Próxima"]'),
      ...porTexto("button, a", ["Próxima", ">", "→"])
    ],
    carregar_mais: [...porTexto("button, a", ["Carregar", "Carregar mais"]), ...document.querySelectorAll('[class*="load-more"]')],
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
