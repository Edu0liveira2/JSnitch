import { KEYWORDS } from "./keywords.js";

const SNIPPET_RADIUS = 80;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet(content, index, length) {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(content.length, index + length + SNIPPET_RADIUS);

  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function getLineColumn(content, index) {
  let line = 1;
  let column = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export function scanContent(url, content) {
  const findings = [];

  for (const keyword of KEYWORDS) {
    const pattern = new RegExp(escapeRegExp(keyword), "gi");
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const position = getLineColumn(content, match.index);

      findings.push({
        id: `${url}:${keyword}:${match.index}`,
        url,
        keyword,
        snippet: buildSnippet(content, match.index, match[0].length),
        matchIndex: match.index,
        matchLength: match[0].length,
        line: position.line,
        column: position.column
      });
    }
  }

  return findings;
}
