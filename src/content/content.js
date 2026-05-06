(() => {
  if (window.__JSNITCH_CONTENT_ATTACHED__) {
    return;
  }

  window.__JSNITCH_CONTENT_ATTACHED__ = true;

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
})();
