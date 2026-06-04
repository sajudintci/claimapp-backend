import {
  ExtractionClaim,
  ExtractionSummary,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

export function tracedFieldValue(field: unknown): string | null {
  if (!field || typeof field !== "object") return null;
  const raw = (field as TracedField).value;
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || text === "not_found") return null;
  return text;
}

export function parseAmountFromText(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const amount = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function collectTracedFields(node: unknown, out: TracedField[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTracedFields(item, out));
    return;
  }
  const record = node as Record<string, unknown>;
  if (
    "value" in record &&
    "source_text" in record &&
    "confidence" in record &&
    typeof record.value !== "object"
  ) {
    const confidence = Number(record.confidence);
    out.push({
      value: record.value as string | number,
      source_text: typeof record.source_text === "string" ? record.source_text : "",
      page: typeof record.page === "number" ? record.page : null,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    });
    return;
  }
  Object.values(record).forEach((value) => collectTracedFields(value, out));
}

export function computeAggregateConfidence(claims: ExtractionClaim[]): number {
  const traced: TracedField[] = [];
  claims.forEach((claim) => collectTracedFields(claim, traced));
  if (traced.length === 0) return 0;
  const total = traced.reduce((sum, field) => sum + field.confidence, 0);
  return Math.max(0, Math.min(1, total / traced.length));
}

export function buildSummaryFromClaims(claims: ExtractionClaim[]): ExtractionSummary {
  const primary = claims[0];
  if (!primary) {
    return { insuredName: null, amount: null, diagnosis: null, provider: null };
  }

  const diagnosis =
    tracedFieldValue(primary.diagnosis.icd10_description) ??
    tracedFieldValue(primary.diagnosis.icd10_code);

  return {
    insuredName: tracedFieldValue(primary.patient.name),
    provider: tracedFieldValue(primary.provider.hospital_name),
    diagnosis,
    amount:
      parseAmountFromText(tracedFieldValue(primary.billing.total_amount_read)) ??
      parseAmountFromText(tracedFieldValue(primary.billing.total_amount_calculated)),
  };
}

export function buildSummaryFromLlmResult(result: LlmExtractionResult): ExtractionSummary {
  return buildSummaryFromClaims(result.claims);
}
