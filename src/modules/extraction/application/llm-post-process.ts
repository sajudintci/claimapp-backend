import fs from "fs";
import path from "path";
import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { CircuitBreakerOpenError } from "@/infrastructure/resilience/circuit-breaker-open.error";
import { openaiCircuitBreaker } from "@/infrastructure/resilience/circuit-breakers";
import { BulkheadRejectedError } from "@/infrastructure/resilience/bulkhead-rejected.error";
import { openaiBulkhead } from "@/infrastructure/resilience/bulkheads";
import {
  buildSummaryFromClaims,
  computeAggregateConfidence,
} from "@/modules/extraction/application/extraction-summary";
import {
  buildParseAttempts,
  LlmParseFailureReason,
  LlmParseResult,
} from "@/modules/extraction/application/llm-json-parse";
import {
  enrichClaimsWithClinicalSynthesis,
} from "@/modules/extraction/application/clinical-field-synthesis";
import { updateExtractionJobProgress } from "@/modules/extraction/application/extraction-job-progress";
import {
  verifyAndRepairExtraction,
  type ExtractionVerificationStats,
  isValidMonetaryValue,
} from "@/modules/extraction/application/extraction-verify";
import {
  OcrPageLinesPayload,
  PreExtractedFields,
} from "@/modules/extraction/application/ocr-preprocess";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const OCR_PLACEHOLDER = "{{RAW_OCR_TEXT}}";
const DEFAULT_OCR_MAX_CHARS = 24000;

export type LlmPostProcessStatus = "skipped" | "ok" | "failed";

export type LlmPostProcessOutcome = {
  status: LlmPostProcessStatus;
  result: LlmExtractionResult | null;
  error: string | null;
  attempts: number;
  verification?: ExtractionVerificationStats;
};

let cachedSystemPrompt: string | null = null;

function resolvePromptPath(): string {
  const candidates = [
    path.join(__dirname, "../prompts/healthcare-claim-extraction.txt"),
    path.join(process.cwd(), "src/modules/extraction/prompts/healthcare-claim-extraction.txt"),
    path.join(process.cwd(), "../prompt"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("Healthcare extraction prompt file not found");
  }
  return found;
}

function loadSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  cachedSystemPrompt = fs.readFileSync(resolvePromptPath(), "utf8").trim();
  return cachedSystemPrompt;
}

function loadInstructionPrompt(): string {
  const full = loadSystemPrompt();
  if (!full.includes(OCR_PLACEHOLDER)) return full;
  return full.replace(OCR_PLACEHOLDER, "").replace(/\n{3,}/g, "\n\n").trim();
}

function coerceClaimsRoot(input: unknown): Record<string, unknown> | null {
  if (!isObject(input)) return null;
  if (Array.isArray(input.claims)) return input;
  if (input.provider || input.patient || input.billing || input.items) {
    return { claims: [input] };
  }
  return input;
}

const MAX_SOURCE_TEXT_CHARS = 400;

