import {
  attachTracesToField,
  MAX_FIELD_TRACES,
  mergeTraceLists,
  traceDedupeKey,
  tracesFromField,
} from "@/modules/extraction/domain/field-trace";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  FieldTrace,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const MIN_ENRICH_VALUE_CHARS = 4;
const MAX_SNIPPET_CHARS = 400;

export type OcrPageSlice = {
  page: number;
  text: string;
};

export function splitFilteredPlainTextByPage(plainText: string): OcrPageSlice[] {
  const trimmed = plainText.trim();
  if (!trimmed) return [];

  const markerRe = /---\s*Page\s+(\d+)\s*---/g;
  const matches = [...trimmed.matchAll(markerRe)];
  if (matches.length === 0) {
    return [{ page: 1, text: trimmed }];
  }

  const slices: OcrPageSlice[] = [];
  const first = matches[0]!;
  if (first.index! > 0) {
    const leading = trimmed.slice(0, first.index!).trim();
    if (leading) slices.push({ page: 1, text: leading });
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const page = Number(match[1]);
    const contentStart = match.index! + match[0].length;
    const contentEnd = i + 1 < matches.length ? matches[i + 1]!.index! : trimmed.length;
    const text = trimmed.slice(contentStart, contentEnd).trim();
    if (Number.isFinite(page) && page > 0) {
      slices.push({ page, text });
    }
  }

  return slices;
}

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEnrichableValue(value: string | number): boolean {
  const text = String(value).trim();
  if (!text || text === "not_found") return false;
  if (text.length < MIN_ENRICH_VALUE_CHARS) return false;
  if (/^[.,:;\-—/\\s]+$/.test(text)) return false;
  return true;
}

export function extractSnippetForValue(pageText: string, value: string | number): string {
  const rawValue = String(value).trim();
  const valueNorm = normalizeForSearch(rawValue);
  if (!valueNorm) return rawValue.slice(0, MAX_SNIPPET_CHARS);

  const lines = pageText.split("\n");
  for (const line of lines) {
    if (normalizeForSearch(line).includes(valueNorm)) {
      return line.trim().slice(0, MAX_SNIPPET_CHARS);
    }
  }

  const pageNorm = normalizeForSearch(pageText);
  const idx = pageNorm.indexOf(valueNorm);
  if (idx >= 0) {
    const ratio = pageText.length / Math.max(pageNorm.length, 1);
    const approxStart = Math.max(0, Math.floor(idx * ratio) - 24);
    const approxEnd = Math.min(pageText.length, approxStart + rawValue.length + 80);
    return pageText.slice(approxStart, approxEnd).replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
  }

  return rawValue.slice(0, MAX_SNIPPET_CHARS);
}

function discoverValueTracesInPage(
  pageText: string,
  page: number,
  value: string | number,
): FieldTrace[] {
  const valueNorm = normalizeForSearch(String(value));
  const traces: FieldTrace[] = [];

  for (const line of pageText.split("\n")) {
    if (!normalizeForSearch(line).includes(valueNorm)) continue;
    traces.push({
      page,
      source_text: line.trim().slice(0, MAX_SNIPPET_CHARS),
    });
  }

  return traces;
}

export function discoverValueTracesInPages(
  value: string | number,
  pages: OcrPageSlice[],
): FieldTrace[] {
  if (!isEnrichableValue(value)) return [];

  const valueNorm = normalizeForSearch(String(value));
  const traces: FieldTrace[] = [];

  for (const slice of pages) {
    if (!normalizeForSearch(slice.text).includes(valueNorm)) continue;
    for (const trace of discoverValueTracesInPage(slice.text, slice.page, value)) {
      traces.push(trace);
      if (traces.length >= MAX_FIELD_TRACES) return traces;
    }
  }

  return traces;
}

function tracesChanged(existing: FieldTrace[], merged: FieldTrace[]): boolean {
  if (merged.length !== existing.length) return true;
  const existingKeys = new Set(existing.map(traceDedupeKey));
  return merged.some((trace) => !existingKeys.has(traceDedupeKey(trace)));
}

