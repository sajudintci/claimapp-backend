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

  it("rejects website URL as provider.email", () => {
    const claim = emptyClaim({
      provider: {
        hospital_name: NOT_FOUND,
        address: NOT_FOUND,
        city: NOT_FOUND,
        phone: NOT_FOUND,
        email: {
          value: "www.marthafriska.com",
          source_text: "www.marthafriska.com",
          page: 2,
          confidence: 0.9,
        },
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "www.marthafriska.com Martha Friska Hospital",
    });

    expect(result.claims[0]!.provider.email.value).toBe("not_found");
  });

  it("keeps valid provider email", () => {
    const claim = emptyClaim({
      provider: {
        hospital_name: NOT_FOUND,
        address: NOT_FOUND,
        city: NOT_FOUND,
        phone: NOT_FOUND,
        email: {
          value: "info@marthafriska.com",
          source_text: "Email: info@marthafriska.com",
          page: 2,
          confidence: 0.9,
        },
      },
    });

    const { result } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Email: info@marthafriska.com",
    });

    expect(result.claims[0]!.provider.email.value).toBe("info@marthafriska.com");
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

  it("repairs diagnosis.icd10_code from OCR when LLM left it not_found", () => {
    const claim = emptyClaim({
      diagnosis: {
        icd10_code: NOT_FOUND,
        icd10_description: {
          value: "Pneumonia",
          source_text: "Diagnosis: J18.9 Pneumonia",
          page: 3,
          confidence: 0.9,
        },
      },
    });

    const { result, stats } = verifyAndRepairExtraction(resultWithClaim(claim), {
      filteredPlainText: "Diagnosis: J18.9 Pneumonia",
    });

    expect(result.claims[0]!.diagnosis.icd10_code.value).toBe("J18.9");
    expect(stats.repairedPaths).toContain("diagnosis.icd10_code");
  });
});