function formatParseFailure(reason: LlmParseFailureReason, detail?: string): string {
  switch (reason) {
    case "empty_claims":
      return "LLM returned empty claims array (no structured data extracted from OCR)";
    case "missing_claims_key":
      return 'LLM JSON missing required root key "claims"';
    case "normalize_failed":
      return "LLM JSON could not be normalized into the expected claim schema";
    case "invalid_json":
    default:
      return detail
        ? `LLM returned invalid JSON: ${detail}`
        : "LLM returned invalid or truncated JSON";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTracedField(input: unknown, monetary = false): TracedField {
  if (!isObject(input)) {
    return { value: "not_found", source_text: "", page: null, confidence: 0 };
  }
  const confidenceRaw = Number(input.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0;
  let value: string | number =
    input.value == null || input.value === ""
      ? "not_found"
      : (input.value as string | number);

  if (monetary && value !== "not_found" && !isValidMonetaryValue(value)) {
    value = "not_found";
  }

  const valueOriginRaw = input.value_origin;
  const value_origin =
    valueOriginRaw === "llm_synthesis" || valueOriginRaw === "ocr" ? valueOriginRaw : undefined;
  const derived_from = Array.isArray(input.derived_from)
    ? input.derived_from.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    value,
    source_text:
      typeof input.source_text === "string"
        ? input.source_text.slice(0, MAX_SOURCE_TEXT_CHARS)
        : "",
    page: typeof input.page === "number" ? input.page : null,
    confidence: value === "not_found" ? 0 : confidence,
    ...(value_origin ? { value_origin } : {}),
    ...(derived_from && derived_from.length > 0 ? { derived_from } : {}),
  };
}

function normalizeLineItem(input: unknown): ExtractionLineItem | null {
  if (!isObject(input)) return null;
  const confidenceRaw = Number(input.confidence);
  let amount = String(input.amount ?? "");
  if (amount && !isValidMonetaryValue(amount)) amount = "";
  return {
    description: String(input.description ?? ""),
    quantity: String(input.quantity ?? ""),
    amount,
    related_doctor: String(input.related_doctor ?? ""),
    source_text:
      typeof input.source_text === "string"
        ? input.source_text.slice(0, MAX_SOURCE_TEXT_CHARS)
        : "",
    page: typeof input.page === "number" ? input.page : null,
    confidence: Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0,
  };
}

function normalizeTestResult(input: unknown): ExtractionTestResult | null {
  if (!isObject(input)) return null;
  const confidenceRaw = Number(input.confidence);
  return {
    test_category: String(input.test_category ?? ""),
    test_name: String(input.test_name ?? ""),
    result: String(input.result ?? ""),
    unit: String(input.unit ?? ""),
    reference_range: String(input.reference_range ?? ""),
    source_text:
      typeof input.source_text === "string"
        ? input.source_text.slice(0, MAX_SOURCE_TEXT_CHARS)
        : "",
    page: typeof input.page === "number" ? input.page : null,
    confidence: Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0,
  };
}

function normalizeClaim(input: unknown): ExtractionClaim | null {
  if (!isObject(input)) return null;
  const provider = isObject(input.provider) ? input.provider : {};
  const billing = isObject(input.billing) ? input.billing : {};
  const patient = isObject(input.patient) ? input.patient : {};
  const encounter = isObject(input.encounter) ? input.encounter : {};
  const diagnosis = isObject(input.diagnosis) ? input.diagnosis : {};

  return {
    provider: {
      hospital_name: normalizeTracedField(provider.hospital_name),
      address: normalizeTracedField(provider.address),
      city: normalizeTracedField(provider.city),
      phone: normalizeTracedField(provider.phone),
      email: normalizeTracedField(provider.email),
    },
    billing: {
      currency: normalizeTracedField(billing.currency),
      tax_amount: normalizeTracedField(billing.tax_amount, true),
      total_amount_read: normalizeTracedField(billing.total_amount_read, true),
      total_amount_calculated: normalizeTracedField(billing.total_amount_calculated, true),
      payment_status: normalizeTracedField(billing.payment_status),
    },
    patient: {
      patient_id: normalizeTracedField(patient.patient_id),
      name: normalizeTracedField(patient.name),
      dob: normalizeTracedField(patient.dob),
    },
    encounter: {
      encounter_type: normalizeTracedField(encounter.encounter_type),
      admission_date: normalizeTracedField(encounter.admission_date),
      discharge_date: normalizeTracedField(encounter.discharge_date),
    },
    medical_summary: normalizeTracedField(input.medical_summary),
    diagnosis: {
      icd10_code: normalizeTracedField(diagnosis.icd10_code),
      icd10_description: normalizeTracedField(diagnosis.icd10_description),
    },
    items: Array.isArray(input.items)
      ? input.items
          .map(normalizeLineItem)
          .filter((item): item is ExtractionLineItem => item !== null)
      : [],
    tests: Array.isArray(input.tests)
      ? input.tests
          .map(normalizeTestResult)
          .filter((item): item is ExtractionTestResult => item !== null)
      : [],
  };
}

function normalizeLlmResult(input: unknown): LlmExtractionResult | null {
  const root = coerceClaimsRoot(input);
  if (!root) return null;
  const claims = Array.isArray(root.claims)
    ? root.claims
        .map((claim: unknown) => normalizeClaim(claim))
        .filter((claim): claim is ExtractionClaim => claim !== null)
    : [];
  if (claims.length === 0) return null;

  const confidence =
    computeAggregateConfidence(claims) ||
    (Number.isFinite(Number(root.confidence))
      ? Math.max(0, Math.min(1, Number(root.confidence)))
      : 0);

  return { claims, confidence };
}

function parseLlmContent(raw: string): LlmParseResult {
  let lastParseError: string | undefined;

  for (const candidate of buildParseAttempts(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const root = coerceClaimsRoot(parsed);
      if (!root) {
        return { ok: false, reason: "missing_claims_key" };
      }
      if (!Array.isArray(root.claims)) {
        return { ok: false, reason: "missing_claims_key" };
      }
      if (root.claims.length === 0) {
        return { ok: false, reason: "empty_claims" };
      }

      const normalized = normalizeLlmResult(root);
      if (normalized) {
        return { ok: true, data: normalized };
      }
      return { ok: false, reason: "normalize_failed" };
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : "JSON parse error";
    }
  }

  return { ok: false, reason: "invalid_json", detail: lastParseError };
}

function isLlmEnabled(): boolean {
  return (
    env.ENABLE_LLM_POST_PROCESS.toLowerCase() === "true" && Boolean(env.OPENAI_API_KEY)
  );
}

function shouldRetryLlm(status: number | null, err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  if (status == null) return true;
  if (status === 429 || status >= 500) return true;
  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callLlmOnce(params: {
  instructionPrompt: string;
  ocrText: string;
  ocrCharCount: number;
  compactOutput?: boolean;
  insistExtract?: boolean;
}): Promise<{
  ok: boolean;
  result: LlmExtractionResult | null;
  error: string;
  httpStatus: number | null;
  retryable: boolean;
  finishReason?: string;
  parseReason?: LlmParseFailureReason;
}> {
  const compactNote = params.compactOutput
    ? "\nIMPORTANT: Previous response was truncated. Use shorter source_text (max 200 chars) and omit empty tests arrays."
    : "";

  const insistNote = params.insistExtract
    ? [
        "CRITICAL: OCR text is non-empty. You MUST return at least one object in the claims array.",
        "Populate fields with extracted values when present; use not_found when a field is missing.",
        'Return {"claims":[]} ONLY if OCR text is completely blank or has zero healthcare/billing content.',
      ].join("\n")
    : "";

  const systemContent = [
    params.instructionPrompt,
    "",
    "Output requirements:",
    '- Root object MUST be {"claims":[...]}.',
    "- When OCR mentions hospital, patient, invoice, billing, diagnosis, or lab results, include at least one claim.",
    "- Return strict JSON only. No markdown.",
    `- Each source_text max ${MAX_SOURCE_TEXT_CHARS} characters (truncate long OCR snippets).`,
    "- Do not wrap the JSON in code fences.",
    compactNote,
    insistNote,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    openaiCircuitBreaker.guard();
    const response = await openaiBulkhead.run(() =>
      fetchWithTimeout(
        `${env.OPENAI_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL,
            temperature: 0,
            max_tokens: env.LLM_MAX_OUTPUT_TOKENS,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemContent },
              { role: "user", content: `Raw OCR text:\n${params.ocrText}` },
            ],
          }),
        },
        env.LLM_REQUEST_TIMEOUT_MS,
      ),
    );

    if (!response.ok) {
      const errText = await response.text();
      const retryable = shouldRetryLlm(response.status, null);
      if (retryable) {
        openaiCircuitBreaker.recordFailure();
      }
      return {
        ok: false,
        result: null,
        error: `LLM HTTP ${response.status}: ${errText.slice(0, 500)}`,
        httpStatus: response.status,
        retryable,
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string };
      }>;
    };
    const choice = data.choices?.[0];
    const finishReason = choice?.finish_reason;
    const content = choice?.message?.content?.trim();
    if (!content) {
      return {
        ok: false,
        result: null,
        error: "LLM returned empty content",
        httpStatus: response.status,
        retryable: true,
        finishReason,
      };
    }

    const parsed = parseLlmContent(content);
    if (!parsed.ok) {
      const truncated = finishReason === "length";
      const error = truncated
        ? `LLM output truncated (finish_reason=length). ${formatParseFailure(parsed.reason, parsed.detail)}. Increase LLM_MAX_OUTPUT_TOKENS or use a shorter document.`
        : formatParseFailure(parsed.reason, parsed.detail);

      const ocrHasContent = params.ocrCharCount >= env.OCR_MIN_TEXT_CHARS;
      const retryable =
        truncated ||
        parsed.reason === "invalid_json" ||
        (parsed.reason === "empty_claims" && ocrHasContent);

      logger.warn("LLM response parse failed", {
        finishReason,
        contentLength: content.length,
        contentPreview: content.slice(0, 400),
        parseReason: parsed.reason,
        parseDetail: parsed.detail,
        ocrCharCount: params.ocrCharCount,
        retryable,
      });

      return {
        ok: false,
        result: null,
        error:
          parsed.reason === "empty_claims" && ocrHasContent
            ? `${error} OCR had ${params.ocrCharCount} characters — model should not return an empty claims array.`
            : error,
        httpStatus: response.status,
        retryable,
        finishReason,
        parseReason: parsed.reason,
      };
    }

    openaiCircuitBreaker.recordSuccess();
    return {
      ok: true,
      result: {
        claims: parsed.data.claims,
        confidence:
          parsed.data.confidence || computeAggregateConfidence(parsed.data.claims),
      },
      error: "",
      httpStatus: response.status,
      retryable: false,
      finishReason,
    };
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      return {
        ok: false,
        result: null,
        error: err.message,
        httpStatus: null,
        retryable: false,
      };
    }

    if (err instanceof BulkheadRejectedError) {
      return {
        ok: false,
        result: null,
        error: err.message,
        httpStatus: null,
        retryable: true,
      };
    }

    if (shouldRetryLlm(null, err)) {
      openaiCircuitBreaker.recordFailure();
    }

    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `LLM request timed out after ${env.LLM_REQUEST_TIMEOUT_MS}ms`
          : err.message
        : "Unknown LLM request error";
    return {
      ok: false,
      result: null,
      error: message,
      httpStatus: null,
      retryable: shouldRetryLlm(null, err),
    };
  }
}

export type {
  LlmExtractionResult,
  ExtractionClaim,
  ExtractionSummary,
} from "@/modules/extraction/domain/extraction-schema";

export function isLlmPostProcessEnabled(): boolean {
  return isLlmEnabled();
}

export type LlmPostProcessOptions = {
  preExtracted?: PreExtractedFields;
  filteredPlainText?: string;
  ocrPageLines?: OcrPageLinesPayload[];
  extractionJobId?: string;
};

export async function postProcessExtractionWithLlm(
  rawText: string,
  options?: LlmPostProcessOptions,
): Promise<LlmPostProcessOutcome> {
  if (!isLlmEnabled()) {
    return { status: "skipped", result: null, error: null, attempts: 0 };
  }

  const ocrCharCount = rawText.replace(/\s+/g, "").length;
  if (ocrCharCount < env.OCR_MIN_TEXT_CHARS) {
    return {
      status: "failed",
      result: null,
      error: `OCR text too short (${ocrCharCount} chars). Use a clearer scan or enable PDF OCR fallback.`,
      attempts: 0,
    };
  }

  const ocrMaxChars = env.LLM_OCR_MAX_CHARS ?? DEFAULT_OCR_MAX_CHARS;
  const ocrSnippet = rawText.slice(0, ocrMaxChars);
  const instructionPrompt = loadInstructionPrompt();

  const maxAttempts = Math.max(1, env.LLM_MAX_RETRIES + 1);
  let lastError = "LLM post-process failed";
  let useCompactOutput = false;
  let insistExtract = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await callLlmOnce({
      instructionPrompt,
      ocrText: ocrSnippet,
      ocrCharCount,
      compactOutput: useCompactOutput,
      insistExtract,
    });
    if (outcome.ok && outcome.result) {
      if (options?.extractionJobId) {
        await updateExtractionJobProgress(options.extractionJobId, "validate");
      }

      const verified = verifyAndRepairExtraction(outcome.result, {
        filteredPlainText: options?.filteredPlainText ?? rawText,
        ocrPageLines: options?.ocrPageLines,
        preExtracted: options?.preExtracted,
      });
      const enriched = await enrichClaimsWithClinicalSynthesis(verified.result);
      if (enriched.stats.fieldsSynthesized > 0) {
        logger.info("Clinical field synthesis applied", enriched.stats);
      }
      return {
        status: "ok",
        result: enriched.result,
        verification: verified.stats,
        error: null,
        attempts: attempt,
      };
    }

    lastError = outcome.error;
    if (outcome.finishReason === "length") {
      useCompactOutput = true;
    }
    if (outcome.parseReason === "empty_claims") {
      insistExtract = true;
    }

    logger.warn("LLM post-process attempt failed", {
      attempt,
      maxAttempts,
      error: outcome.error,
      httpStatus: outcome.httpStatus,
      finishReason: outcome.finishReason,
      parseReason: outcome.parseReason,
      retryable: outcome.retryable,
      compactOutput: useCompactOutput,
      insistExtract,
      ocrCharCount,
    });

    if (!outcome.retryable || attempt >= maxAttempts) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }

  return { status: "failed", result: null, error: lastError, attempts: maxAttempts };
}

export function buildExtractionSummaryFromLlm(llmResult: LlmExtractionResult | null) {
  if (!llmResult || llmResult.claims.length === 0) return null;
  return buildSummaryFromClaims(llmResult.claims);
}
