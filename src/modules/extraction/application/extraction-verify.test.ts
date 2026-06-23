import { describe, expect, it } from "vitest";
import { verifyAndRepairExtraction } from "./extraction-verify";
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

function resultWithClaim(claim: ExtractionClaim): LlmExtractionResult {
  return {
    claims: [claim],
    confidence: 0,
  };
}

describe("verifyAndRepairExtraction patient.name", () => {
  it("rejects LLM patient.name when value is label token Pasien", () => {
    const claim = emptyClaim({
      patient: {
        patient_id: NOT_FOUND,
        name: {
          value: "Pasien",
          source_text: "Nama Pasien",
          page: 1,
          confidence: 0.9,
        },
        dob: NOT_FOUND,
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Nama Pasien\n.Banyaknyauang",
    });

    expect(result.claims[0]!.patient.name.value).toBe("not_found");
  });

  it("rejects LLM patient.name when value is OCR-garbled adjacent column label Na Pegawai", () => {
    const claim = emptyClaim({
      patient: {
        patient_id: NOT_FOUND,
        name: {
          value: "Na Pegawai",
          source_text: "Nama Pasien Na Pegawai",
          page: 2,
          confidence: 0.9,
        },
        dob: NOT_FOUND,
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Nama Pasien Na Pegawai",
    });

    expect(result.claims[0]!.patient.name.value).toBe("not_found");
  });

  it("keeps valid patient name from LLM", () => {
    const claim = emptyClaim({
      patient: {
        patient_id: NOT_FOUND,
        name: {
          value: "Budi Santoso",
          source_text: "Nama Pasien: Budi Santoso",
          page: 1,
          confidence: 0.95,
        },
        dob: NOT_FOUND,
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Nama Pasien: Budi Santoso",
    });

    expect(result.claims[0]!.patient.name.value).toBe("Budi Santoso");
  });

  it("rejects monetary label token as total_amount_read", () => {
    const claim = emptyClaim({
      billing: {
        currency: NOT_FOUND,
        tax_amount: NOT_FOUND,
        total_amount_read: {
          value: "Nominal",
          source_text: "Nominal",
          page: 1,
          confidence: 0.9,
        },
        total_amount_calculated: NOT_FOUND,
        payment_status: NOT_FOUND,
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Nominal\n600000",
    });

    expect(result.claims[0]!.billing.total_amount_read.value).toBe("not_found");
  });
});
