(() => {
  if (window.__JSNITCH_NETWORK_HOOKED__) {
    return;
  }

  window.__JSNITCH_NETWORK_HOOKED__ = true;

  let sequence = 0;

  function nextId(prefix) {
    sequence += 1;
    return `${prefix}:${Date.now()}:${sequence}`;
  }

  function resolveUrl(rawUrl) {
    try {
      return new URL(rawUrl, window.location.href).toString();
    } catch {
      return String(rawUrl || "");
    }
  }

  function normalizeHeaders(headers) {
    if (!headers) {
      return {};
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }

    if (Array.isArray(headers)) {
      return Object.fromEntries(
        headers
          .filter((entry) => Array.isArray(entry) && entry.length >= 2)
          .map(([key, value]) => [String(key), String(value)])
      );
    }

    if (typeof headers === "object") {
      return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, String(value)])
      );
    }

    return {};
  }

  function readRequestReferrer(input, init) {
    if (init?.referrer && init.referrer !== "about:client") {
      return String(init.referrer);
    }

    if (input instanceof Request && input.referrer && input.referrer !== "about:client") {
      return String(input.referrer);
    }

    return document.referrer || "";
  }

  function getInitiatorUrl() {
    return window.location.href || "";
  }

  function normalizePayload(body) {
    if (body == null) {
      return null;
    }

    if (typeof body === "string") {
      return body;
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    if (body instanceof FormData) {
      return JSON.stringify(
        Array.from(body.entries()).map(([key, value]) => [key, String(value)])
      );
    }

    if (body instanceof Blob) {
      return `[blob ${body.type || "application/octet-stream"} ${body.size}]`;
    }

    if (body instanceof ArrayBuffer) {
      return `[arrayBuffer ${body.byteLength}]`;
    }

    if (ArrayBuffer.isView(body)) {
      return `[typedArray ${body.byteLength}]`;
    }

    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  function parseXhrHeaders(rawHeaders) {
    const headers = {};

    for (const line of rawHeaders.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const separator = line.indexOf(":");
      if (separator === -1) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      headers[key] = value;
    }

    return headers;
  }

  function postRequest(request) {
    window.postMessage(
      {
        source: "jsnitch-network",
        type: "NETWORK_REQUEST",
        request
      },
      "*"
    );
  }

  const originalFetch = window.fetch;
  window.fetch = async function jsnitchFetch(...args) {
    const input = args[0];
    const init = args[1] || {};
    const requestUrl = resolveUrl(typeof input === "string" ? input : input?.url || "");
    const method = init.method || (input instanceof Request ? input.method : "GET") || "GET";
    const headers = init.headers || (input instanceof Request ? input.headers : undefined);
    const payload = init.body ?? null;
    const startedAt = performance.now();

    const response = await originalFetch.apply(this, args);

    try {
      const cloned = response.clone();
      const text = await cloned.text();

      postRequest({
        id: nextId("fetch"),
        url: requestUrl,
        method,
        requestHeaders: normalizeHeaders(headers),
        responseHeaders: normalizeHeaders(response.headers),
        payload: normalizePayload(payload),
        response: text,
        type: "fetch",
        statusCode: response.status,
        statusText: response.statusText || "",
        ok: response.ok,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        initiatorUrl: getInitiatorUrl(),
        referrer: readRequestReferrer(input, init),
        responseUrl: resolveUrl(response.url || requestUrl)
      });
    } catch {
      postRequest({
        id: nextId("fetch"),
        url: requestUrl,
        method,
        requestHeaders: normalizeHeaders(headers),
        responseHeaders: normalizeHeaders(response.headers),
        payload: normalizePayload(payload),
        response: "",
        type: "fetch",
        statusCode: response.status,
        statusText: response.statusText || "",
        ok: response.ok,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        initiatorUrl: getInitiatorUrl(),
        referrer: readRequestReferrer(input, init),
        responseUrl: resolveUrl(response.url || requestUrl)
      });
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function jsnitchOpen(method, url, ...rest) {
    this.__jsnitch = {
      id: nextId("xhr"),
      method: method || "GET",
      url: resolveUrl(typeof url === "string" ? url : String(url)),
      payload: null,
      requestHeaders: {},
      openedAt: 0,
      referrer: document.referrer || "",
      initiatorUrl: getInitiatorUrl()
    };

    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function jsnitchSetRequestHeader(name, value) {
    if (this.__jsnitch && name) {
      this.__jsnitch.requestHeaders[String(name)] = String(value);
    }

    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function jsnitchSend(body) {
    if (this.__jsnitch) {
      this.__jsnitch.payload = normalizePayload(body);
      this.__jsnitch.openedAt = performance.now();
    }

    this.addEventListener(
      "loadend",
      () => {
        if (!this.__jsnitch) {
          return;
        }

        let responseText = "";
        try {
          responseText = this.responseType === "" || this.responseType === "text"
            ? this.responseText || ""
            : `[${this.responseType} response]`;
        } catch {
          responseText = "";
        }

        let headers = {};
        try {
          headers = parseXhrHeaders(this.getAllResponseHeaders());
        } catch {
          headers = {};
        }

        postRequest({
          id: this.__jsnitch.id,
          url: this.__jsnitch.url,
          method: this.__jsnitch.method,
          requestHeaders: this.__jsnitch.requestHeaders,
          responseHeaders: headers,
          payload: this.__jsnitch.payload,
          response: responseText,
          type: "xhr",
          statusCode: this.status,
          statusText: this.statusText || "",
          ok: this.status >= 200 && this.status < 400,
          durationMs: this.__jsnitch.openedAt
            ? Math.round((performance.now() - this.__jsnitch.openedAt) * 100) / 100
            : null,
          initiatorUrl: this.__jsnitch.initiatorUrl,
          referrer: this.__jsnitch.referrer,
          responseUrl: resolveUrl(this.responseURL || this.__jsnitch.url)
        });
      },
      { once: true }
    );

    return originalSend.call(this, body);
  };
})();
