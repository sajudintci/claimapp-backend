import { logger } from "@/infrastructure/logger/winston";
import { computeAggregateConfidence } from "@/modules/extraction/application/extraction-summary";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";
import { tracesFromField } from "@/modules/extraction/domain/field-trace";
import {
  claimPathToLabelKind,
  isInvalidExtractedValue,
  type FieldLabelKind,
} from "@/modules/extraction/domain/field-label-guard";
import { repairIcd10CodeField } from "@/modules/extraction/application/icd10-code-repair";

const NOT_FOUND: TracedField = {
  value: "not_found",
  source_text: "",
  page: null,
  confidence: 0,
};

const INVALID_VALUE_ONLY_PUNCT = /^[.,:;\-—\/\\\s]+$/;
const DATE_VALUE_RE = /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/;

export type ExtractionVerificationStats = {
  ocrVerified: boolean;
  fieldsChecked: number;
  fieldsRejected: number;
  fieldsRepairedFromOcr: number;
  rejectedPaths: string[];
  repairedPaths: string[];
};

export type VerifiedExtractionResult = {
  result: LlmExtractionResult;
  stats: ExtractionVerificationStats;
};

export function isValidMonetaryValue(value: string | number): boolean {
  const v = String(value).trim();
  if (!v || v === "not_found") return false;
  if (INVALID_VALUE_ONLY_PUNCT.test(v)) return false;
  return /\d/.test(v);
}

