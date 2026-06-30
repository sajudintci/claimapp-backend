import { describe, expect, it } from "vitest";
import {
  discoverValueTracesInPages,
  enrichExtractionResultTraces,
  splitFilteredPlainTextByPage,
} from "./enrich-field-traces";

describe("splitFilteredPlainTextByPage", () => {
  it("splits plain text by page markers", () => {
    const pages = splitFilteredPlainTextByPage(
      "--- Page 1 ---\nMartha Friska Hospital\n\n--- Page 2 ---\nTagihan\n\n--- Page 3 ---\nMartha Friska Hospital",
    );

    expect(pages).toEqual([
      { page: 1, text: "Martha Friska Hospital" },
      { page: 2, text: "Tagihan" },
      { page: 3, text: "Martha Friska Hospital" },
    ]);
  });
});

describe("discoverValueTracesInPages", () => {
  it("finds repeated values across pages", () => {
    const traces = discoverValueTracesInPages("Martha Friska Hospital", [
      { page: 1, text: "Header Martha Friska Hospital" },
      { page: 2, text: "Invoice only" },
      { page: 3, text: "Footer Martha Friska Hospital" },
    ]);

    expect(traces.map((trace) => trace.page)).toEqual([1, 3]);
    expect(traces[0]?.source_text).toContain("Martha Friska Hospital");
  });

  it("skips very short values", () => {
    expect(
      discoverValueTracesInPages("ab", [{ page: 1, text: "ab cd" }]),
    ).toEqual([]);
  });

  it("finds multiple line occurrences on the same page", () => {
    const traces = discoverValueTracesInPages("Martha Friska Hospital", [
      {
        page: 2,
        text: "Header Martha Friska Hospital\nInvoice body\nFooter Martha Friska Hospital",
      },
    ]);

    expect(traces).toHaveLength(2);
    expect(traces.every((trace) => trace.page === 2)).toBe(true);
  });
});

describe("enrichExtractionResultTraces", () => {
  it("adds multi-page traces to provider hospital name", () => {
    const result = enrichExtractionResultTraces(
      {
        confidence: 0.8,
        claims: [
          {
            provider: {
              hospital_name: {
                value: "Martha Friska Hospital",
                source_text: "Martha Friska Hospital",
                page: 2,
                confidence: 0.9,
              },
              address: { value: "not_found", source_text: "", page: null, confidence: 0 },
              city: { value: "not_found", source_text: "", page: null, confidence: 0 },
              phone: { value: "not_found", source_text: "", page: null, confidence: 0 },
              email: { value: "not_found", source_text: "", page: null, confidence: 0 },
            },
            billing: {
              currency: { value: "not_found", source_text: "", page: null, confidence: 0 },
              tax_amount: { value: "not_found", source_text: "", page: null, confidence: 0 },
              total_amount_read: { value: "not_found", source_text: "", page: null, confidence: 0 },
              total_amount_calculated: { value: "not_found", source_text: "", page: null, confidence: 0 },
              payment_status: { value: "not_found", source_text: "", page: null, confidence: 0 },
            },
            patient: {
              patient_id: { value: "not_found", source_text: "", page: null, confidence: 0 },
              name: { value: "not_found", source_text: "", page: null, confidence: 0 },
              dob: { value: "not_found", source_text: "", page: null, confidence: 0 },
            },
            encounter: {
              encounter_type: { value: "not_found", source_text: "", page: null, confidence: 0 },
              admission_date: { value: "not_found", source_text: "", page: null, confidence: 0 },
              discharge_date: { value: "not_found", source_text: "", page: null, confidence: 0 },
            },
            medical_summary: { value: "not_found", source_text: "", page: null, confidence: 0 },
            diagnosis: {
              icd10_code: { value: "not_found", source_text: "", page: null, confidence: 0 },
              icd10_description: { value: "not_found", source_text: "", page: null, confidence: 0 },
            },
            items: [],
            tests: [],
          },
        ],
      },
      "--- Page 1 ---\nMartha Friska Hospital\n--- Page 2 ---\nMartha Friska Hospital invoice\n--- Page 3 ---\nMartha Friska Hospital footer",
    );

    const hospital = result.claims[0]!.provider.hospital_name;
    expect(hospital.traces?.map((trace) => trace.page)).toEqual([1, 2, 2, 3]);
  });
});
