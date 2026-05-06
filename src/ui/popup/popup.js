const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
const exportJsonButton = document.getElementById("exportJsonButton");
const exportMarkdownButton = document.getElementById("exportMarkdownButton");
const monitoringStatus = document.getElementById("monitoringStatus");
const monitoringPill = document.getElementById("monitoringPill");
const scannedCount = document.getElementById("scannedCount");
const pendingCount = document.getElementById("pendingCount");
const findingsCount = document.getElementById("findingsCount");
const requestsCount = document.getElementById("requestsCount");
const selectedRequestType = document.getElementById("selectedRequestType");
const findingsList = document.getElementById("findingsList");
const findingsSubhead = document.getElementById("findingsSubhead");
const reportList = document.getElementById("reportList");
const reportSubhead = document.getElementById("reportSubhead");
const cookiesList = document.getElementById("cookiesList");
const cookiesSubhead = document.getElementById("cookiesSubhead");
const structureTree = document.getElementById("structureTree");
const structureSubhead = document.getElementById("structureSubhead");
const customSearchInput = document.getElementById("customSearchInput");
const customSearchButton = document.getElementById("customSearchButton");
const customSearchResults = document.getElementById("customSearchResults");
const searchSubhead = document.getElementById("searchSubhead");
const networkRequestsList = document.getElementById("networkRequestsList");
const networkSubhead = document.getElementById("networkSubhead");
const networkDetailMeta = document.getElementById("networkDetailMeta");
const networkDetailBody = document.getElementById("networkDetailBody");
const methodFilter = document.getElementById("methodFilter");
const primaryTabButtons = Array.from(document.querySelectorAll(".primary-tab-button"));
const viewPanels = Array.from(document.querySelectorAll(".view-panel"));
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

let pollTimer = null;
let latestNetworkRequests = [];
let latestFilteredNetworkRequests = [];
let selectedNetworkRequestId = null;
let currentSearchQuery = "";
let currentMethodFilter = "ALL";
let selectedDetailCacheKey = "";
let selectedDetailCacheHtml = "";
let selectedDetailRenderToken = 0;
let selectedDetailSummary = "";
const MAX_DETAIL_TEXT_LENGTH = 40000;
const MAX_JSON_PRETTY_LENGTH = 12000;

function slugify(value) {
  return String(value || "session")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "session";
}

