import { describe, expect, it } from "vitest";
import {
  discoverIcd10CodesInOcr,
  extractLeadingIcd10Code,
  isPlausibleIcd10Code,
  repairIcd10CodeField,
} from "@/modules/extraction/application/icd10-code-repair";

const NOT_FOUND = {
  value: "not_found" as const,
  source_text: "",
  page: null,
  confidence: 0,
};

describe("icd10-code-repair", () => {
  it("detects labeled ICD-10 codes in OCR", () => {
    const matches = discoverIcd10CodesInOcr("Diagnosis: J18.9 Community pneumonia");
    expect(matches).toEqual([
      { code: "J18.9", source_text: "Diagnosis: J18.9" },
    ]);
  });

  it("detects ICD10 label variants", () => {
    const matches = discoverIcd10CodesInOcr("ICD-10 A09\nOther lines");
    expect(matches[0]?.code).toBe("A09");
  });

  it("rejects invalid tokens", () => {
    expect(isPlausibleIcd10Code("ICD10")).toBe(false);
    expect(isPlausibleIcd10Code("5.38")).toBe(false);
  });

  it("repairs not_found when OCR contains a code", () => {
    const repaired = repairIcd10CodeField(NOT_FOUND, {
      plainText: "ICD10: E11.9 Diabetes mellitus",
    });

    expect(repaired.value).toBe("E11.9");
    expect(repaired.value_origin).toBe("ocr");
  });

  it("promotes leading code from description when present in OCR", () => {
    const repaired = repairIcd10CodeField(NOT_FOUND, {
      plainText: "J18.9 Pneumonia",
      descriptionField: {
        value: "J18.9 Pneumonia",
        source_text: "J18.9 Pneumonia",
        page: 2,
        confidence: 0.9,
      },
    });

    expect(repaired.value).toBe("J18.9");
  });

  it("extracts leading ICD code from text", () => {
    expect(extractLeadingIcd10Code("A09.0 Acute gastroenteritis")).toBe("A09.0");
  });
});
