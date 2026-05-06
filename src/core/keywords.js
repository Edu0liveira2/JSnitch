const SEVERITY_SCORES = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const CONFIDENCE_SCORES = {
  low: 1,
  medium: 2,
  high: 3
};

const KEYWORD_TERMS = [
  "api",
  "key",
  "token",
  "auth",
  "bearer",
  "secret",
  "password"
];

export const DETECTORS = [
  {
    id: "jwt",
    label: "JWT",
    kind: "signature",
    severity: "high",
    confidence: "high",
    rationale: "Matched a JSON Web Token-like three-part token."
  },
  {
    id: "bearer-token",
    label: "Bearer Token",
    kind: "signature",
    severity: "high",
    confidence: "high",
    rationale: "Matched a bearer authorization token."
  },
  {
    id: "aws-access-key",
    label: "AWS Access Key",
    kind: "signature",
    severity: "critical",
    confidence: "high",
    rationale: "Matched an AWS-style access key ID."
  },
  {
    id: "stripe-secret-key",
    label: "Stripe Secret Key",
    kind: "signature",
    severity: "critical",
    confidence: "high",
    rationale: "Matched a Stripe secret key."
  },
  {
    id: "stripe-publishable-key",
    label: "Stripe Publishable Key",
    kind: "signature",
    severity: "medium",
    confidence: "high",
    rationale: "Matched a Stripe publishable key."
  },
  {
    id: "google-api-key",
    label: "Google API Key",
    kind: "signature",
    severity: "high",
    confidence: "high",
    rationale: "Matched a Google API key."
  },
  {
    id: "slack-token",
    label: "Slack Token",
    kind: "signature",
    severity: "critical",
    confidence: "high",
    rationale: "Matched a Slack token format."
  },
  {
    id: "github-token",
    label: "GitHub Token",
    kind: "signature",
    severity: "critical",
    confidence: "high",
    rationale: "Matched a GitHub token format."
  },
  {
    id: "firebase-api-key",
    label: "Firebase API Key",
    kind: "signature",
    severity: "high",
    confidence: "high",
    rationale: "Matched a Firebase config API key."
  },
  {
    id: "password-assignment",
    label: "Password Assignment",
    kind: "assignment",
    severity: "high",
    confidence: "medium",
    rationale: "Matched a password-like assignment."
  },
  {
    id: "secret-assignment",
    label: "Secret Assignment",
    kind: "assignment",
    severity: "medium",
    confidence: "medium",
    rationale: "Matched a quoted token/secret assignment."
  },
  ...KEYWORD_TERMS.map((term) => ({
    id: `keyword-${term}`,
    label: term,
    kind: "keyword",
    severity: "low",
    confidence: "low",
    rationale: "Matched a generic keyword."
  }))
];

export function getDetectorPattern(detector) {
  switch (detector.id) {
    case "jwt":
      return /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
    case "bearer-token":
      return /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi;
    case "aws-access-key":
      return /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
    case "stripe-secret-key":
      return /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/g;
    case "stripe-publishable-key":
      return /\bpk_(?:live|test)_[0-9A-Za-z]{16,}\b/g;
    case "google-api-key":
      return /\bAIza[0-9A-Za-z_-]{35}\b/g;
    case "slack-token":
      return /\bxox(?:a|b|p|r|s)-[0-9A-Za-z-]{10,}\b/g;
    case "github-token":
      return /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/g;
    case "firebase-api-key":
      return /\bapiKey\s*:\s*["'`]AIza[0-9A-Za-z_-]{35}["'`]/g;
    case "password-assignment":
      return /\b(?:password|passwd|pwd)\b\s*[:=]\s*["'`][^"'`\r\n]{6,}["'`]/gi;
    case "secret-assignment":
      return /\b(?:api[_-]?key|token|secret|client[_-]?secret|access[_-]?token|authorization)\b\s*[:=]\s*["'`][^"'`\r\n]{8,}["'`]/gi;
    default:
      if (detector.kind === "keyword") {
        return new RegExp(`\\b${escapeRegExp(detector.label)}\\b`, "gi");
      }

      return null;
  }
}

export function scoreSeverity(level) {
  return SEVERITY_SCORES[level] || 0;
}

export function scoreConfidence(level) {
  return CONFIDENCE_SCORES[level] || 0;
}

export function assessDetectorMatch(detector, content, matchIndex, matchText) {
  if (detector.kind !== "keyword") {
    return {
      severity: detector.severity,
      confidence: detector.confidence,
      rationale: detector.rationale
    };
  }

  const context = getContextWindow(content, matchIndex, matchText.length);
  const loweredContext = context.toLowerCase();

  const hasAssignment = /[:=]\s*["'`]?[\w./+-]{4,}/.test(context);
  const hasSecretContext = /(secret|token|bearer|authorization|password|passwd|apikey|api[_-]?key|client[_-]?secret)/i.test(context);
  const hasRuntimeNoise = /(import|export|class|function|const|let|var|return|type)/i.test(context);

  let severity = "low";
  let confidence = "low";
  let rationale = "Matched a generic keyword.";

  if (hasAssignment && hasSecretContext) {
    severity = "medium";
    confidence = "high";
    rationale = "Generic keyword matched near an assignment with credential-like context.";
  } else if (hasSecretContext) {
    severity = "medium";
    confidence = "medium";
    rationale = "Generic keyword matched near credential-like context.";
  } else if (hasAssignment) {
    severity = "low";
    confidence = "medium";
    rationale = "Generic keyword matched near an assignment.";
  } else if (hasRuntimeNoise && !loweredContext.includes("bearer")) {
    rationale = "Generic keyword matched in likely code context.";
  }

  return { severity, confidence, rationale };
}

function getContextWindow(content, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(content.length, matchIndex + matchLength + 48);
  return content.slice(start, end);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
