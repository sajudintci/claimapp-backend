import { LlmExtractionResult } from "@/modules/extraction/domain/extraction-schema";

export type LlmParseFailureReason =
  | "invalid_json"
  | "empty_claims"
  | "missing_claims_key"
  | "normalize_failed";

export type LlmParseResult =
  | { ok: true; data: LlmExtractionResult }
  | { ok: false; reason: LlmParseFailureReason; detail?: string };

export function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced =
    trimmed.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ??
    trimmed.match(/```\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const start = candidate.indexOf("{");
  if (start === -1) return candidate;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }

  return candidate.slice(start);
}

/** Close truncated JSON objects/arrays (common when output hits max_tokens). */
export function repairTruncatedJson(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  if (s.endsWith(",")) s = s.slice(0, -1);

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i += 1) {
    const char = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("{");
    if (char === "[") stack.push("[");
    if (char === "}" && stack[stack.length - 1] === "{") stack.pop();
    if (char === "]" && stack[stack.length - 1] === "[") stack.pop();
  }

  if (inString) s += '"';

  while (stack.length > 0) {
    const open = stack.pop();
    s += open === "[" ? "]" : "}";
  }

  return s;
}

export function buildParseAttempts(raw: string): string[] {
  const extracted = extractJsonCandidate(raw);
  const repaired = repairTruncatedJson(extracted);
  const attempts = [extracted, repaired];
  if (repaired !== extracted) {
    attempts.push(raw.trim());
  }
  return [...new Set(attempts.filter(Boolean))];
}
