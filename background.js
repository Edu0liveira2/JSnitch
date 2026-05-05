import { scanContent } from "./scanner.js";

const MAX_CONTENT_SIZE = 500 * 1024;
const trackedContentTypes = [
  "application/javascript",
  "text/javascript",
  "application/json",
  "text/html"
];

let monitoring = false;
const scannedUrls = new Set();
const pendingUrls = new Set();
const findings = [];
const analyzedResources = new Map();
const networkRequests = [];
const networkRequestIds = new Set();
const MAX_NETWORK_ITEMS = 300;
const MAX_NETWORK_TEXT = 200 * 1024;

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isTrackedContentType(contentType = "") {
  const normalized = contentType.toLowerCase();

  if (!normalized) {
    return false;
  }

  if (trackedContentTypes.some((value) => normalized.includes(value))) {
    return true;
  }

  return normalized.startsWith("text/");
}

function getHeaderValue(headers, name) {
  if (!Array.isArray(headers)) {
    return "";
  }

  const target = name.toLowerCase();
  const header = headers.find((item) => item.name?.toLowerCase() === target);
  return header?.value || "";
}

function addFindings(newFindings) {
  if (!newFindings.length) {
    return;
  }

  findings.unshift(...newFindings);

  if (findings.length > 500) {
    findings.length = 500;
  }
}

function classifyResource(contentType) {
  const normalized = contentType.toLowerCase();

  if (normalized.includes("javascript")) {
    return "javascript";
  }

  if (normalized.includes("json")) {
    return "json";
  }

  if (normalized.includes("html")) {
    return "html";
  }

  return "text";
}

function buildResourceRecord(url, contentType, content, findingsCount) {
  return {
    url,
    contentType,
    kind: classifyResource(contentType),
    size: content.length,
    findingsCount,
    scannedAt: new Date().toISOString()
  };
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
}

function normalizeTextPayload(value) {
  if (value == null) {
    return null;
  }

  const text = typeof value === "string" ? value : String(value);
  return text.slice(0, MAX_NETWORK_TEXT);
}

function storeNetworkRequest(entry) {
  if (!entry?.id || networkRequestIds.has(entry.id)) {
    return;
  }

  const normalizedUrl = normalizeUrl(entry.url);
  if (!normalizedUrl) {
    return;
  }

  const record = {
    id: entry.id,
    url: normalizedUrl,
    method: String(entry.method || "GET").toUpperCase(),
    headers: normalizeHeaders(entry.headers),
    payload: normalizeTextPayload(entry.payload),
    response: normalizeTextPayload(entry.response) || "",
    type: entry.type === "xhr" ? "xhr" : "fetch",
    tabId: Number.isInteger(entry.tabId) ? entry.tabId : null,
    createdAt: new Date().toISOString()
  };

  networkRequests.unshift(record);
  networkRequestIds.add(record.id);

  if (networkRequests.length > MAX_NETWORK_ITEMS) {
    const removed = networkRequests.pop();
    if (removed) {
      networkRequestIds.delete(removed.id);
    }
  }
}

function parseOriginScope(scopeUrl) {
  try {
    const url = new URL(scopeUrl);
    return {
      origin: url.origin,
      hostname: url.hostname
    };
  } catch {
    return null;
  }
}

function listResourcesForScope(scope) {
  const resources = Array.from(analyzedResources.values());

  if (!scope) {
    return resources;
  }

  return resources.filter((resource) => {
    try {
      return new URL(resource.url).origin === scope.origin;
    } catch {
      return false;
    }
  });
}

function listNetworkRequestsForScope(scope, tabId) {
  return networkRequests.filter((entry) => {
    if (tabId != null && entry.tabId === tabId) {
      return true;
    }

    if (!scope) {
      return true;
    }

    try {
      return new URL(entry.url).origin === scope.origin;
    } catch {
      return false;
    }
  });
}

