import { describe, expect, it } from "vitest";
import {
  annotateOcrFieldOrigins,
  applyClinicalSynthesisToClaim,
  buildDeterministicClinicalSynthesis,
  buildStructuredClinicalContext,
  claimNeedsClinicalSynthesis,
  hasSynthesisContext,
  listMissingTracedPaths,
} from "@/modules/extraction/application/clinical-field-synthesis";
import type { ExtractionClaim, LlmExtractionResult } from "@/modules/extraction/domain/extraction-schema";

const NOT_FOUND = {
  value: "not_found" as const,
  source_text: "",
  page: null,
  confidence: 0,
};

function emptyClaim(overrides: Partial<ExtractionClaim> = {}): ExtractionClaim {
  return {
    provider: {
      hospital_name: NOT_FOUND,
      address: NOT_FOUND,
      city: NOT_FOUND,
      phone: NOT_FOUND,
      email: NOT_FOUND,
    },
    billing: {
      currency: NOT_FOUND,
      tax_amount: NOT_FOUND,
      total_amount_read: NOT_FOUND,
      total_amount_calculated: NOT_FOUND,
      payment_status: NOT_FOUND,
    },
    patient: {
      patient_id: NOT_FOUND,
      name: NOT_FOUND,
      dob: NOT_FOUND,
    },
    encounter: {
      encounter_type: NOT_FOUND,
      admission_date: NOT_FOUND,
      discharge_date: NOT_FOUND,
    },
    medical_summary: NOT_FOUND,
    diagnosis: {
      icd10_code: NOT_FOUND,
      icd10_description: NOT_FOUND,
    },
    items: [],
    tests: [],
    ...overrides,
  };
}

describe("clinical-field-synthesis", () => {
  it("detects synthesis context from items and tests", () => {
    const claim = emptyClaim({
      items: [
        {
          description: "Paracetamol 500mg",
          quantity: "10",
          amount: "50000",
          related_doctor: "dr. Siti",
          source_text: "Paracetamol",
          page: 2,
          confidence: 0.9,
        },
      ],
      tests: [
        {
          test_category: "Chemistry",
          test_name: "Glucose",
          result: "95",
          unit: "mg/dL",
          reference_range: "70-100",
          source_text: "Glucose 95",
          page: 3,
          confidence: 0.88,
        },
      ],
    });

    expect(hasSynthesisContext(claim)).toBe(true);
    expect(claimNeedsClinicalSynthesis(claim)).toBe(true);
    expect(listMissingTracedPaths(claim).length).toBeGreaterThan(10);
  });

  it("fills multiple missing traced fields deterministically", () => {
    const claim = emptyClaim({
      encounter: {
        encounter_type: NOT_FOUND,
        admission_date: { value: "01/01/2025", source_text: "01/01/2025", page: 1, confidence: 0.9 },
        discharge_date: NOT_FOUND,
      },
      items: [
        {
          description: "Konsultasi Dokter",
          quantity: "1",
          amount: "200000",
          related_doctor: "dr. Ali",
          source_text: "Konsultasi",
          page: 1,
          confidence: 0.85,
        },
      ],
      tests: [
        {
          test_category: "Hematology",
          test_name: "Hemoglobin",
          result: "14.2",
          unit: "g/dL",
          reference_range: "12-16",
          source_text: "Hb 14.2",
          page: 2,
          confidence: 0.87,
        },
      ],
    });

    const synthesis = buildDeterministicClinicalSynthesis(claim);
    expect(synthesis).not.toBeNull();

    const { claim: enriched, fieldsSynthesized } = applyClinicalSynthesisToClaim(claim, synthesis!);
    expect(fieldsSynthesized).toBeGreaterThan(2);
    expect(enriched.encounter.encounter_type.value).toBe("inpatient");
    expect(enriched.encounter.encounter_type.value_origin).toBe("llm_synthesis");
    expect(enriched.medical_summary.value).toContain("Konsultasi Dokter");
    expect(enriched.billing.total_amount_calculated.value).toBe("200000");
  });

  it("does not overwrite OCR-extracted values", () => {
    const claim = emptyClaim({
      medical_summary: {
        value: "Discharge summary from OCR",
        source_text: "Discharge summary from OCR",
        page: 4,
        confidence: 0.92,
      },
      patient: {
        patient_id: NOT_FOUND,
        name: { value: "Dewi", source_text: "Dewi", page: 1, confidence: 0.95 },
        dob: NOT_FOUND,
      },
      items: [
        {
          description: "Lab test",
          quantity: "1",
          amount: "100000",
          related_doctor: "not_found",
          source_text: "Lab test",
          page: 1,
          confidence: 0.8,
        },
      ],
    });

    const synthesis = buildDeterministicClinicalSynthesis(claim);
    expect(synthesis).not.toBeNull();
    const { claim: enriched } = applyClinicalSynthesisToClaim(claim, synthesis!);
    expect(enriched.medical_summary.value).toBe("Discharge summary from OCR");
    expect(enriched.patient.name.value).toBe("Dewi");
  });

  it("fills missing item quantity when description exists", () => {
    const claim = emptyClaim({
      items: [
        {
          description: "Obat A",
          quantity: "not_found",
          amount: "30000",
          related_doctor: "not_found",
          source_text: "Obat A",
          page: 1,
          confidence: 0.8,
        },
      ],
    });

    const synthesis = buildDeterministicClinicalSynthesis(claim);
    expect(synthesis?.items[0]?.fields.quantity?.value).toBe("1");

    const { claim: enriched } = applyClinicalSynthesisToClaim(claim, synthesis!);
    expect(enriched.items[0]?.quantity).toBe("1");
    expect(enriched.items[0]?.field_origins?.quantity).toBe("llm_synthesis");
  });

  it("annotates OCR origins on extracted fields", () => {
    const result: LlmExtractionResult = {
      confidence: 0.8,
      claims: [
        emptyClaim({
          patient: {
            patient_id: NOT_FOUND,
            name: { value: "Dewi", source_text: "Dewi", page: 1, confidence: 0.95 },
            dob: NOT_FOUND,
          },
        }),
      ],
    };

    const annotated = annotateOcrFieldOrigins(result);
    expect(annotated.claims[0].patient.name.value_origin).toBe("ocr");
  });

  it("builds structured context with missing field list", () => {
    const claim = emptyClaim({
      patient: {
        patient_id: NOT_FOUND,
        name: { value: "Budi", source_text: "Budi", page: 1, confidence: 0.9 },
        dob: NOT_FOUND,
      },
    });

    const context = buildStructuredClinicalContext(claim);
    expect(context.known_fields).toMatchObject({ "patient.name": "Budi" });
    expect(context.missing_fields).toContain("provider.hospital_name");
    expect(context.missing_fields).not.toContain("patient.name");
  });
});
