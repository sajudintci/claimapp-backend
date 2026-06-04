import { logger } from "@/infrastructure/logger/winston";
import { computeAggregateConfidence } from "@/modules/extraction/application/extraction-summary";
import {
  type OcrPageLinesPayload,
  type PreExtractedFields,
} from "@/modules/extraction/application/ocr-preprocess";
import type { OcrPairPayload } from "@/modules/extraction/application/ocr-layout";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const NOT_FOUND: TracedField = {
  value: "not_found",
  source_text: "",
  page: null,
  confidence: 0,
};

const INVALID_VALUE_ONLY_PUNCT = /^[.,:;\-—\/\\\s]+$/;
const DATE_VALUE_RE = /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/;

const TOTAL_LABEL =
  /^(nominal|jumlah|total|grand\s*total|total\s*bayar|jumlah\s*tagihan|amount\s*due|total\s*due)$/i;
const NAME_LABEL = /^(nama|name|patient|pasien|nama\s*pasien|nama\s*tertanggung)$/i;
const DOB_LABEL = /^(dob|tanggal\s*lahir|tgl\.?\s*lahir|date\s*of\s*birth)$/i;
const ADMISSION_LABEL = /^(admission|tgl\.?\s*masuk|tanggal\s*masuk|tgl\s*rawat\s*in)$/i;
const DISCHARGE_LABEL = /^(discharge|tgl\.?\s*keluar|tanggal\s*keluar|tgl\s*pulang)$/i;

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

function buildOcrCorpus(plainText: string, pages?: OcrPageLinesPayload[]): string {
  const parts = [plainText];
  if (pages) {
    for (const page of pages) {
      for (const line of page.lines) parts.push(line.text);
      for (const row of page.rows) parts.push(row.text);
      for (const pair of page.pairs) parts.push(pair.text, pair.value, pair.label);
      for (const table of page.tables) {
        for (const tr of table.rows) {
          for (const cell of tr.cells) parts.push(cell.text);
        }
      }
    }
  }
  return normalizeForMatch(parts.filter(Boolean).join("\n"));
}

