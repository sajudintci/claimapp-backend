import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { isLlmPostProcessEnabled } from "@/modules/extraction/application/llm-post-process";
import {
  ExtractionClaim,
  ExtractionLineItem,
  ExtractionTestResult,
  LlmExtractionResult,
  TracedField,
} from "@/modules/extraction/domain/extraction-schema";

const SYNTHESIS_CONFIDENCE = 0.55;
const MAX_ITEM_SNIPPETS = 8;
const MAX_TEST_SNIPPETS = 8;

const SYNTHESIZED_FIELD: Pick<TracedField, "source_text" | "page" | "traces"> = {
  source_text: "",
  page: null,
};

function isClinicalSynthesisEnabled(): boolean {
  return env.ENABLE_CLINICAL_FIELD_SYNTHESIS.toLowerCase() === "true";
}

function isFieldMissing(field: TracedField | undefined): boolean {
  const value = String(field?.value ?? "").trim();
  return !value || value === "not_found";
}

function tracedFieldValue(field: TracedField): string {
  const value = String(field.value ?? "").trim();
  return value && value !== "not_found" ? value : "";
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function itemDescriptions(items: ExtractionLineItem[]): string[] {
  return uniqueNonEmpty(items.map((item) => item.description.trim()).filter(Boolean));
}

function formatTestSnippet(test: ExtractionTestResult): string | null {
  const name = test.test_name.trim();
  const result = test.result.trim();
  if (!name && !result) return null;
  const unit = test.unit.trim();
  const ref = test.reference_range.trim();
  return [name, result && `: ${result}`, unit && ` ${unit}`, ref && ` (ref ${ref})`]
    .filter(Boolean)
    .join("")
    .trim();
}

function testSnippets(tests: ExtractionTestResult[]): string[] {
  return uniqueNonEmpty(
    tests.map(formatTestSnippet).filter((snippet): snippet is string => Boolean(snippet)),
  );
}

function buildDerivedFrom(claim: ExtractionClaim): string[] {
  const derived: string[] = [];
  claim.items.forEach((item, index) => {
    if (item.description.trim()) derived.push(`items[${index}].description`);
  });
  claim.tests.forEach((test, index) => {
    if (test.test_name.trim()) derived.push(`tests[${index}].test_name`);
    if (test.result.trim()) derived.push(`tests[${index}].result`);
  });
  if (tracedFieldValue(claim.encounter.encounter_type)) {
    derived.push("encounter.encounter_type");
  }
  return derived;
}

function buildSynthesizedField(value: string, derivedFrom: string[]): TracedField {
  return {
    ...SYNTHESIZED_FIELD,
    value,
    confidence: SYNTHESIS_CONFIDENCE,
    value_origin: "llm_synthesis",
    derived_from: derivedFrom,
  };
}

function buildDiagnosisDescription(claim: ExtractionClaim): string | null {
  if (!isFieldMissing(claim.diagnosis.icd10_description)) return null;

  const explicitCode = tracedFieldValue(claim.diagnosis.icd10_code);
  if (explicitCode) return explicitCode;

  const items = itemDescriptions(claim.items).slice(0, MAX_ITEM_SNIPPETS);
  const tests = testSnippets(claim.tests).slice(0, MAX_TEST_SNIPPETS);
  if (items.length === 0 && tests.length === 0) return null;

  const parts = [...items, ...tests];
  return `Clinical context from extracted line items and laboratory data: ${parts.join("; ")}.`;
}

function buildMedicalSummary(claim: ExtractionClaim): string | null {
  if (!isFieldMissing(claim.medical_summary)) return null;

  const encounterSource = claim.encounter.encounter_type.source_text.trim();
  const encounterType = tracedFieldValue(claim.encounter.encounter_type);
  if (encounterSource && encounterType) {
    return encounterSource;
  }

  const categoryItems = itemDescriptions(claim.items).filter((description) =>
    /^(biaya|visite|laboratory|treatment|room|inpatient|rawat|perawatan|procedure|konsultasi)/i.test(
      description,
    ),
  );
  if (categoryItems.length > 0) {
    return categoryItems.slice(0, 4).join("; ");
  }

  const items = itemDescriptions(claim.items).slice(0, 4);
  const tests = testSnippets(claim.tests).slice(0, 3);
  const parts = [...items, ...tests];
  if (parts.length === 0) return null;

  return `Summary from OCR-extracted services and laboratory data: ${parts.join("; ")}.`;
}

function claimNeedsClinicalSynthesis(claim: ExtractionClaim): boolean {
  return isFieldMissing(claim.medical_summary) || isFieldMissing(claim.diagnosis.icd10_description);
}

function synthesizeClaimClinicalFieldsDeterministic(claim: ExtractionClaim): ExtractionClaim {
  const derivedFrom = buildDerivedFrom(claim);
  const medicalValue = buildMedicalSummary(claim);
  const diagnosisValue = buildDiagnosisDescription(claim);

  return {
    ...claim,
    medical_summary:
      medicalValue && isFieldMissing(claim.medical_summary)
        ? buildSynthesizedField(medicalValue, derivedFrom)
        : claim.medical_summary,
    diagnosis: {
      icd10_code: claim.diagnosis.icd10_code,
      icd10_description:
        diagnosisValue && isFieldMissing(claim.diagnosis.icd10_description)
          ? buildSynthesizedField(diagnosisValue, derivedFrom)
          : claim.diagnosis.icd10_description,
    },
  };
}

async function synthesizeWithLlm(
  claims: ExtractionClaim[],
  ocrText: string,
): Promise<ExtractionClaim[] | null> {
  if (!isLlmPostProcessEnabled()) return null;

  const targets = claims
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => claimNeedsClinicalSynthesis(claim));
  if (targets.length === 0) return claims;

  const systemPrompt = [
    "Fill ONLY missing clinical summary fields for insurance claim review.",
    "Return JSON: {\"claims\":[{\"index\":number,\"medical_summary\":{\"value\":\"...\"},\"diagnosis\":{\"icd10_description\":{\"value\":\"...\"}}}]}.",
    "Include only claims where medical_summary or diagnosis.icd10_description are still missing.",
    "Use facts from the OCR text and structured line items / laboratory results provided.",
    "Do NOT invent ICD-10 codes. Do NOT modify any other fields.",
    "Do NOT add page numbers or traces.",
    "Keep text factual and concise. No clinical interpretation or medical necessity judgments.",
  ].join("\n");

  const payload = targets.map(({ claim, index }) => ({
    index,
    needs_medical_summary: isFieldMissing(claim.medical_summary),
    needs_diagnosis_description: isFieldMissing(claim.diagnosis.icd10_description),
    encounter_type: claim.encounter.encounter_type.value,
    items: claim.items.map((item) => ({
      description: item.description,
      related_doctor: item.related_doctor,
    })),
    tests: claim.tests.map((test) => ({
      test_name: test.test_name,
      result: test.result,
      unit: test.unit,
      reference_range: test.reference_range,
    })),
  }));

  try {
    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `OCR text:\n${ocrText.slice(0, env.LLM_OCR_MAX_CHARS)}\n\nClaims:\n${JSON.stringify(payload)}`,
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      claims?: Array<{
        index?: number;
        medical_summary?: { value?: string };
        diagnosis?: { icd10_description?: { value?: string } };
      }>;
    };

    const nextClaims = [...claims];
    for (const entry of parsed.claims ?? []) {
      const index = entry.index;
      if (index == null || index < 0 || index >= nextClaims.length) continue;

      const current = nextClaims[index]!;
      const derivedFrom = buildDerivedFrom(current);
      const medicalValue = entry.medical_summary?.value?.trim();
      const diagnosisValue = entry.diagnosis?.icd10_description?.value?.trim();

      nextClaims[index] = {
        ...current,
        medical_summary:
          isFieldMissing(current.medical_summary) &&
          medicalValue &&
          medicalValue !== "not_found"
            ? buildSynthesizedField(medicalValue, derivedFrom)
            : current.medical_summary,
        diagnosis: {
          icd10_code: current.diagnosis.icd10_code,
          icd10_description:
            isFieldMissing(current.diagnosis.icd10_description) &&
            diagnosisValue &&
            diagnosisValue !== "not_found"
              ? buildSynthesizedField(diagnosisValue, derivedFrom)
              : current.diagnosis.icd10_description,
        },
      };
    }

    return nextClaims;
  } catch (err) {
    logger.warn("Clinical field LLM synthesis failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Fills only medical_summary and diagnosis.icd10_description when OCR did not provide them.
 * Runs after OCR region attachment so other fields keep multi-page traces untouched.
 */
export async function synthesizeClinicalFieldsOnly(
  result: LlmExtractionResult,
  options: { ocrText: string; filteredPlainText: string },
): Promise<LlmExtractionResult> {
  if (!isClinicalSynthesisEnabled() || result.claims.length === 0) {
    return result;
  }

  let claims = result.claims;
  const llmClaims = await synthesizeWithLlm(claims, options.filteredPlainText || options.ocrText);
  if (llmClaims) {
    claims = llmClaims;
  }

  claims = claims.map((claim) => synthesizeClaimClinicalFieldsDeterministic(claim));

  const synthesizedClaims = claims.filter(
    (claim) =>
      claim.medical_summary.value_origin === "llm_synthesis" ||
      claim.diagnosis.icd10_description.value_origin === "llm_synthesis",
  ).length;

  if (synthesizedClaims > 0) {
    logger.info("Clinical field synthesis applied (Diagnosis + Medical only)", {
      claimCount: claims.length,
      synthesizedClaims,
    });
  }

  return { ...result, claims };
}
