import { describe, expect, it } from "vitest";
import { discoverOcrBlocksForValue, findOcrBlockForSnippet } from "./resolve-ocr-block";
import type { OcrPagePayload } from "./ocr-preprocess";

describe("findOcrBlockForSnippet", () => {
  it("returns null for empty pages", () => {
    expect(findOcrBlockForSnippet([], "test")).toBeNull();
  });

  it("retries without page hint when page-scoped search finds nothing", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 2,
        tableCount: 0,
        blocks: [
          {
            text: "Grand Total",
            confidence: 90,
            region: { l: 10, t: 10, r: 100, b: 30 },
            source: "text",
          },
        ],
      },
    ];
    const match = findOcrBlockForSnippet(pages, "Grand Total", { pageHint: 1 });
    expect(match?.page).toBe(2);
  });

  it("discovers matches on multiple pages", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 0,
        blocks: [{ text: "RS Mitra", confidence: 90, region: { l: 1, t: 1, r: 10, b: 5 }, source: "text" }],
      },
      {
        page: 4,
        tableCount: 0,
        blocks: [{ text: "RS Mitra", confidence: 85, region: { l: 2, t: 2, r: 12, b: 6 }, source: "text" }],
      },
    ];
    expect(discoverOcrBlocksForValue(pages, "RS Mitra").map((m) => m.page)).toEqual([1, 4]);
  });

  it("covers every layout page index without flooding partial word matches", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 90,
            region: { l: 1, t: 1, r: 200, b: 30 },
            source: "text",
          },
          { text: "Hospital", confidence: 90, region: { l: 1, t: 50, r: 10, b: 55 }, source: "text" },
          { text: "Martha", confidence: 88, region: { l: 11, t: 50, r: 20, b: 55 }, source: "text" },
        ],
      },
      {
        page: 2,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 95,
            region: { l: 10, t: 10, r: 200, b: 30 },
            source: "text",
          },
        ],
      },
      {
        page: 3,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 94,
            region: { l: 12, t: 20, r: 210, b: 40 },
            source: "text",
          },
        ],
      },
    ];

    const matches = discoverOcrBlocksForValue(pages, "Martha Friska Hospital");
    expect(matches.map((match) => match.page)).toEqual([1, 2, 3]);
    expect(matches).toHaveLength(3);
    expect(matches.every((match) => match.text === "Martha Friska Hospital")).toBe(true);
  });

  it("skips layout pages with only weak OCR typos for multi-word queries", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 0,
        blocks: [
          {
            text: "RaFriSKa Hospital",
            confidence: 52,
            region: { l: 978, t: 641, r: 1274, b: 690 },
            source: "text",
          },
          {
            text: "aMortan FrISKAHospital",
            confidence: 50,
            region: { l: 506, t: 638, r: 873, b: 695 },
            source: "text",
          },
        ],
      },
      {
        page: 2,
        tableCount: 0,
        blocks: [
          {
            text: "Martha Friska Hospital",
            confidence: 95,
            region: { l: 336, t: 144, r: 635, b: 179 },
            source: "text",
          },
        ],
      },
    ];

    const matches = discoverOcrBlocksForValue(pages, "Martha Friska Hospital");
    expect(matches.map((match) => match.page)).toEqual([2]);
    expect(matches[0]?.region).toEqual({ l: 336, t: 144, r: 635, b: 179 });
  });

  it("returns multiple positions on the same page", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 2,
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
            region: { l: 10, t: 3000, r: 200, b: 3030 },
            source: "text",
          },
        ],
      },
    ];
    const matches = discoverOcrBlocksForValue(pages, "Martha Friska Hospital");
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.region?.t)).toEqual([10, 3000]);
  });

  it("does not match monetary suffix substring (350 vs 2.653.350)", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 1,
        blocks: [
          {
            text: "350",
            confidence: 90,
            region: { l: 500, t: 100, r: 560, b: 125 },
            source: "table",
          },
          {
            text: "2.653.350",
            confidence: 88,
            region: { l: 700, t: 100, r: 820, b: 125 },
            source: "table",
          },
        ],
      },
    ];

    const match = findOcrBlockForSnippet(pages, "2.653.350", { preferRightmost: true });
    expect(match?.text).toBe("2.653.350");
    expect(match?.region).toEqual({ l: 700, t: 100, r: 820, b: 125 });
    expect(discoverOcrBlocksForValue(pages, "2.653.350")).toHaveLength(1);
  });

  it("matches monetary values by exact digits ignoring separators", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 0,
        blocks: [
          {
            text: "2.653.350,",
            confidence: 85,
            region: { l: 140, t: 1030, r: 369, b: 1050 },
            source: "text",
          },
        ],
      },
    ];

    const match = findOcrBlockForSnippet(pages, "2653350");
    expect(match?.text).toBe("2.653.350,");
    expect(match?.region).toEqual({ l: 140, t: 1030, r: 369, b: 1050 });
  });

  it("returns null when only a partial monetary suffix block exists", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 1,
        blocks: [
          {
            text: "350",
            confidence: 90,
            region: { l: 500, t: 100, r: 560, b: 125 },
            source: "table",
          },
        ],
      },
    ];

    expect(findOcrBlockForSnippet(pages, "2.653.350")).toBeNull();
    expect(discoverOcrBlocksForValue(pages, "2.653.350")).toHaveLength(0);
  });
});
