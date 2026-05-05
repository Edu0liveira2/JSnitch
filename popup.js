const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const clearButton = document.getElementById("clearButton");
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
const networkRequestsList = document.getElementById("networkRequestsList");
const networkSubhead = document.getElementById("networkSubhead");
const networkDetailMeta = document.getElementById("networkDetailMeta");
const networkDetailBody = document.getElementById("networkDetailBody");
const primaryTabButtons = Array.from(document.querySelectorAll(".primary-tab-button"));
const viewPanels = Array.from(document.querySelectorAll(".view-panel"));
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

let pollTimer = null;
let latestNetworkRequests = [];
let selectedNetworkRequestId = null;

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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
            <div class="finding-keyword">${escapeHtml(item.keyword)}</div>
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
          <div class="finding-meta">Line ${item.line ?? 1}, Column ${item.column ?? 1}</div>
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

function formatMaybeJson(value) {
  if (value == null || value === "") {
    return "None";
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  const text = String(value);

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function renderNetworkDetails(item) {
  if (!item) {
    selectedRequestType.textContent = "None";
    networkDetailMeta.textContent = "Select a request";
    networkDetailBody.innerHTML = '<div class="empty-state">Choose a request and click Analyze.</div>';
    return;
  }

  selectedRequestType.textContent = item.type.toUpperCase();
  networkDetailMeta.textContent = `${item.method} · ${item.type}`;
  networkDetailBody.innerHTML = `
    <section class="detail-section">
      <p class="detail-label">URL</p>
      <pre class="detail-value">${escapeHtml(item.url)}</pre>
    </section>
    <section class="detail-section">
      <p class="detail-label">Headers</p>
      <pre class="detail-value">${escapeHtml(formatMaybeJson(item.headers))}</pre>
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

function renderNetworkRequests(items) {
  latestNetworkRequests = items;
  requestsCount.textContent = String(items.length);

  if (!items.length) {
    networkRequestsList.innerHTML = '<div class="empty-state">No intercepted requests yet.</div>';
    networkSubhead.textContent = "No requests";
    selectedNetworkRequestId = null;
    renderNetworkDetails(null);
    return;
  }

  networkSubhead.textContent = `${items.length} captured`;
  if (!items.some((item) => item.id === selectedNetworkRequestId)) {
    selectedNetworkRequestId = null;
  }

  networkRequestsList.innerHTML = items
    .map(
      (item) => `
        <article class="network-request-row ${item.id === selectedNetworkRequestId ? "is-selected" : ""}">
          <div class="network-request-top">
            <div class="request-method">${escapeHtml(item.method)}</div>
            <div class="request-type">${escapeHtml(item.type)}</div>
          </div>
          <div class="network-request-url">${escapeHtml(item.url)}</div>
          <button class="analyze-button" data-request-id="${escapeHtml(item.id)}">Analyze</button>
        </article>
      `
    )
    .join("");

  const selected = items.find((item) => item.id === selectedNetworkRequestId) || null;
  renderNetworkDetails(selected);
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
  renderNetworkRequests(state.networkRequests || []);
}

async function refreshState() {
  try {
    const currentTab = await getCurrentTab();
    const state = await sendMessage("GET_STATE", {
      currentUrl: currentTab?.url || "",
      tabId: currentTab?.id ?? null
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
    url: `${chrome.runtime.getURL("viewer.html")}?${params.toString()}`
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

findingsList.addEventListener("click", (event) => {
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
