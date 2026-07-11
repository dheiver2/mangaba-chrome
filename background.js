chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Extrai o texto visível da aba ativa quando o side panel pede
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "GET_PAGE_CONTEXT") return;
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || tab.url?.startsWith("chrome://")) {
        sendResponse({ ok: false, error: "Página não acessível" });
        return;
      }
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title,
          url: location.href,
          text: (document.body?.innerText || "").slice(0, 12000)
        })
      });
      sendResponse({ ok: true, page: result });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // resposta assíncrona
});