/** Rejects website URLs and values without a proper local@domain.tld shape. */
export function isValidEmailValue(value: string | number): boolean {
  const v = String(value).trim();
  if (!v || v === "not_found") return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (/^www\./i.test(v)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactDigits(text: string): string {
  return text.replace(/[^\d]/g, "");
}

function buildOcrCorpus(plainText: string): string {
  return normalizeForMatch(plainText);
}

function valueInOcr(
  value: string | number,
  sourceText: string,
  corpusNormalized: string,
  labelKind?: FieldLabelKind,
): boolean {
  if (value === "not_found" || value === "" || value == null) return true;

  const v = normalizeForMatch(String(value));
  const src = normalizeForMatch(sourceText);
  if (!v || INVALID_VALUE_ONLY_PUNCT.test(v)) return false;

  if (labelKind && isInvalidExtractedValue(value, sourceText, labelKind)) return false;

  if (src && (src.includes(v) || v.includes(src))) {
    if (isInvalidExtractedValue(value, sourceText, labelKind ?? "text")) return false;
    return true;
  }
  if (corpusNormalized.includes(v)) return true;

  if (src && corpusNormalized.includes(src)) return true;

  const words = v.split(" ").filter((w) => w.length >= 3);
  if (words.length > 0 && words.every((w) => corpusNormalized.includes(w))) return true;

  const vd = compactDigits(v);
  if (vd.length >= 2) {
    const corpusDigits = compactDigits(corpusNormalized);
    if (corpusDigits.includes(vd)) return true;
    if (src) {
      const sd = compactDigits(src);
      if (sd.includes(vd) || vd.includes(sd)) return true;
    }
  }

  if (DATE_VALUE_RE.test(v)) {
    const dateDigits = compactDigits(v);
    if (dateDigits.length >= 6 && compactDigits(corpusNormalized).includes(dateDigits)) {
      return true;
    }
  }

  return false;
}

function rejectField(field: TracedField): TracedField {
  return { ...NOT_FOUND };
}

function valueSupportedByField(
  value: string | number,
  field: Pick<TracedField, "source_text" | "page" | "traces">,
  corpus: string,
  labelKind?: FieldLabelKind,
): boolean {
  const traces = tracesFromField(field);
  if (traces.length === 0) return valueInOcr(value, field.source_text, corpus, labelKind);
  return traces.some((trace) => valueInOcr(value, trace.source_text, corpus, labelKind));
}

function verifyTracedField(
  field: TracedField,
  corpus: string,
  opts: {
    monetary?: boolean;
    requireDate?: boolean;
    requireEmail?: boolean;
    labelKind?: FieldLabelKind;
  },
): TracedField {
  if (field.value === "not_found") return field;

  const kind = opts.labelKind ?? "text";
  if (isInvalidExtractedValue(field.value, field.source_text, kind)) {
    return rejectField(field);
  }

  if (opts.monetary && !isValidMonetaryValue(field.value)) {
    return rejectField(field);
  }

  if (opts.requireEmail && !isValidEmailValue(field.value)) {
    return rejectField(field);
  }

  if (opts.requireDate && !DATE_VALUE_RE.test(String(field.value))) {
    return rejectField(field);
  }

  if (INVALID_VALUE_ONLY_PUNCT.test(String(field.value).trim())) {
    return rejectField(field);
  }

  if (!valueSupportedByField(field.value, field, corpus, kind)) {
    return rejectField(field);
  }

  return field;
}

function verifyLineItem(item: ExtractionLineItem, corpus: string): ExtractionLineItem {
  const description = item.description.trim();
  if (!description) return item;

  if (isInvalidExtractedValue(description, item.source_text, "text")) {
    return {
      ...item,
      description: "",
      amount: "",
      confidence: 0,
    };
  }

  if (!valueInOcr(description, item.source_text, corpus, "text")) {
    return {
      ...item,
      description: "",
      amount: "",
      confidence: 0,
    };
  }

  if (item.amount && !isValidMonetaryValue(item.amount)) {
    return { ...item, amount: "" };
  }

  if (item.amount && isInvalidExtractedValue(item.amount, item.source_text, "monetary")) {
    return { ...item, amount: "" };
  }

  if (item.amount && !valueInOcr(item.amount, item.source_text, corpus, "monetary")) {
    const digits = compactDigits(item.amount);
    if (digits.length < 2 || !compactDigits(corpus).includes(digits)) {
      return { ...item, amount: "" };
    }
  }

  return item;
}

function verifyTestResult(test: ExtractionTestResult, corpus: string): ExtractionTestResult {
  const anchor = test.source_text.trim() || `${test.test_name} ${test.result}`.trim();
  if (!anchor) return test;

  if (!valueInOcr(test.test_name || test.result, anchor, corpus)) {
    return {
      ...test,
      test_name: "",
      result: "",
      confidence: 0,
    };
  }

  return test;
}

function sumLineItemAmounts(items: ExtractionLineItem[]): string {
  let sum = 0;
  let any = false;
  for (const item of items) {
    if (!item.amount || !isValidMonetaryValue(item.amount)) continue;
    const digits = compactDigits(item.amount);
    if (digits.length < 1) continue;
    const n = Number.parseInt(digits, 10);
    if (!Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  return any ? String(sum) : "";
}

function verifyClaim(
  claim: ExtractionClaim,
  corpus: string,
  stats?: ExtractionVerificationStats,
  plainText?: string,
): ExtractionClaim {
  const track = (path: string, before: TracedField, after: TracedField) => {
    if (!stats) return;
    stats.fieldsChecked++;
    if (before.value !== "not_found" && after.value === "not_found") {
      stats.fieldsRejected++;
      stats.rejectedPaths.push(path);
    }
  };

  const applyPath = (path: string, field: TracedField, opts: Parameters<typeof verifyTracedField>[2] = {}) => {
    const labelKind = claimPathToLabelKind(path);
    const next = verifyTracedField(field, corpus, { ...opts, labelKind });
    track(path, field, next);
    return next;
  };

  const billing = {
    currency: applyPath("billing.currency", claim.billing.currency, {}),
    tax_amount: applyPath("billing.tax_amount", claim.billing.tax_amount, { monetary: true }),
    total_amount_read: applyPath("billing.total_amount_read", claim.billing.total_amount_read, {
      monetary: true,
    }),
    total_amount_calculated: applyPath(
      "billing.total_amount_calculated",
      claim.billing.total_amount_calculated,
      { monetary: true },
    ),
    payment_status: applyPath("billing.payment_status", claim.billing.payment_status, {}),
  };

  const items = claim.items
    .map((item) => verifyLineItem(item, corpus))
    .filter((item) => item.description.trim().length > 0);

  const calcSum = sumLineItemAmounts(items);
  if (calcSum && billing.total_amount_calculated.value === "not_found") {
    billing.total_amount_calculated = {
      value: calcSum,
      source_text: "sum(line items)",
      page: items[0]?.page ?? null,
      confidence: 0.75,
    };
  } else if (
    billing.total_amount_calculated.value !== "not_found" &&
    !isValidMonetaryValue(billing.total_amount_calculated.value)
  ) {
    billing.total_amount_calculated = rejectField(billing.total_amount_calculated);
  }

  return {
    provider: {
      hospital_name: applyPath("provider.hospital_name", claim.provider.hospital_name, {}),
      address: applyPath("provider.address", claim.provider.address, {}),
      city: applyPath("provider.city", claim.provider.city, {}),
      phone: applyPath("provider.phone", claim.provider.phone, {}),
      email: applyPath("provider.email", claim.provider.email, { requireEmail: true }),
    },
    billing,
    patient: {
      patient_id: applyPath("patient.patient_id", claim.patient.patient_id, {}),
      name: applyPath("patient.name", claim.patient.name),
      dob: applyPath("patient.dob", claim.patient.dob, { requireDate: true }),
    },
    encounter: {
      encounter_type: applyPath("encounter.encounter_type", claim.encounter.encounter_type, {}),
      admission_date: applyPath("encounter.admission_date", claim.encounter.admission_date, {
        requireDate: true,
      }),
      discharge_date: applyPath("encounter.discharge_date", claim.encounter.discharge_date, {
        requireDate: true,
      }),
    },
    medical_summary: applyPath("medical_summary", claim.medical_summary, {}),
    diagnosis: (() => {
      const icd10_description = applyPath(
        "diagnosis.icd10_description",
        claim.diagnosis.icd10_description,
        {},
      );
      let icd10_code = applyPath("diagnosis.icd10_code", claim.diagnosis.icd10_code, {});

      if (icd10_code.value === "not_found" && plainText) {
        const before = icd10_code;
        icd10_code = repairIcd10CodeField(icd10_code, {
          plainText,
          descriptionField: icd10_description,
        });
        if (before.value === "not_found" && icd10_code.value !== "not_found" && stats) {
          stats.fieldsRepairedFromOcr++;
          stats.repairedPaths.push("diagnosis.icd10_code");
        }
      }

      return { icd10_code, icd10_description };
    })(),
    items,
    tests: claim.tests.map((t) => verifyTestResult(t, corpus)),
  };
}

/** OCR-grounded verification: reject LLM values not supported by OCR text. */
export function verifyAndRepairExtraction(
  result: LlmExtractionResult,
  options: {
    filteredPlainText: string;
  },
): VerifiedExtractionResult {
  const corpus = buildOcrCorpus(options.filteredPlainText);
  const stats: ExtractionVerificationStats = {
    ocrVerified: true,
    fieldsChecked: 0,
    fieldsRejected: 0,
    fieldsRepairedFromOcr: 0,
    rejectedPaths: [],
    repairedPaths: [],
  };

  const claims = result.claims.map((claim) =>
    verifyClaim(claim, corpus, stats, options.filteredPlainText),
  );

  const confidence = computeAggregateConfidence(claims);

  if (stats.fieldsRejected > 0 || stats.fieldsRepairedFromOcr > 0) {
    logger.info("Extraction OCR verification applied", {
      fieldsChecked: stats.fieldsChecked,
      fieldsRejected: stats.fieldsRejected,
      fieldsRepairedFromOcr: stats.fieldsRepairedFromOcr,
      rejectedSample: stats.rejectedPaths.slice(0, 12),
      repairedSample: stats.repairedPaths.slice(0, 12),
    });
  }

  return {
    result: { claims, confidence },
    stats,
  };
}