function buildStructure(resources) {
  const root = {};

  for (const resource of resources) {
    try {
      const { pathname } = new URL(resource.url);
      const parts = pathname.split("/").filter(Boolean);
      const segments = parts.length ? parts : ["/"];
      let node = root;

      for (const segment of segments) {
        node[segment] ||= {};
        node = node[segment];
      }
    } catch {
      // Ignore malformed URLs that slipped through earlier validation.
    }
  }

  return root;
}

async function getCookiesForScope(scope) {
  if (!scope?.hostname) {
    return [];
  }

  try {
    const cookies = await chrome.cookies.getAll({ domain: scope.hostname });

    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite || "unspecified",
      session: cookie.session
    }));
  } catch (error) {
    console.warn("JSnitch cookies lookup failed:", scope.hostname, error);
    return [];
  }
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let received = 0;

  try {
    while (received < maxBytes) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      const remaining = maxBytes - received;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(decoder.decode(chunk, { stream: true }));
      received += chunk.byteLength;

      if (value.byteLength > remaining) {
        break;
      }
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore stream cancellation failures.
    }
  }
}

async function refetchAndScan(url) {
  pendingUrls.add(url);

  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "force-cache",
      redirect: "follow"
    });

    if (!response.ok) {
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!isTrackedContentType(contentType)) {
      return;
    }

    const text = await readLimitedText(response, MAX_CONTENT_SIZE);
    const newFindings = scanContent(url, text);
    analyzedResources.set(
      url,
      buildResourceRecord(url, contentType, text, newFindings.length)
    );
    addFindings(newFindings);
  } catch (error) {
    console.warn("JSnitch fetch failed:", url, error);
  } finally {
    pendingUrls.delete(url);
    scannedUrls.add(url);
  }
}

function handleCompletedRequest(details) {
  if (!monitoring) {
    return;
  }

  if (details.method && details.method !== "GET") {
    return;
  }

  const url = normalizeUrl(details.url);
  if (!url || scannedUrls.has(url) || pendingUrls.has(url)) {
    return;
  }

  const contentType = getHeaderValue(details.responseHeaders, "content-type");
  if (!isTrackedContentType(contentType)) {
    return;
  }

  void refetchAndScan(url);
}

chrome.webRequest.onHeadersReceived.addListener(
  handleCompletedRequest,
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_MONITORING") {
    monitoring = true;
    sendResponse({ ok: true, monitoring });
    return;
  }

  if (message?.type === "STOP_MONITORING") {
    monitoring = false;
    sendResponse({ ok: true, monitoring });
    return;
  }

  if (message?.type === "GET_STATE") {
    void (async () => {
      const scope = parseOriginScope(message.currentUrl);
      const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
      const scopedResources = listResourcesForScope(scope).sort((left, right) => {
        return right.scannedAt.localeCompare(left.scannedAt);
      });
      const scopedFindings = findings.filter((finding) => {
        if (!scope) {
          return true;
        }

        try {
          return new URL(finding.url).origin === scope.origin;
        } catch {
          return false;
        }
      });
      const cookies = await getCookiesForScope(scope);
      const requests = listNetworkRequestsForScope(scope, tabId);

      sendResponse({
        ok: true,
        monitoring,
        scope,
        networkRequests: requests,
        counts: {
          scanned: scannedUrls.size,
          pending: pendingUrls.size,
          findings: findings.length,
          requests: requests.length
        },
        findings: scopedFindings,
        report: scopedResources,
        cookies,
        structure: buildStructure(scopedResources)
      });
    })();
    return true;
  }

  if (message?.type === "CLEAR_RESULTS") {
    scannedUrls.clear();
    pendingUrls.clear();
    findings.length = 0;
    analyzedResources.clear();
    networkRequests.length = 0;
    networkRequestIds.clear();
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "STORE_NETWORK_REQUEST") {
    storeNetworkRequest({
      ...message.request,
      tabId: _sender?.tab?.id ?? null
    });
    sendResponse({ ok: true });
  }
});