function valueInOcr(
  value: string | number,
  sourceText: string,
  corpusNormalized: string,
): boolean {
  if (value === "not_found" || value === "" || value == null) return true;

  const v = normalizeForMatch(String(value));
  const src = normalizeForMatch(sourceText);
  if (!v || INVALID_VALUE_ONLY_PUNCT.test(v)) return false;

  if (src && (src.includes(v) || v.includes(src))) return true;
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

function verifyTracedField(
  field: TracedField,
  corpus: string,
  opts: { monetary?: boolean; requireDate?: boolean },
): TracedField {
  if (field.value === "not_found") return field;

  if (opts.monetary && !isValidMonetaryValue(field.value)) {
    return rejectField(field);
  }

  if (opts.requireDate && !DATE_VALUE_RE.test(String(field.value))) {
    return rejectField(field);
  }

  if (INVALID_VALUE_ONLY_PUNCT.test(String(field.value).trim())) {
    return rejectField(field);
  }

  if (!valueInOcr(field.value, field.source_text, corpus)) {
    return rejectField(field);
  }

  return field;
}

function pairToField(pair: OcrPairPayload, page: number): TracedField {
  return {
    value: pair.value.trim(),
    source_text: pair.text,
    page,
    confidence: Math.max(0, Math.min(1, pair.confidence)),
  };
}

function collectAllPairs(pages?: OcrPageLinesPayload[]): Array<{ page: number; pair: OcrPairPayload }> {
  const out: Array<{ page: number; pair: OcrPairPayload }> = [];
  for (const page of pages ?? []) {
    for (const pair of page.pairs) out.push({ page: page.page, pair });
  }
  return out;
}

function preExtractedToClaimFields(
  pre: PreExtractedFields,
): Partial<Record<string, TracedField>> {
  return {
    "billing.total_amount_read": pre.totalAmount,
    "patient.name": pre.patientName,
    "patient.dob": pre.dob,
    "encounter.admission_date": pre.admissionDate,
    "encounter.discharge_date": pre.dischargeDate,
  };
}

function applyOcrGroundedField(
  current: TracedField,
  ocrField: TracedField,
  corpus: string,
): { field: TracedField; repaired: boolean } {
  if (ocrField.value === "not_found") return { field: current, repaired: false };
  if (!valueInOcr(ocrField.value, ocrField.source_text, corpus)) {
    return { field: current, repaired: false };
  }

  const currentOk =
    current.value !== "not_found" &&
    !INVALID_VALUE_ONLY_PUNCT.test(String(current.value)) &&
    valueInOcr(current.value, current.source_text, corpus);

  if (currentOk) return { field: current, repaired: false };

  return { field: { ...ocrField }, repaired: true };
}

function verifyLineItem(item: ExtractionLineItem, corpus: string): ExtractionLineItem {
  const description = item.description.trim();
  if (!description) return item;

  if (!valueInOcr(description, item.source_text, corpus)) {
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

  if (item.amount && !valueInOcr(item.amount, item.source_text, corpus)) {
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
  preExtracted?: PreExtractedFields,
  pages?: OcrPageLinesPayload[],
  stats?: ExtractionVerificationStats,
): ExtractionClaim {
  const pairs = collectAllPairs(pages);

  const pairTotal = pairs
    .map(({ page, pair }) => ({ page, pair }))
    .find(({ pair }) => TOTAL_LABEL.test(pair.label) || TOTAL_LABEL.test(pair.key));
  const pairName = pairs.find(({ pair }) => NAME_LABEL.test(pair.label) || NAME_LABEL.test(pair.key));
  const pairDob = pairs.find(({ pair }) => DOB_LABEL.test(pair.label) || DOB_LABEL.test(pair.key));
  const pairAdmission = pairs.find(
    ({ pair }) => ADMISSION_LABEL.test(pair.label) || ADMISSION_LABEL.test(pair.key),
  );
  const pairDischarge = pairs.find(
    ({ pair }) => DISCHARGE_LABEL.test(pair.label) || DISCHARGE_LABEL.test(pair.key),
  );

  const ocrCandidates: Record<string, TracedField | undefined> = {};

  if (preExtracted) {
    Object.assign(ocrCandidates, preExtractedToClaimFields(preExtracted));
  }
  if (pairTotal) {
    ocrCandidates["billing.total_amount_read"] = pairToField(pairTotal.pair, pairTotal.page);
  }
  if (pairName) {
    ocrCandidates["patient.name"] = pairToField(pairName.pair, pairName.page);
  }
  if (pairDob) {
    ocrCandidates["patient.dob"] = pairToField(pairDob.pair, pairDob.page);
  }
  if (pairAdmission) {
    ocrCandidates["encounter.admission_date"] = pairToField(pairAdmission.pair, pairAdmission.page);
  }
  if (pairDischarge) {
    ocrCandidates["encounter.discharge_date"] = pairToField(pairDischarge.pair, pairDischarge.page);
  }

  const track = (path: string, before: TracedField, after: TracedField) => {
    if (!stats) return;
    stats.fieldsChecked++;
    if (before.value !== "not_found" && after.value === "not_found") {
      stats.fieldsRejected++;
      stats.rejectedPaths.push(path);
    }
  };

  const applyPath = (path: string, field: TracedField, opts: Parameters<typeof verifyTracedField>[2]) => {
    let next = verifyTracedField(field, corpus, opts);
    const ocr = ocrCandidates[path];
    if (ocr) {
      const grounded = applyOcrGroundedField(next, ocr, corpus);
      next = grounded.field;
      if (grounded.repaired && stats) {
        stats.fieldsRepairedFromOcr++;
        stats.repairedPaths.push(path);
      }
    }
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
      email: applyPath("provider.email", claim.provider.email, {}),
    },
    billing,
    patient: {
      patient_id: applyPath("patient.patient_id", claim.patient.patient_id, {}),
      name: applyPath("patient.name", claim.patient.name, {}),
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
    diagnosis: {
      icd10_code: applyPath("diagnosis.icd10_code", claim.diagnosis.icd10_code, {}),
      icd10_description: applyPath(
        "diagnosis.icd10_description",
        claim.diagnosis.icd10_description,
        {},
      ),
    },
    items,
    tests: claim.tests.map((t) => verifyTestResult(t, corpus)),
  };
}

/** OCR-grounded verification: reject LLM values not supported by OCR; repair from pre-extracted/pairs. */
export function verifyAndRepairExtraction(
  result: LlmExtractionResult,
  options: {
    filteredPlainText: string;
    ocrPageLines?: OcrPageLinesPayload[];
    preExtracted?: PreExtractedFields;
  },
): VerifiedExtractionResult {
  const corpus = buildOcrCorpus(options.filteredPlainText, options.ocrPageLines);
  const stats: ExtractionVerificationStats = {
    ocrVerified: true,
    fieldsChecked: 0,
    fieldsRejected: 0,
    fieldsRepairedFromOcr: 0,
    rejectedPaths: [],
    repairedPaths: [],
  };

  const claims = result.claims.map((claim) =>
    verifyClaim(claim, corpus, options.preExtracted, options.ocrPageLines, stats),
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
