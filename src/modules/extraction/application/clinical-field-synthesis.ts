import fs from "fs";
import path from "path";
import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { isValidMonetaryValue } from "@/modules/extraction/application/extraction-verify";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  FieldValueOrigin,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const SYNTHESIS_PLACEHOLDER = "{{STRUCTURED_CLAIM_JSON}}";
const MAX_SYNTHESIS_CONFIDENCE = 0.7;

export const SYNTHESIZABLE_TRACED_PATHS = [
  "provider.hospital_name",
  "provider.address",
  "provider.city",
  "provider.phone",
  "provider.email",
  "billing.currency",
  "billing.tax_amount",
  "billing.total_amount_read",
  "billing.total_amount_calculated",
  "billing.payment_status",
  "patient.patient_id",
  "patient.name",
  "patient.dob",
  "encounter.encounter_type",
  "encounter.admission_date",
  "encounter.discharge_date",
  "medical_summary",
  "diagnosis.icd10_code",
  "diagnosis.icd10_description",
] as const;

export type SynthesizableTracedPath = (typeof SYNTHESIZABLE_TRACED_PATHS)[number];

export type ClinicalSynthesisField = {
  value: string;
  derived_from: string[];
  confidence: number;
};

export type ItemFieldSynthesis = {
  index: number;
  fields: Record<string, ClinicalSynthesisField>;
};

export type TestFieldSynthesis = {
  index: number;
  fields: Record<string, ClinicalSynthesisField>;
};

/** Flat traced paths + optional array entry patches. */
export type ClinicalSynthesisPayload = {
  traced: Partial<Record<SynthesizableTracedPath, ClinicalSynthesisField>>;
  items: ItemFieldSynthesis[];
  tests: TestFieldSynthesis[];
};

export type ClinicalSynthesisStats = {
  claimsProcessed: number;
  fieldsSynthesized: number;
  llmUsed: boolean;
};