function mergeFieldTraces(field: TracedField, discovered: FieldTrace[]): TracedField {
  if (discovered.length === 0) return field;

  const existing = tracesFromField(field);
  const merged = mergeTraceLists(existing, discovered);
  if (merged.length === 0 || !tracesChanged(existing, merged)) return field;

  const primary = merged[0]!;
  return attachTracesToField({
    ...field,
    source_text: field.source_text.trim() ? field.source_text : primary.source_text,
    page: field.page ?? primary.page,
    traces: merged,
  });
}

function enrichTracedField(field: TracedField, pages: OcrPageSlice[]): TracedField {
  if (field.value === "not_found") return field;
  const discovered = discoverValueTracesInPages(field.value, pages);
  return mergeFieldTraces(field, discovered);
}

function enrichLineItem(item: ExtractionLineItem, pages: OcrPageSlice[]): ExtractionLineItem {
  const anchor = item.description.trim() || item.source_text.trim();
  if (!anchor) return item;

  const discovered = discoverValueTracesInPages(anchor, pages);
  if (discovered.length === 0) return item;

  const existing = tracesFromField({
    source_text: item.source_text,
    page: item.page,
    traces: item.traces,
  });
  const merged = mergeTraceLists(existing, discovered);
  if (merged.length === 0 || !tracesChanged(existing, merged)) return item;

  const primary = merged[0]!;
  return {
    ...item,
    source_text: item.source_text.trim() ? item.source_text : primary.source_text,
    page: item.page ?? primary.page,
    traces: merged,
  };
}

function enrichTestResult(test: ExtractionTestResult, pages: OcrPageSlice[]): ExtractionTestResult {
  const anchor = test.test_name.trim() || test.source_text.trim();
  if (!anchor) return test;

  const discovered = discoverValueTracesInPages(anchor, pages);
  if (discovered.length === 0) return test;

  const existing = tracesFromField({
    source_text: test.source_text,
    page: test.page,
    traces: test.traces,
  });
  const merged = mergeTraceLists(existing, discovered);
  if (merged.length === 0 || !tracesChanged(existing, merged)) return test;

  const primary = merged[0]!;
  return {
    ...test,
    source_text: test.source_text.trim() ? test.source_text : primary.source_text,
    page: test.page ?? primary.page,
    traces: merged,
  };
}

function enrichClaim(claim: ExtractionClaim, pages: OcrPageSlice[]): ExtractionClaim {
  return {
    provider: {
      hospital_name: enrichTracedField(claim.provider.hospital_name, pages),
      address: enrichTracedField(claim.provider.address, pages),
      city: enrichTracedField(claim.provider.city, pages),
      phone: enrichTracedField(claim.provider.phone, pages),
      email: enrichTracedField(claim.provider.email, pages),
    },
    billing: {
      currency: enrichTracedField(claim.billing.currency, pages),
      tax_amount: enrichTracedField(claim.billing.tax_amount, pages),
      total_amount_read: enrichTracedField(claim.billing.total_amount_read, pages),
      total_amount_calculated: enrichTracedField(claim.billing.total_amount_calculated, pages),
      payment_status: enrichTracedField(claim.billing.payment_status, pages),
    },
    patient: {
      patient_id: enrichTracedField(claim.patient.patient_id, pages),
      name: enrichTracedField(claim.patient.name, pages),
      dob: enrichTracedField(claim.patient.dob, pages),
    },
    encounter: {
      encounter_type: enrichTracedField(claim.encounter.encounter_type, pages),
      admission_date: enrichTracedField(claim.encounter.admission_date, pages),
      discharge_date: enrichTracedField(claim.encounter.discharge_date, pages),
    },
    medical_summary: enrichTracedField(claim.medical_summary, pages),
    diagnosis: {
      icd10_code: enrichTracedField(claim.diagnosis.icd10_code, pages),
      icd10_description: enrichTracedField(claim.diagnosis.icd10_description, pages),
    },
    items: claim.items.map((item) => enrichLineItem(item, pages)),
    tests: claim.tests.map((test) => enrichTestResult(test, pages)),
  };
}

export function enrichExtractionResultTraces(
  result: LlmExtractionResult,
  filteredPlainText: string,
): LlmExtractionResult {
  const pages = splitFilteredPlainTextByPage(filteredPlainText);
  if (pages.length === 0) return result;

  return {
    ...result,
    claims: result.claims.map((claim) => enrichClaim(claim, pages)),
  };
}
