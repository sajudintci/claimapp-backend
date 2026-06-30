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
});
