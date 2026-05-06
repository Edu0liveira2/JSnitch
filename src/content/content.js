(() => {
  if (window.__JSNITCH_CONTENT_ATTACHED__) {
    return;
  }

  window.__JSNITCH_CONTENT_ATTACHED__ = true;
  const MAX_INLINE_TEXT = 250 * 1024;
  let inlineSnapshotSent = false;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/content/injected.js");
  script.dataset.jsnitch = "injected";
  script.async = false;
  script.addEventListener("load", () => {
    script.remove();
  });

  const parent = document.documentElement || document.head || document.body;
  if (parent) {
    parent.prepend(script);
  }

  function truncateText(value) {
    const text = String(value || "");
    return text.length > MAX_INLINE_TEXT ? text.slice(0, MAX_INLINE_TEXT) : text;
  }

  function sendInlineSnapshot(options = {}) {
    const { force = false } = options;

    if (inlineSnapshotSent && !force) {
      return;
    }

    inlineSnapshotSent = true;

    try {
      const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"))
        .map((node, index) => ({
          id: `inline-script-${index + 1}`,
          type: "inline-script",
          contentType: "text/javascript",
          content: truncateText(node.textContent || "")
        }))
        .filter((entry) => entry.content.trim().length > 0);

      const documentHtml = document.documentElement
        ? truncateText(document.documentElement.outerHTML || "")
        : "";

      const resources = [];

      if (documentHtml.trim()) {
        resources.push({
          id: "document-html",
          type: "document-html",
          contentType: "text/html",
          content: documentHtml
        });
      }

      resources.push(...inlineScripts);

      if (!resources.length) {
        return;
      }

      chrome.runtime.sendMessage({
        type: "STORE_INLINE_RESOURCES",
        pageUrl: window.location.href,
        resources
      }).catch(() => {
        // Ignore reload-time bridge failures when the extension context has been replaced.
      });
    } catch {
      // Ignore inline snapshot failures to avoid breaking the page.
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const payload = event.data;
    if (payload?.source !== "jsnitch-network" || payload.type !== "NETWORK_REQUEST") {
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "STORE_NETWORK_REQUEST",
        request: payload.request
      }).catch(() => {
        // Ignore reload-time bridge failures when the old page script outlives the extension context.
      });
    } catch {
      // Ignore extension invalidation errors after reloads.
    }
  });

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", sendInlineSnapshot, { once: true });
  } else {
    sendInlineSnapshot();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "REQUEST_INLINE_SNAPSHOT") {
      return;
    }

    sendInlineSnapshot({ force: true });
    sendResponse({ ok: true });
  });
})();