const ITEM_SYNTH_FIELDS = ["description", "quantity", "amount", "related_doctor"] as const;
const TEST_SYNTH_FIELDS = [
  "test_category",
  "test_name",
  "result",
  "unit",
  "reference_range",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasUsableScalar(raw: string | undefined): boolean {
  const text = String(raw ?? "").trim();
  return text.length > 0 && text !== "not_found";
}

function hasUsableValue(field: TracedField | undefined): boolean {
  if (!field) return false;
  return hasUsableScalar(String(field.value ?? ""));
}

function tracedFieldValue(field: TracedField | undefined): string {
  if (!field) return "";
  const text = String(field.value ?? "").trim();
  return text === "not_found" ? "" : text;
}

function withOcrOrigin(field: TracedField): TracedField {
  if (!hasUsableValue(field)) return field;
  if (field.value_origin === "llm_synthesis") return field;
  return { ...field, value_origin: "ocr" as FieldValueOrigin };
}

function annotateClaimOcrOrigins(claim: ExtractionClaim): ExtractionClaim {
  const mapSection = <T extends Record<string, TracedField>>(section: T): T => {
    const next = { ...section };
    for (const key of Object.keys(next) as Array<keyof T>) {
      next[key] = withOcrOrigin(next[key]) as T[keyof T];
    }
    return next;
  };

  return {
    ...claim,
    provider: mapSection(claim.provider),
    billing: mapSection(claim.billing),
    patient: mapSection(claim.patient),
    encounter: mapSection(claim.encounter),
    diagnosis: mapSection(claim.diagnosis),
    medical_summary: withOcrOrigin(claim.medical_summary),
  };
}

export function annotateOcrFieldOrigins(result: LlmExtractionResult): LlmExtractionResult {
  return {
    ...result,
    claims: result.claims.map(annotateClaimOcrOrigins),
  };
}

export function getTracedFieldByPath(claim: ExtractionClaim, path: SynthesizableTracedPath): TracedField {
  if (path === "medical_summary") return claim.medical_summary;
  const [section, field] = path.split(".") as [
    "provider" | "billing" | "patient" | "encounter" | "diagnosis",
    string,
  ];
  if (section === "diagnosis") {
    return claim.diagnosis[field as keyof ExtractionClaim["diagnosis"]];
  }
  return claim[section][field as keyof ExtractionClaim[typeof section]] as TracedField;
}

export function setTracedFieldByPath(
  claim: ExtractionClaim,
  path: SynthesizableTracedPath,
  field: TracedField,
): ExtractionClaim {
  const next = structuredClone(claim);
  if (path === "medical_summary") {
    next.medical_summary = field;
    return next;
  }
  const [section, fieldName] = path.split(".") as [
    "provider" | "billing" | "patient" | "encounter" | "diagnosis",
    string,
  ];
  if (section === "diagnosis") {
    next.diagnosis = {
      ...next.diagnosis,
      [fieldName]: field,
    };
    return next;
  }

  switch (section) {
    case "provider":
      next.provider = { ...next.provider, [fieldName]: field };
      break;
    case "billing":
      next.billing = { ...next.billing, [fieldName]: field };
      break;
    case "patient":
      next.patient = { ...next.patient, [fieldName]: field };
      break;
    case "encounter":
      next.encounter = { ...next.encounter, [fieldName]: field };
      break;
  }

  return next;
}

function isMeaningfulLineItem(item: ExtractionLineItem): boolean {
  return hasUsableScalar(item.description);
}

function isMeaningfulTest(test: ExtractionTestResult): boolean {
  return hasUsableScalar(test.test_name) && hasUsableScalar(test.result);
}

export function listMissingTracedPaths(claim: ExtractionClaim): SynthesizableTracedPath[] {
  return SYNTHESIZABLE_TRACED_PATHS.filter((path) => !hasUsableValue(getTracedFieldByPath(claim, path)));
}

function collectOcrSnippets(claim: ExtractionClaim): string[] {
  const snippets = new Set<string>();
  for (const path of SYNTHESIZABLE_TRACED_PATHS) {
    const field = getTracedFieldByPath(claim, path);
    const text = field.source_text?.trim();
    if (text) snippets.add(text.slice(0, 200));
  }
  for (const item of claim.items) {
    if (item.source_text?.trim()) snippets.add(item.source_text.trim().slice(0, 200));
  }
  for (const test of claim.tests) {
    if (test.source_text?.trim()) snippets.add(test.source_text.trim().slice(0, 200));
  }
  return Array.from(snippets).slice(0, 40);
}

export function hasSynthesisContext(claim: ExtractionClaim): boolean {
  if (claim.items.some(isMeaningfulLineItem) || claim.tests.some(isMeaningfulTest)) {
    return true;
  }
  return SYNTHESIZABLE_TRACED_PATHS.some((path) => hasUsableValue(getTracedFieldByPath(claim, path)));
}

/** @deprecated use hasSynthesisContext */
export function hasStructuredClinicalContext(claim: ExtractionClaim): boolean {
  return hasSynthesisContext(claim);
}

function pushDerived(derived: string[], path: string, raw: string | undefined): void {
  if (!hasUsableScalar(raw)) return;
  derived.push(path);
}

export function buildStructuredClinicalContext(claim: ExtractionClaim): Record<string, unknown> {
  const known_fields: Record<string, string> = {};
  for (const path of SYNTHESIZABLE_TRACED_PATHS) {
    const value = tracedFieldValue(getTracedFieldByPath(claim, path));
    if (value) known_fields[path] = value;
  }

  return {
    known_fields,
    missing_fields: listMissingTracedPaths(claim),
    ocr_snippets: collectOcrSnippets(claim),
    provider: {
      hospital_name: tracedFieldValue(claim.provider.hospital_name),
      address: tracedFieldValue(claim.provider.address),
      city: tracedFieldValue(claim.provider.city),
      phone: tracedFieldValue(claim.provider.phone),
      email: tracedFieldValue(claim.provider.email),
    },
    billing: {
      currency: tracedFieldValue(claim.billing.currency),
      tax_amount: tracedFieldValue(claim.billing.tax_amount),
      total_amount_read: tracedFieldValue(claim.billing.total_amount_read),
      total_amount_calculated: tracedFieldValue(claim.billing.total_amount_calculated),
      payment_status: tracedFieldValue(claim.billing.payment_status),
    },
    patient: {
      patient_id: tracedFieldValue(claim.patient.patient_id),
      name: tracedFieldValue(claim.patient.name),
      dob: tracedFieldValue(claim.patient.dob),
    },
    encounter: {
      encounter_type: tracedFieldValue(claim.encounter.encounter_type),
      admission_date: tracedFieldValue(claim.encounter.admission_date),
      discharge_date: tracedFieldValue(claim.encounter.discharge_date),
    },
    items: claim.items.map((item, index) => ({
      index,
      description: item.description,
      quantity: item.quantity,
      amount: item.amount,
      related_doctor: item.related_doctor,
      missing: ITEM_SYNTH_FIELDS.filter((field) => !hasUsableScalar(String(item[field] ?? ""))),
    })),
    tests: claim.tests.map((test, index) => ({
      index,
      test_category: test.test_category,
      test_name: test.test_name,
      result: test.result,
      unit: test.unit,
      reference_range: test.reference_range,
      missing: TEST_SYNTH_FIELDS.filter((field) => !hasUsableScalar(String(test[field] ?? ""))),
    })),
  };
}

function sumLineItemAmounts(items: ExtractionLineItem[]): string {
  let sum = 0;
  let any = false;
  for (const item of items) {
    if (!hasUsableScalar(item.amount) || !isValidMonetaryValue(item.amount)) continue;
    const digits = String(item.amount).replace(/[^\d]/g, "");
    if (digits.length < 1) continue;
    sum += Number.parseInt(digits, 10);
    any = true;
  }
  return any ? String(sum) : "";
}

function detectCurrency(claim: ExtractionClaim): string {
  const corpus = [
    ...claim.items.map((item) => `${item.description} ${item.amount}`),
    tracedFieldValue(claim.billing.total_amount_read),
    tracedFieldValue(claim.billing.currency),
  ]
    .join(" ")
    .toUpperCase();

  if (/\bIDR\b|RP\.?\s*\d|\bRUPIAH\b/.test(corpus)) return "IDR";
  if (/\bUSD\b|\$\s*\d/.test(corpus)) return "USD";
  return "";
}

function inferEncounterType(claim: ExtractionClaim): string {
  const explicit = tracedFieldValue(claim.encounter.encounter_type);
  if (explicit) return explicit;
  if (hasUsableValue(claim.encounter.admission_date)) return "inpatient";
  const itemText = claim.items.map((item) => item.description).join(" ").toLowerCase();
  if (/rawat inap|inpatient|admission/.test(itemText)) return "inpatient";
  if (/rawat jalan|outpatient|poli|konsultasi/.test(itemText)) return "outpatient";
  return "";
}

export function buildDeterministicClinicalSynthesis(
  claim: ExtractionClaim,
): ClinicalSynthesisPayload | null {
  if (!hasSynthesisContext(claim)) return null;

  const traced: ClinicalSynthesisPayload["traced"] = {};
  const derived: string[] = [];

  const encounterType = inferEncounterType(claim);
  if (!hasUsableValue(claim.encounter.encounter_type) && encounterType) {
    const sources: string[] = [];
    if (hasUsableValue(claim.encounter.admission_date)) sources.push("encounter.admission_date");
    if (claim.items.length > 0) sources.push("items[0].description");
    traced["encounter.encounter_type"] = {
      value: encounterType,
      derived_from: sources,
      confidence: 0.55,
    };
  }

  const currency = detectCurrency(claim);
  if (!hasUsableValue(claim.billing.currency) && currency) {
    traced["billing.currency"] = {
      value: currency,
      derived_from: claim.items.length > 0 ? ["items[0].amount"] : [],
      confidence: 0.5,
    };
  }

  const calcSum = sumLineItemAmounts(claim.items);
  if (!hasUsableValue(claim.billing.total_amount_calculated) && calcSum) {
    traced["billing.total_amount_calculated"] = {
      value: calcSum,
      derived_from: claim.items.map((_, index) => `items[${index}].amount`),
      confidence: 0.65,
    };
  }

  const summaryParts: string[] = [];
  const admission = tracedFieldValue(claim.encounter.admission_date);
  const discharge = tracedFieldValue(claim.encounter.discharge_date);
  const encType = tracedFieldValue(claim.encounter.encounter_type) || encounterType;

  if (encType) {
    summaryParts.push(`Encounter type: ${encType}.`);
    pushDerived(derived, "encounter.encounter_type", encType);
  }
  if (admission || discharge) {
    summaryParts.push(
      `Care period${admission ? ` from ${admission}` : ""}${discharge ? ` to ${discharge}` : ""}.`.trim(),
    );
    if (admission) pushDerived(derived, "encounter.admission_date", admission);
    if (discharge) pushDerived(derived, "encounter.discharge_date", discharge);
  }

  const itemDescriptions = claim.items
    .map((item, index) => {
      if (!isMeaningfulLineItem(item)) return null;
      pushDerived(derived, `items[${index}].description`, item.description);
      const doctor = hasUsableScalar(item.related_doctor) ? ` (${item.related_doctor.trim()})` : "";
      return `${item.description.trim()}${doctor}`;
    })
    .filter((value): value is string => Boolean(value));

  if (itemDescriptions.length > 0) {
    summaryParts.push(`Line items: ${itemDescriptions.join("; ")}.`);
  }

  const labHighlights = claim.tests
    .map((test, index) => {
      if (!isMeaningfulTest(test)) return null;
      pushDerived(derived, `tests[${index}].test_name`, test.test_name);
      pushDerived(derived, `tests[${index}].result`, test.result);
      const unit = hasUsableScalar(test.unit) ? ` ${test.unit.trim()}` : "";
      const range = hasUsableScalar(test.reference_range) ? ` (ref ${test.reference_range.trim()})` : "";
      return `${test.test_name.trim()}: ${test.result.trim()}${unit}${range}`;
    })
    .filter((value): value is string => Boolean(value));

  if (labHighlights.length > 0) {
    summaryParts.push(`Laboratory: ${labHighlights.join("; ")}.`);
  }

  const medicalSummaryValue = summaryParts.join(" ").trim();
  if (!hasUsableValue(claim.medical_summary) && medicalSummaryValue) {
    traced.medical_summary = {
      value: medicalSummaryValue,
      derived_from: [...derived],
      confidence: 0.6,
    };
  }

  const icd10Description =
    itemDescriptions.length > 0 || labHighlights.length > 0
      ? `Clinical context from extracted line items and laboratory data: ${[
          ...itemDescriptions.slice(0, 3),
          ...labHighlights.slice(0, 3),
        ].join("; ")}.`
      : "";

  if (!hasUsableValue(claim.diagnosis.icd10_description) && icd10Description) {
    traced["diagnosis.icd10_description"] = {
      value: icd10Description,
      derived_from: derived.filter(
        (entry) => entry.startsWith("items[") || entry.startsWith("tests["),
      ),
      confidence: 0.55,
    };
  }

  const items: ItemFieldSynthesis[] = [];
  claim.items.forEach((item, index) => {
    const fields: Record<string, ClinicalSynthesisField> = {};
    if (hasUsableScalar(item.description) && !hasUsableScalar(item.quantity)) {
      fields.quantity = {
        value: "1",
        derived_from: [`items[${index}].description`],
        confidence: 0.5,
      };
    }
    if (Object.keys(fields).length > 0) {
      items.push({ index, fields });
    }
  });

  const hasTraced = Object.keys(traced).length > 0;
  const hasItems = items.length > 0;
  if (!hasTraced && !hasItems) return null;

  return { traced, items, tests: [] };
}

function readSynthesisField(node: unknown): ClinicalSynthesisField | null {
  if (!isObject(node)) return null;
  const value = String(node.value ?? "").trim();
  if (!value || value === "not_found") return null;
  return {
    value,
    derived_from: Array.isArray(node.derived_from)
      ? node.derived_from.filter((entry): entry is string => typeof entry === "string")
      : [],
    confidence: Number(node.confidence) || 0.55,
  };
}

function synthesisFieldToTraced(input: ClinicalSynthesisField, label: string): TracedField {
  const confidence = Math.max(
    0,
    Math.min(MAX_SYNTHESIS_CONFIDENCE, Number(input.confidence) || 0.55),
  );

  return {
    value: input.value,
    source_text: `LLM synthesis from structured OCR fields (${label})`,
    page: null,
    confidence,
    value_origin: "llm_synthesis",
    derived_from: input.derived_from,
  };
}


export function applyClinicalSynthesisToClaim(
  claim: ExtractionClaim,
  synthesis: ClinicalSynthesisPayload,
): { claim: ExtractionClaim; fieldsSynthesized: number } {
  let next = structuredClone(claim);
  let fieldsSynthesized = 0;

  for (const [path, synth] of Object.entries(synthesis.traced) as Array<
    [SynthesizableTracedPath, ClinicalSynthesisField]
  >) {
    if (!synth || hasUsableValue(getTracedFieldByPath(next, path))) continue;
    next = setTracedFieldByPath(next, path, synthesisFieldToTraced(synth, path));
    fieldsSynthesized += 1;
  }

  if (synthesis.items.length > 0) {
    next.items = next.items.map((item, index) => {
      const patch = synthesis.items.find((entry) => entry.index === index);
      if (!patch) return item;
      let updated = { ...item };
      const field_origins = { ...(updated.field_origins ?? {}) };
      for (const [field, synth] of Object.entries(patch.fields)) {
        const key = field as keyof typeof field_origins;
        if (!hasUsableScalar(String(updated[field as keyof ExtractionLineItem] ?? ""))) {
          updated = { ...updated, [field]: synth.value };
          field_origins[key] = "llm_synthesis";
          fieldsSynthesized += 1;
        }
      }
      return { ...updated, field_origins };
    });
  }

  if (synthesis.tests.length > 0) {
    next.tests = next.tests.map((test, index) => {
      const patch = synthesis.tests.find((entry) => entry.index === index);
      if (!patch) return test;
      let updated = { ...test };
      const field_origins = { ...(updated.field_origins ?? {}) };
      for (const [field, synth] of Object.entries(patch.fields)) {
        const key = field as keyof typeof field_origins;
        if (!hasUsableScalar(String(updated[field as keyof ExtractionTestResult] ?? ""))) {
          updated = { ...updated, [field]: synth.value };
          field_origins[key] = "llm_synthesis";
          fieldsSynthesized += 1;
        }
      }
      return { ...updated, field_origins };
    });
  }

  return { claim: next, fieldsSynthesized };
}

function resolveSynthesisPromptPath(): string {
  const candidates = [
    path.join(__dirname, "../prompts/clinical-synthesis.txt"),
    path.join(process.cwd(), "src/modules/extraction/prompts/clinical-synthesis.txt"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Clinical synthesis prompt file not found");
  return found;
}

function loadSynthesisPrompt(structuredClaim: Record<string, unknown>): string {
  const template = fs.readFileSync(resolveSynthesisPromptPath(), "utf8").trim();
  return template.replace(
    SYNTHESIS_PLACEHOLDER,
    JSON.stringify(structuredClaim, null, 2).slice(0, 14000),
  );
}

function parseArrayFieldPatches(
  raw: unknown,
  allowedFields: readonly string[],
): ItemFieldSynthesis[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemFieldSynthesis[] = [];

  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.index !== "number") continue;
    const fields: Record<string, ClinicalSynthesisField> = {};
    for (const field of allowedFields) {
      const synth = readSynthesisField(entry[field]);
      if (synth) fields[field] = synth;
    }
    if (Object.keys(fields).length > 0) {
      out.push({ index: entry.index, fields });
    }
  }

  return out;
}

function parseSynthesisResponse(raw: string): ClinicalSynthesisPayload | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const traced: ClinicalSynthesisPayload["traced"] = {};

    for (const path of SYNTHESIZABLE_TRACED_PATHS) {
      if (path === "medical_summary") {
        const synth = readSynthesisField(parsed.medical_summary);
        if (synth) traced.medical_summary = synth;
        continue;
      }
      const [section, field] = path.split(".");
      const sectionNode = parsed[section];
      if (!isObject(sectionNode)) continue;
      const synth = readSynthesisField(sectionNode[field]);
      if (synth) traced[path] = synth;
    }

    return {
      traced,
      items: parseArrayFieldPatches(parsed.items, ITEM_SYNTH_FIELDS),
      tests: parseArrayFieldPatches(parsed.tests, TEST_SYNTH_FIELDS),
    };
  } catch {
    return null;
  }
}