function sendMessage(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab?.url || "";
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab || null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function titleCase(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderFindings(items) {
  if (!items.length) {
    findingsList.innerHTML = '<div class="empty-state">No findings yet.</div>';
    findingsSubhead.textContent = "No matches";
    return;
  }

  findingsSubhead.textContent = `${items.length} stored`;
  findingsList.innerHTML = items
    .map(
      (item) => `
        <article class="finding">
          <div class="finding-top">
            <div class="finding-badges">
              <div class="finding-keyword">${escapeHtml(item.keyword)}</div>
              <div class="finding-severity finding-severity-${escapeHtml(item.severity || "low")}">${escapeHtml(titleCase(item.severity || "low"))}</div>
              <div class="finding-confidence">${escapeHtml(titleCase(item.confidence || "low"))} confidence</div>
            </div>
            <button
              class="finding-jump"
              data-url="${encodeURIComponent(item.url)}"
              data-keyword="${encodeURIComponent(item.keyword)}"
              data-index="${item.matchIndex ?? 0}"
              data-length="${item.matchLength ?? item.keyword.length}"
              data-line="${item.line ?? 1}"
              data-column="${item.column ?? 1}"
            >
              Jump to match
            </button>
          </div>
          <div class="finding-url">${escapeHtml(item.url)}</div>
          <div class="finding-meta">${escapeHtml(titleCase(item.detectorKind || "keyword"))} · Line ${item.line ?? 1}, Column ${item.column ?? 1}</div>
          <div class="finding-rationale">${escapeHtml(item.rationale || "")}</div>
          <div class="finding-snippet">${escapeHtml(item.snippet)}</div>
        </article>
      `
    )
    .join("");
}

function renderReport(items) {
  if (!items.length) {
    reportList.innerHTML = '<div class="empty-state">No analyzed files yet.</div>';
    reportSubhead.textContent = "No files";
    return;
  }

  reportSubhead.textContent = `${items.length} analyzed`;
  reportList.innerHTML = items
    .map(
      (item) => `
        <article class="report-row">
          <div class="report-top">
            <div class="report-kind">${escapeHtml(item.kind)}</div>
            <div class="finding-meta">${item.findingsCount} matches</div>
          </div>
          <div class="report-url">${escapeHtml(item.url)}</div>
          <div class="report-meta">${escapeHtml(item.contentType)} · ${item.size} chars</div>
        </article>
      `
    )
    .join("");
}

function renderCookies(items) {
  if (!items.length) {
    cookiesList.innerHTML = '<div class="empty-state">No cookies for this domain.</div>';
    cookiesSubhead.textContent = "No cookies";
    return;
  }

  cookiesSubhead.textContent = `${items.length} active`;
  cookiesList.innerHTML = items
    .map(
      (item) => `
        <article class="cookie-row">
          <div class="cookie-top">
            <div class="cookie-name">${escapeHtml(item.name)}</div>
            <div class="finding-meta">${escapeHtml(item.sameSite)}</div>
          </div>
          <div class="cookie-value">${escapeHtml(item.value)}</div>
          <div class="cookie-meta">${escapeHtml(item.domain)}${escapeHtml(item.path)} · ${item.secure ? "secure" : "insecure"} · ${item.httpOnly ? "httpOnly" : "scriptable"}</div>
        </article>
      `
    )
    .join("");
}

function flattenStructure(tree, depth = 0) {
  const rows = [];
  const entries = Object.entries(tree).sort(([left], [right]) => left.localeCompare(right));

  for (const [name, children] of entries) {
    const hasChildren = Object.keys(children).length > 0;
    rows.push({
      depth,
      name,
      isLeaf: !hasChildren
    });

    if (hasChildren) {
      rows.push(...flattenStructure(children, depth + 1));
    }
  }

  return rows;
}

function renderStructure(tree) {
  const rows = flattenStructure(tree);

  if (!rows.length) {
    structureTree.innerHTML = '<div class="empty-state">No structure mapped yet.</div>';
    structureSubhead.textContent = "No paths";
    return;
  }

  structureSubhead.textContent = `${rows.length} nodes`;
  structureTree.innerHTML = rows
    .map(
      (row) => `
        <div class="tree-row">
          <span class="${row.isLeaf ? "tree-leaf" : "tree-name"}" style="padding-left: ${row.depth * 16}px">
            ${escapeHtml(row.name)}
          </span>
        </div>
      `
    )
    .join("");
}

function renderCustomSearchResults(items) {
  if (!currentSearchQuery) {
    customSearchResults.innerHTML = '<div class="empty-state">Run a search across analyzed resources.</div>';
    searchSubhead.textContent = "No query";
    return;
  }

  if (!items.length) {
    customSearchResults.innerHTML = '<div class="empty-state">No matches for this query.</div>';
    searchSubhead.textContent = `0 results`;
    return;
  }

  searchSubhead.textContent = `${items.length} results`;
  customSearchResults.innerHTML = items
    .map(
      (item) => `
        <article class="search-result-row">
          <div class="finding-top">
            <div class="search-kind">${escapeHtml(item.kind)}</div>
            <button
              class="finding-jump"
              data-url="${encodeURIComponent(item.url)}"
              data-keyword="${encodeURIComponent(item.match)}"
              data-index="${item.matchIndex ?? 0}"
              data-length="${item.matchLength ?? item.match.length}"
              data-line="${item.line ?? 1}"
              data-column="${item.column ?? 1}"
            >
              Jump to match
            </button>
          </div>
          <div class="search-result-url">${escapeHtml(item.url)}</div>
          <div class="finding-meta">Line ${item.line ?? 1}, Column ${item.column ?? 1}</div>
          <div class="search-result-snippet">${escapeHtml(item.snippet)}</div>
        </article>
      `
    )
    .join("");
}

function formatMaybeJson(value) {
  if (value == null || value === "") {
    return "None";
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  const text = String(value);
  const limitedText = text.length > MAX_DETAIL_TEXT_LENGTH
    ? `${text.slice(0, MAX_DETAIL_TEXT_LENGTH)}\n\n[truncated ${text.length - MAX_DETAIL_TEXT_LENGTH} chars]`
    : text;

  if (limitedText.length > MAX_JSON_PRETTY_LENGTH) {
    return limitedText;
  }

  try {
    return JSON.stringify(JSON.parse(limitedText), null, 2);
  } catch {
    return limitedText;
  }
}

function formatStatus(item) {
  if (item?.statusCode == null) {
    return "No status";
  }

  return item.statusText
    ? `${item.statusCode} ${item.statusText}`
    : String(item.statusCode);
}

function formatDuration(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "Unknown";
  }

  return `${Number(value).toFixed(2)} ms`;
}

function getRequestDetailCacheKey(item) {
  if (!item) {
    return "";
  }

  return [
    item.id,
    item.statusCode,
    item.statusText,
    item.durationMs,
    item.responseUrl,
    item.response?.length || 0,
    item.payload?.length || 0
  ].join("|");
}

function buildNetworkDetailHtml(item) {
  return `
    <section class="detail-section">
      <p class="detail-label">Summary</p>
      <pre class="detail-value">${escapeHtml(
        [
          `Status: ${formatStatus(item)}`,
          `Duration: ${formatDuration(item.durationMs)}`,
          `Initiator: ${item.initiatorUrl || "Unknown"}`,
          `Referrer: ${item.referrer || "None"}`,
          `Response URL: ${item.responseUrl || item.url}`
        ].join("\n")
      )}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">URL</p>
      <pre class="detail-value">${escapeHtml(item.url)}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">Request Headers</p>
      <pre class="detail-value">${escapeHtml(formatMaybeJson(item.requestHeaders))}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">Response Headers</p>
      <pre class="detail-value">${escapeHtml(formatMaybeJson(item.responseHeaders))}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">Payload</p>
      <pre class="detail-value">${escapeHtml(formatMaybeJson(item.payload))}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">Response</p>
      <pre class="detail-value">${escapeHtml(formatMaybeJson(item.response))}</pre>
    </section>
  `;
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function formatExportMarkdown(snapshot) {
  const lines = [];
  const exportedAt = snapshot.exportedAt || new Date().toISOString();
  const scope = snapshot.scope?.origin || "all scopes";

  lines.push("# JSnitch Export");
  lines.push("");
  lines.push(`- Exported At: ${exportedAt}`);
  lines.push(`- Scope: ${scope}`);
  lines.push(`- Monitoring: ${snapshot.monitoring ? "on" : "off"}`);
  lines.push(`- Findings: ${snapshot.findings.length}`);
  lines.push(`- Resources: ${snapshot.report.length}`);
  lines.push(`- Requests: ${snapshot.networkRequests.length}`);
  lines.push("");

  lines.push("## Findings");
  lines.push("");

  if (!snapshot.findings.length) {
    lines.push("_No findings._");
    lines.push("");
  } else {
    for (const item of snapshot.findings) {
      lines.push(`### ${item.keyword}`);
      lines.push(`- Severity: ${item.severity}`);
      lines.push(`- Confidence: ${item.confidence}`);
      lines.push(`- Kind: ${item.detectorKind}`);
      lines.push(`- URL: ${item.url}`);
      lines.push(`- Position: line ${item.line}, column ${item.column}`);
      lines.push(`- Rationale: ${item.rationale}`);
      lines.push(`- Snippet: \`${String(item.snippet || "").replace(/`/g, "\\`")}\``);
      lines.push("");
    }
  }

  lines.push("## Resources");
  lines.push("");

  if (!snapshot.report.length) {
    lines.push("_No analyzed resources._");
    lines.push("");
  } else {
    for (const resource of snapshot.report) {
      lines.push(`- ${resource.url} | ${resource.kind} | ${resource.contentType} | ${resource.findingsCount} matches`);
    }
    lines.push("");
  }

  lines.push("## Network Requests");
  lines.push("");

  if (!snapshot.networkRequests.length) {
    lines.push("_No captured requests._");
    lines.push("");
  } else {
    for (const request of snapshot.networkRequests) {
      lines.push(`- ${request.method} ${request.url} (${request.type})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function exportSnapshot(format) {
  const currentTab = await getCurrentTab();
  const snapshot = await sendMessage("EXPORT_STATE", {
    currentUrl: currentTab?.url || "",
    tabId: currentTab?.id ?? null,
    customQuery: currentSearchQuery
  });

  const baseName = `jsnitch-${slugify(snapshot.scope?.origin || currentTab?.url || "session")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (format === "json") {
    triggerDownload(`${baseName}.json`, JSON.stringify(snapshot, null, 2), "application/json");
    return;
  }

  triggerDownload(`${baseName}.md`, formatExportMarkdown(snapshot), "text/markdown");
}

function renderNetworkDetails(item, options = {}) {
  const { deferHeavyRender = false } = options;

  if (!item) {
    selectedRequestType.textContent = "None";
    networkDetailMeta.textContent = "Select a request";
    networkDetailBody.innerHTML = '<div class="empty-state">Choose a request and click Analyze.</div>';
    selectedDetailCacheKey = "";
    selectedDetailCacheHtml = "";
    selectedDetailSummary = "";
    return;
  }

  selectedRequestType.textContent = item.type.toUpperCase();
  networkDetailMeta.textContent = `${item.method} · ${item.type} · ${formatStatus(item)}`;
  const cacheKey = getRequestDetailCacheKey(item);
  const summaryText = [
    `Status: ${formatStatus(item)}`,
    `Duration: ${formatDuration(item.durationMs)}`,
    `Initiator: ${item.initiatorUrl || "Unknown"}`,
    `Referrer: ${item.referrer || "None"}`,
    `Response URL: ${item.responseUrl || item.url}`
  ].join("\n");

  if (selectedDetailCacheKey === cacheKey && selectedDetailCacheHtml) {
    networkDetailBody.innerHTML = selectedDetailCacheHtml;
    return;
  }

  if (!deferHeavyRender) {
    const html = buildNetworkDetailHtml(item);
    selectedDetailCacheKey = cacheKey;
    selectedDetailCacheHtml = html;
    selectedDetailSummary = summaryText;
    networkDetailBody.innerHTML = html;
    return;
  }

  selectedDetailSummary = summaryText;
  networkDetailBody.innerHTML = `
    <section class="detail-section">
      <p class="detail-label">Summary</p>
      <pre class="detail-value">${escapeHtml(summaryText)}</pre>
    </section>
    <div class="empty-state">Rendering request details...</div>
  `;

  const renderToken = selectedDetailRenderToken + 1;
  selectedDetailRenderToken = renderToken;

  window.setTimeout(() => {
    if (renderToken !== selectedDetailRenderToken || selectedNetworkRequestId !== item.id) {
      return;
    }

    const html = buildNetworkDetailHtml(item);
    selectedDetailCacheKey = cacheKey;
    selectedDetailCacheHtml = html;
    networkDetailBody.innerHTML = html;
  }, 0);
}

function renderNetworkRequests(items, options = {}) {
  const { skipDetailRender = false } = options;
  latestNetworkRequests = items;
  const filteredItems = currentMethodFilter === "ALL"
    ? items
    : items.filter((item) => item.method === currentMethodFilter);

  latestFilteredNetworkRequests = filteredItems;
  requestsCount.textContent = String(filteredItems.length);

  if (!filteredItems.length) {
    networkRequestsList.innerHTML = '<div class="empty-state">No intercepted requests yet.</div>';
    networkSubhead.textContent = currentMethodFilter === "ALL" ? "No requests" : `No ${currentMethodFilter} requests`;
    selectedNetworkRequestId = null;
    renderNetworkDetails(null);
    return;
  }

  networkSubhead.textContent = `${filteredItems.length} captured`;
  if (!filteredItems.some((item) => item.id === selectedNetworkRequestId)) {
    selectedNetworkRequestId = null;
  }

  networkRequestsList.innerHTML = filteredItems
    .map(
      (item) => `
        <article class="network-request-row ${item.id === selectedNetworkRequestId ? "is-selected" : ""}">
          <div class="network-request-top">
            <div class="request-method">${escapeHtml(item.method)}</div>
            <div class="request-type">${escapeHtml(item.type)}</div>
          </div>
          <div class="network-request-url">${escapeHtml(item.url)}</div>
          <div class="finding-meta">${escapeHtml(formatStatus(item))} · ${escapeHtml(formatDuration(item.durationMs))}</div>
          <button class="analyze-button" data-request-id="${escapeHtml(item.id)}">Analyze</button>
        </article>
      `
    )
    .join("");

  const selected = filteredItems.find((item) => item.id === selectedNetworkRequestId) || null;
  if (!skipDetailRender) {
    renderNetworkDetails(selected);
  }
}

function renderState(state) {
  monitoringStatus.textContent = state.monitoring ? "On" : "Off";
  monitoringPill.textContent = state.monitoring ? "Live" : "Idle";
  monitoringPill.className = `pill ${state.monitoring ? "pill-on" : "pill-off"}`;
  scannedCount.textContent = String(state.counts?.scanned ?? 0);
  pendingCount.textContent = String(state.counts?.pending ?? 0);
  findingsCount.textContent = String(state.counts?.findings ?? 0);
  startButton.disabled = state.monitoring;
  stopButton.disabled = !state.monitoring;
  renderFindings(state.findings || []);
  renderReport(state.report || []);
  renderCookies(state.cookies || []);
  renderStructure(state.structure || {});
  renderCustomSearchResults(state.customSearchResults || []);
  renderNetworkRequests(state.networkRequests || []);
}

async function refreshState() {
  try {
    const currentTab = await getCurrentTab();
    const state = await sendMessage("GET_STATE", {
      currentUrl: currentTab?.url || "",
      tabId: currentTab?.id ?? null,
      customQuery: currentSearchQuery
    });
    renderState(state);
  } catch (error) {
    console.error("JSnitch popup refresh failed:", error);
  }
}

async function startMonitoring() {
  await sendMessage("START_MONITORING");
  await refreshState();
}

async function stopMonitoring() {
  await sendMessage("STOP_MONITORING");
  await refreshState();
}

async function clearResults() {
  await sendMessage("CLEAR_RESULTS");
  await refreshState();
}

function openViewer(button) {
  const params = new URLSearchParams({
    url: decodeURIComponent(button.dataset.url || ""),
    keyword: decodeURIComponent(button.dataset.keyword || ""),
    index: button.dataset.index || "0",
    length: button.dataset.length || "0",
    line: button.dataset.line || "1",
    column: button.dataset.column || "1"
  });

  chrome.tabs.create({
    url: `${chrome.runtime.getURL("src/ui/viewer/viewer.html")}?${params.toString()}`
  });
}

function activateTab(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  }

  for (const panel of tabPanels) {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  }
}

function activateView(viewName) {
  for (const button of primaryTabButtons) {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  }

  for (const panel of viewPanels) {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === viewName);
  }
}

startButton.addEventListener("click", () => {
  void startMonitoring();
});

stopButton.addEventListener("click", () => {
  void stopMonitoring();
});

clearButton.addEventListener("click", () => {
  void clearResults();
});

exportJsonButton.addEventListener("click", () => {
  void exportSnapshot("json");
});

exportMarkdownButton.addEventListener("click", () => {
  void exportSnapshot("markdown");
});

findingsList.addEventListener("click", (event) => {
  const button = event.target.closest(".finding-jump");
  if (!button) {
    return;
  }

  openViewer(button);
});

customSearchResults.addEventListener("click", (event) => {
  const button = event.target.closest(".finding-jump");
  if (!button) {
    return;
  }

  openViewer(button);
});

networkRequestsList.addEventListener("click", (event) => {
  const button = event.target.closest(".analyze-button");
  if (!button) {
    return;
  }

  selectedNetworkRequestId = button.dataset.requestId || null;
  renderNetworkRequests(latestNetworkRequests, { skipDetailRender: true });
  const selected = latestFilteredNetworkRequests.find((item) => item.id === selectedNetworkRequestId) || null;
  renderNetworkDetails(selected, { deferHeavyRender: true });
});

customSearchButton.addEventListener("click", () => {
  currentSearchQuery = customSearchInput.value.trim();
  void refreshState();
});

customSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  currentSearchQuery = customSearchInput.value.trim();
  void refreshState();
});

methodFilter.addEventListener("change", () => {
  currentMethodFilter = methodFilter.value;
  renderNetworkRequests(latestNetworkRequests);
});

for (const button of primaryTabButtons) {
  button.addEventListener("click", () => {
    activateView(button.dataset.view);
  });
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tab);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void refreshState();
  pollTimer = window.setInterval(() => {
    void refreshState();
  }, 1000);
});

window.addEventListener("unload", () => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }
});
