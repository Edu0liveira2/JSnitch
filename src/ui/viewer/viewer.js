const params = new URLSearchParams(window.location.search);
const resourceUrl = params.get("url") || "";
const keyword = params.get("keyword") || "";
const matchIndex = Number(params.get("index") || 0);
const matchLength = Math.max(Number(params.get("length") || 0), keyword.length || 1);
const matchLine = Math.max(Number(params.get("line") || 1), 1);
const matchColumn = Math.max(Number(params.get("column") || 1), 1);

const resourceTitle = document.getElementById("resourceTitle");
const resourceKeyword = document.getElementById("resourceKeyword");
const resourcePosition = document.getElementById("resourcePosition");
const openSourceLink = document.getElementById("openSourceLink");
const sourceStatus = document.getElementById("sourceStatus");
const sourceContainer = document.getElementById("sourceContainer");
const sourceCode = document.getElementById("sourceCode");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildLineStartOffsets(content) {
  const offsets = [0];

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function renderSource(content) {
  const safeContent = content.replace(/\r\n/g, "\n");
  const lineOffsets = buildLineStartOffsets(safeContent);
  const lines = safeContent.split("\n");
  const activeLineIndex = Math.min(matchLine - 1, Math.max(lines.length - 1, 0));

  sourceCode.innerHTML = lines
    .map((line, index) => {
      const lineStart = lineOffsets[index] ?? 0;
      const lineEnd = lineStart + line.length;
      const intersectsMatch = matchIndex <= lineEnd && matchIndex + matchLength >= lineStart;
      let renderedLine = escapeHtml(line);

      if (intersectsMatch) {
        const startInLine = Math.max(0, matchIndex - lineStart);
        const endInLine = Math.min(line.length, matchIndex + matchLength - lineStart);
        const before = escapeHtml(line.slice(0, startInLine));
        const match = escapeHtml(line.slice(startInLine, endInLine) || line.slice(startInLine, startInLine + 1));
        const after = escapeHtml(line.slice(endInLine));
        renderedLine = `${before}<mark class="match">${match}</mark>${after}`;
      }

      return `
        <div class="source-line ${index === activeLineIndex ? "is-target" : ""}" data-line="${index + 1}">
          <span class="line-number">${index + 1}</span>
          <span class="line-text">${renderedLine || " "}</span>
        </div>
      `;
    })
    .join("");

  sourceStatus.hidden = true;
  sourceContainer.hidden = false;

  const targetLine = sourceCode.querySelector(`[data-line="${activeLineIndex + 1}"]`);
  if (targetLine) {
    targetLine.scrollIntoView({ block: "center" });
  }
}

async function loadSource() {
  resourceTitle.textContent = resourceUrl || "Unavailable resource";
  resourceKeyword.textContent = keyword || "match";
  resourcePosition.textContent = `line ${matchLine}, col ${matchColumn}`;
  openSourceLink.href = resourceUrl || "#";

  if (!resourceUrl) {
    sourceStatus.textContent = "Missing resource URL.";
    return;
  }

  try {
    const response = await fetch(resourceUrl, {
      method: "GET",
      credentials: "omit",
      cache: "force-cache",
      redirect: "follow"
    });

    if (!response.ok) {
      sourceStatus.textContent = `Unable to fetch source: ${response.status}`;
      return;
    }

    const content = await response.text();
    renderSource(content);
  } catch (error) {
    sourceStatus.textContent = "Unable to fetch this resource. It may be blocked by CORS or unavailable.";
    console.error("JSnitch viewer fetch failed:", error);
  }
}

void loadSource();
