import {
  discoverOcrBlocksForValue,
  findOcrBlockForSnippet,
  type OcrBlockMatch,
} from "@/modules/extraction/application/resolve-ocr-block";
import type { OcrPagePayload } from "@/modules/extraction/application/ocr-preprocess";
import {
  attachTracesToField,
  mergeTraceLists,
  tracesFromField,
} from "@/modules/extraction/domain/field-trace";
import type {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  FieldTrace,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const LINE_ITEM_FIELDS = ["description", "quantity", "amount", "related_doctor"] as const;
const TEST_FIELDS = ["test_category", "test_name", "result", "unit", "reference_range"] as const;

type LineItemFieldKey = (typeof LINE_ITEM_FIELDS)[number];
type TestFieldKey = (typeof TEST_FIELDS)[number];

function toFieldTrace(match: OcrBlockMatch): FieldTrace {
  return {
    source_text: match.text,
    page: match.page,
    ...(match.region ? { region: match.region } : {}),
  };
}

function sourceTextsAlign(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function isMonetaryQuery(query: string): boolean {
  return /^\d[\d.,\s]*$/.test(query.replace(/\s/g, ""));
}

function mergeDiscoveredMatches(...groups: OcrBlockMatch[][]): OcrBlockMatch[] {
  const seen = new Set<string>();
  const out: OcrBlockMatch[] = [];

  for (const group of groups) {
    for (const match of group) {
      const region = match.region;
      const regionPart = region
        ? `${region.l},${region.t},${region.r},${region.b}`
        : "na";
      const key = `${match.page}::${regionPart}::${match.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(match);
    }
  }

  return out.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.region?.t ?? 0) - (b.region?.t ?? 0);
  });
}

function mergeTracesWithOcrRegions(
  existing: FieldTrace[],
  discovered: OcrBlockMatch[],
): FieldTrace[] {
  const pool = [...existing];

  for (const match of discovered) {
    const resolved = toFieldTrace(match);
    const regionTarget = pool.findIndex(
      (trace) =>
        trace.page === resolved.page &&
        !trace.region &&
        resolved.region != null &&
        sourceTextsAlign(trace.source_text, resolved.source_text),
    );
    if (regionTarget >= 0) {
      pool[regionTarget] = { ...pool[regionTarget]!, region: resolved.region };
      continue;
    }
    pool.push(resolved);
  }

  return mergeTraceLists(pool);
}

function discoverMatchesForQueries(
  pages: OcrPagePayload[],
  queries: string[],
  options?: { preferRightmost?: boolean; rowAnchor?: OcrBlockMatch["region"] },
): OcrBlockMatch[] {
  const groups: OcrBlockMatch[][] = [];
  for (const query of queries) {
    if (query.length < 2) continue;
    groups.push(
      discoverOcrBlocksForValue(pages, query, {
        preferRightmost: options?.preferRightmost ?? isMonetaryQuery(query),
        rowAnchor: options?.rowAnchor,
      }),
    );
  }
  return mergeDiscoveredMatches(...groups);
}

function attachRegionToTracedField(
  field: TracedField,
  pages: OcrPagePayload[],
): TracedField {
  if (field.value === "not_found") return field;

  const queries = [field.source_text.trim(), String(field.value).trim()].filter(
    (q) => q.length >= 2,
  );
  const uniqueQueries = [...new Set(queries)];
  const existing = tracesFromField(field);
  const discovered = discoverMatchesForQueries(pages, uniqueQueries);
  const traces = mergeTracesWithOcrRegions(existing, discovered);
  if (traces.length === 0) return field;

  const primary = traces[0]!;
  return attachTracesToField({
    ...field,
    source_text: field.source_text.trim() || primary.source_text,
    page: field.page ?? primary.page,
    traces,
  });
}

function resolveLineItemFieldTraces(
  value: string,
  pages: OcrPagePayload[],
  options?: { preferRightmost?: boolean; rowAnchor?: OcrBlockMatch["region"] },
): FieldTrace[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return discoverMatchesForQueries(pages, [trimmed], options).map(toFieldTrace);
}

function enrichLineItemFieldTraces(
  item: ExtractionLineItem,
  pages: OcrPagePayload[],
): ExtractionLineItem {
  const field_traces: Partial<Record<LineItemFieldKey, FieldTrace[]>> = {};
  const pageHint = item.page;

  const amountTraces = resolveLineItemFieldTraces(item.amount, pages, {
    preferRightmost: true,
  });
  if (amountTraces.length > 0) field_traces.amount = amountTraces;

  const primaryAmountMatch =
    amountTraces.length > 0
      ? findOcrBlockForSnippet(pages, item.amount, {
          pageHint: amountTraces[0]!.page ?? pageHint,
          preferRightmost: true,
        })
      : null;

  const qtyTraces = resolveLineItemFieldTraces(item.quantity, pages, {
    preferRightmost: true,
    rowAnchor: primaryAmountMatch?.region,
  });
  if (qtyTraces.length > 0) field_traces.quantity = qtyTraces;

  const rowAnchor = primaryAmountMatch?.region;

  const descTraces = resolveLineItemFieldTraces(item.description, pages, { rowAnchor });
  if (descTraces.length > 0) field_traces.description = descTraces;

  const doctorTraces = resolveLineItemFieldTraces(item.related_doctor, pages, { rowAnchor });
  if (doctorTraces.length > 0) field_traces.related_doctor = doctorTraces;

  if (Object.keys(field_traces).length === 0) return item;
  return { ...item, field_traces };
}

function enrichTestFieldTraces(
  test: ExtractionTestResult,
  pages: OcrPagePayload[],
): ExtractionTestResult {
  const field_traces: Partial<Record<TestFieldKey, FieldTrace[]>> = {};

  for (const key of TEST_FIELDS) {
    const traces = resolveLineItemFieldTraces(test[key], pages);
    if (traces.length > 0) field_traces[key] = traces;
  }

  if (Object.keys(field_traces).length === 0) return test;
  return { ...test, field_traces };
}

function enrichClaim(claim: ExtractionClaim, pages: OcrPagePayload[]): ExtractionClaim {
  return {
    provider: {
      hospital_name: attachRegionToTracedField(claim.provider.hospital_name, pages),
      address: attachRegionToTracedField(claim.provider.address, pages),
      city: attachRegionToTracedField(claim.provider.city, pages),
      phone: attachRegionToTracedField(claim.provider.phone, pages),
      email: attachRegionToTracedField(claim.provider.email, pages),
    },
    billing: {
      currency: attachRegionToTracedField(claim.billing.currency, pages),
      tax_amount: attachRegionToTracedField(claim.billing.tax_amount, pages),
      total_amount_read: attachRegionToTracedField(claim.billing.total_amount_read, pages),
      total_amount_calculated: attachRegionToTracedField(
        claim.billing.total_amount_calculated,
        pages,
      ),
      payment_status: attachRegionToTracedField(claim.billing.payment_status, pages),
    },
    patient: {
      patient_id: attachRegionToTracedField(claim.patient.patient_id, pages),
      name: attachRegionToTracedField(claim.patient.name, pages),
      dob: attachRegionToTracedField(claim.patient.dob, pages),
    },
    encounter: {
      encounter_type: attachRegionToTracedField(claim.encounter.encounter_type, pages),
      admission_date: attachRegionToTracedField(claim.encounter.admission_date, pages),
      discharge_date: attachRegionToTracedField(claim.encounter.discharge_date, pages),
    },
    medical_summary: attachRegionToTracedField(claim.medical_summary, pages),
    diagnosis: {
      icd10_code: attachRegionToTracedField(claim.diagnosis.icd10_code, pages),
      icd10_description: attachRegionToTracedField(claim.diagnosis.icd10_description, pages),
    },
    items: claim.items.map((item) => enrichLineItemFieldTraces(item, pages)),
    tests: claim.tests.map((test) => enrichTestFieldTraces(test, pages)),
  };
}

export function attachOcrBlockRegions(
  result: LlmExtractionResult,
  pages: OcrPagePayload[],
): LlmExtractionResult {
  if (pages.length === 0) return result;
  return {
    ...result,
    claims: result.claims.map((claim) => enrichClaim(claim, pages)),
  };
}
