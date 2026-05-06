import {
  DETECTORS,
  assessDetectorMatch,
  getDetectorPattern,
  scoreConfidence,
  scoreSeverity
} from "./keywords.js";

const SNIPPET_RADIUS = 80;

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

  for (const detector of DETECTORS) {
    const pattern = getDetectorPattern(detector);
    if (!pattern) {
      continue;
    }

    let match;

    while ((match = pattern.exec(content)) !== null) {
      const position = getLineColumn(content, match.index);
      const assessment = assessDetectorMatch(detector, content, match.index, match[0]);
      const severityScore = scoreSeverity(assessment.severity);
      const confidenceScore = scoreConfidence(assessment.confidence);

      findings.push({
        id: `${url}:${detector.id}:${match.index}`,
        url,
        keyword: detector.label,
        detectorId: detector.id,
        detectorKind: detector.kind,
        matchedText: match[0],
        severity: assessment.severity,
        severityScore,
        confidence: assessment.confidence,
        confidenceScore,
        score: severityScore * 10 + confidenceScore,
        rationale: assessment.rationale,
        snippet: buildSnippet(content, match.index, match[0].length),
        matchIndex: match.index,
        matchLength: match[0].length,
        line: position.line,
        column: position.column
      });
    }
  }

  return suppressRedundantKeywordFindings(findings);
}

function suppressRedundantKeywordFindings(findings) {
  return findings.filter((finding) => {
    if (finding.detectorKind !== "keyword") {
      return true;
    }

    return !findings.some((candidate) => {
      if (candidate === finding || candidate.detectorKind === "keyword") {
        return false;
      }

      const candidateStart = candidate.matchIndex;
      const candidateEnd = candidate.matchIndex + candidate.matchLength;
      const findingStart = finding.matchIndex;
      const findingEnd = finding.matchIndex + finding.matchLength;

      const overlaps = findingStart < candidateEnd && findingEnd > candidateStart;
      const nearCandidate = Math.abs(findingStart - candidateStart) <= 24;

      return overlaps || nearCandidate;
    });
  });
}
