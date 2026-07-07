import { describe, expect, it } from "vitest";
import { synthesizeClinicalFieldsOnly } from "@/modules/extraction/application/clinical-field-synthesis";
import type { ExtractionClaim } from "@/modules/extraction/domain/extraction-schema";

const NOT_FOUND = {
  value: "not_found" as const,
  source_text: "",
  page: null,
  confidence: 0,
};

function baseClaim(overrides: Partial<ExtractionClaim> = {}): ExtractionClaim {
  return {
    provider: {
      hospital_name: {
        value: "RS Test",
        source_text: "RS Test",
        page: 2,
        confidence: 0.9,
        traces: [{ source_text: "RS Test", page: 2 }],
      },
      address: NOT_FOUND,
      city: NOT_FOUND,
      phone: NOT_FOUND,
      email: NOT_FOUND,
    },
    billing: {
      currency: NOT_FOUND,
      tax_amount: NOT_FOUND,
      total_amount_read: {
        value: "100000",
        source_text: "Total 100000",
        page: 2,
        confidence: 0.9,
        traces: [{ source_text: "Total 100000", page: 2 }],
      },
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
  it("only fills Diagnosis and Medical fields and preserves other traces", async () => {
    const claim = baseClaim({
      items: [
        {
          description: "VISITE",
          quantity: "1",
          amount: "800000",
          related_doctor: "dr. X",
          source_text: "VISITE",
          page: 3,
          confidence: 0.9,
          traces: [{ source_text: "VISITE", page: 3 }],
        },
      ],
      tests: [
        {
          test_category: "Hematologi",
          test_name: "Darah Lengkap - Lekosit",
          result: "5.38",
          unit: "10^3/uL",
          reference_range: "4-11",
          source_text: "- Lekosit || 5.38",
          page: 5,
          confidence: 0.95,
          traces: [{ source_text: "- Lekosit || 5.38", page: 5 }],
        },
      ],
    });

    const result = await synthesizeClinicalFieldsOnly(
      { claims: [claim], confidence: 0.5 },
      { ocrText: "VISITE Lekosit 5.38", filteredPlainText: "VISITE Lekosit 5.38" },
    );

    const next = result.claims[0]!;
    expect(next.provider.hospital_name.traces).toEqual(claim.provider.hospital_name.traces);
    expect(next.billing.total_amount_read.traces).toEqual(claim.billing.total_amount_read.traces);
    expect(next.items[0]?.traces).toEqual(claim.items[0]?.traces);
    expect(next.tests[0]?.traces).toEqual(claim.tests[0]?.traces);

    expect(next.medical_summary.value_origin).toBe("llm_synthesis");
    expect(next.diagnosis.icd10_description.value_origin).toBe("llm_synthesis");
    expect(next.medical_summary.page).toBeNull();
    expect(next.medical_summary.traces).toBeUndefined();
    expect(next.diagnosis.icd10_code.value).toBe("not_found");
  });
});