function mergeSynthesisPayloads(
  primary: ClinicalSynthesisPayload | null,
  fallback: ClinicalSynthesisPayload | null,
): ClinicalSynthesisPayload | null {
  if (!primary && !fallback) return null;
  const traced = { ...(fallback?.traced ?? {}), ...(primary?.traced ?? {}) };
  const items = [...(fallback?.items ?? [])];
  for (const entry of primary?.items ?? []) {
    const existing = items.find((item) => item.index === entry.index);
    if (existing) {
      Object.assign(existing.fields, entry.fields);
    } else {
      items.push(entry);
    }
  }
  const tests = [...(fallback?.tests ?? [])];
  for (const entry of primary?.tests ?? []) {
    const existing = tests.find((test) => test.index === entry.index);
    if (existing) {
      Object.assign(existing.fields, entry.fields);
    } else {
      tests.push(entry);
    }
  }
  return { traced, items, tests };
}

export async function callClinicalSynthesisLlm(
  structuredClaim: Record<string, unknown>,
): Promise<ClinicalSynthesisPayload | null> {
  if (!env.OPENAI_API_KEY) return null;

  const prompt = loadSynthesisPrompt(structuredClaim);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(env.LLM_REQUEST_TIMEOUT_MS, 60000));

  try {
    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You fill missing insurance claim extraction fields from structured OCR data. Return JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn("Clinical synthesis LLM request failed", { status: response.status });
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseSynthesisResponse(content);
  } catch (err) {
    logger.warn("Clinical synthesis LLM error", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function claimNeedsClinicalSynthesis(claim: ExtractionClaim): boolean {
  if (!hasSynthesisContext(claim)) return false;
  if (listMissingTracedPaths(claim).length > 0) return true;
  const hasItemGaps = claim.items.some(
    (item) =>
      hasUsableScalar(item.description) &&
      (!hasUsableScalar(item.quantity) ||
        !hasUsableScalar(item.amount) ||
        !hasUsableScalar(item.related_doctor)),
  );
  const hasTestGaps = claim.tests.some((test) =>
    TEST_SYNTH_FIELDS.some((field) => !hasUsableScalar(String(test[field] ?? ""))),
  );
  return hasItemGaps || hasTestGaps;
}

export async function enrichClaimsWithClinicalSynthesis(
  result: LlmExtractionResult,
): Promise<{ result: LlmExtractionResult; stats: ClinicalSynthesisStats }> {
  const annotated = annotateOcrFieldOrigins(result);
  const stats: ClinicalSynthesisStats = {
    claimsProcessed: annotated.claims.length,
    fieldsSynthesized: 0,
    llmUsed: false,
  };

  if (env.ENABLE_CLINICAL_FIELD_SYNTHESIS.toLowerCase() !== "true") {
    return { result: annotated, stats };
  }

  const nextClaims: ExtractionClaim[] = [];

  for (const claim of annotated.claims) {
    if (!claimNeedsClinicalSynthesis(claim)) {
      nextClaims.push(claim);
      continue;
    }

    const context = buildStructuredClinicalContext(claim);
    const deterministic = buildDeterministicClinicalSynthesis(claim);
    let llmSynthesis = await callClinicalSynthesisLlm(context);
    if (llmSynthesis) stats.llmUsed = true;

    const merged = mergeSynthesisPayloads(llmSynthesis, deterministic);
    if (!merged) {
      nextClaims.push(claim);
      continue;
    }

    const { claim: enriched, fieldsSynthesized } = applyClinicalSynthesisToClaim(claim, merged);
    stats.fieldsSynthesized += fieldsSynthesized;
    nextClaims.push(enriched);
  }

  return {
    result: { ...annotated, claims: nextClaims },
    stats,
  };
}
