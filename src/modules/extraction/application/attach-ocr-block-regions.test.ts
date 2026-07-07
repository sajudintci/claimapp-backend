import { describe, expect, it } from "vitest";
import {
  attachOcrBlockRegions,
  buildFieldQueries,
} from "./attach-ocr-block-regions";
import { discoverOcrBlocksForValue, findOcrBlockForSnippet } from "./resolve-ocr-block";
import type { OcrPagePayload } from "./ocr-preprocess";
import type { LlmExtractionResult } from "@/modules/extraction/domain/extraction-schema";

const billingPage: OcrPagePayload = {
  page: 3,
  width: 2480,
  height: 3508,
  tableCount: 0,
  blocks: [
    {
      id: "desc-block",
      text: "Konsultasi Dokter Spesialis",
      confidence: 80,
      region: { l: 80, t: 1000, r: 420, b: 1025 },
      source: "text",
    },
    {
      id: "amount-block",
      text: "800.000,",
      confidence: 55,
      region: { l: 140, t: 1030, r: 369, b: 1050 },
      source: "text",
    },
    {
      id: "other-amount",
      text: "150.000,",
      confidence: 60,
      region: { l: 140, t: 900, r: 300, b: 920 },
      source: "text",
    },
  ],
};

const hospitalPages: OcrPagePayload[] = [
  {
    page: 1,
    width: 1000,
    height: 1400,
    tableCount: 0,
    blocks: [
      {
        text: "Martha Friska Hospital",
        confidence: 90,
        region: { l: 10, t: 10, r: 200, b: 30 },
        source: "text",
      },
    ],
  },
  {
    page: 3,
    width: 1000,
    height: 1400,
    tableCount: 0,
    blocks: [
      {
        text: "Martha Friska Hospital",
        confidence: 88,
        region: { l: 12, t: 20, r: 210, b: 40 },
        source: "text",
      },
    ],
  },
];

describe("buildFieldQueries", () => {
  it("searches by LLM value only when value is present", () => {
    expect(
      buildFieldQueries({
        value: "Martha Friska Hospital",
        source_text:
          "Header Martha Friska Hospital invoice body with many unrelated words that should not be used as query",
        page: 1,
        confidence: 0.9,
      }),
    ).toEqual(["Martha Friska Hospital"]);
  });

  it("falls back to source_text when value is not_found", () => {
    expect(
      buildFieldQueries({
        value: "not_found",
        source_text: "PAYMENT RECEIPT",
        page: null,
        confidence: 0,
      }),
    ).toEqual(["PAYMENT RECEIPT"]);
  });
});

describe("findOcrBlockForSnippet", () => {
  it("matches amount block by digits and prefers rightmost on ties", () => {
    const match = findOcrBlockForSnippet([billingPage], "800000", {
      pageHint: 3,
      preferRightmost: true,
    });
    expect(match?.text).toBe("800.000,");
    expect(match?.region).toEqual({ l: 140, t: 1030, r: 369, b: 1050 });
  });

  it("matches description on the same row as amount anchor", () => {
    const amount = findOcrBlockForSnippet([billingPage], "800.000,", { pageHint: 3 });
    const desc = findOcrBlockForSnippet([billingPage], "Konsultasi Dokter Spesialis", {
      pageHint: 3,
      rowAnchor: amount?.region,
    });
    expect(desc?.text).toBe("Konsultasi Dokter Spesialis");
    expect(desc?.region?.t).toBe(1000);
  });
});

describe("discoverOcrBlocksForValue", () => {
  it("returns all matches across pages", () => {
    const matches = discoverOcrBlocksForValue(hospitalPages, "Martha Friska Hospital");
    expect(matches.map((match) => match.page)).toEqual([1, 3]);
    expect(matches[0]?.region).toEqual({ l: 10, t: 10, r: 200, b: 30 });
    expect(matches[1]?.region).toEqual({ l: 12, t: 20, r: 210, b: 40 });
  });

  it("returns multiple positions on one page", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 2,
        width: 1000,
        height: 1400,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 90,
            region: { l: 10, t: 10, r: 200, b: 30 },
            source: "text",
          },
          {
            text: "Martha Friska Hospital",
            confidence: 88,
            region: { l: 10, t: 1300, r: 200, b: 1330 },
            source: "text",
          },
        ],
      },
    ];
    const matches = discoverOcrBlocksForValue(pages, "Martha Friska Hospital");
    expect(matches).toHaveLength(2);
    expect(matches.every((match) => match.page === 2)).toBe(true);
  });
});

describe("attachOcrBlockRegions", () => {
  it("stores per-field traces with regions for line items", () => {
    const result: LlmExtractionResult = {
      confidence: 0.9,
      claims: [
        {
          provider: {
            hospital_name: { value: "not_found", source_text: "", page: null, confidence: 0 },
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
          items: [
            {
              description: "Konsultasi Dokter Spesialis",
              quantity: "1",
              amount: "800000",
              related_doctor: "",
              source_text: "Konsultasi Dokter Spesialis",
              page: 3,
              confidence: 0.8,
            },
          ],
          tests: [],
        },
      ],
    };

    const enriched = attachOcrBlockRegions(result, [billingPage]);
    const item = enriched.claims[0]!.items[0]!;

    expect(item.field_traces?.amount?.[0]?.source_text).toBe("800.000,");
    expect(item.field_traces?.amount?.[0]?.region).toEqual({ l: 140, t: 1030, r: 369, b: 1050 });
    expect(item.field_traces?.description?.[0]?.source_text).toBe("Konsultasi Dokter Spesialis");
    expect(item.field_traces?.description?.[0]?.region?.t).toBe(1000);
    expect(item.traces?.[0]?.source_text).toBe("Konsultasi Dokter Spesialis");
    expect(item.traces?.[0]?.region?.t).toBe(1000);
  });

  it("discovers multi-page traces from OcrJson blocks without text enrich", () => {
    const base: LlmExtractionResult = {
      confidence: 0.9,
      claims: [
        {
          provider: {
            hospital_name: {
              value: "Martha Friska Hospital",
              source_text: "Martha Friska Hospital",
              page: 1,
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
    };

    const withRegions = attachOcrBlockRegions(base, hospitalPages);
    const hospital = withRegions.claims[0]!.provider.hospital_name;

    expect(hospital.traces?.map((trace) => trace.page)).toEqual([1, 3]);
    expect(hospital.traces?.[0]?.region).toEqual({ l: 10, t: 10, r: 200, b: 30 });
    expect(hospital.traces?.[1]?.region).toEqual({ l: 12, t: 20, r: 210, b: 40 });
    expect(hospital.source_text).toBe("Martha Friska Hospital");
  });

  it("matches by value when source_text is a noisy long line", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        width: 1000,
        height: 1400,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 90,
            region: { l: 336, t: 144, r: 635, b: 179 },
            source: "text",
          },
        ],
      },
    ];

    const withRegions = attachOcrBlockRegions(
      {
        confidence: 0.9,
        claims: [
          {
            provider: {
              hospital_name: {
                value: "Martha Friska Hospital",
                source_text:
                  "JI. Multatuli Komplek Rumah Sakit Martha Friska No. 1 Medan Telp fax unrelated",
                page: 1,
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
      pages,
    );

    const hospital = withRegions.claims[0]!.provider.hospital_name;
    expect(hospital.traces?.[0]?.page).toBe(1);
    expect(hospital.traces?.[0]?.region).toEqual({ l: 336, t: 144, r: 635, b: 179 });
    expect(hospital.source_text).toBe("Martha Friska Hospital");
  });
});
