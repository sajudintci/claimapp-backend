import { describe, expect, it } from "vitest";
import { buildOcrPageLinesPayload } from "./ocr-page-lines-payload";
import type { OcrPagePayload } from "./ocr-preprocess";

describe("buildOcrPageLinesPayload", () => {
  it("maps blocks to lines with aligned regions and page dimensions", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        width: 2480,
        height: 3508,
        tableCount: 0,
        blocks: [
          {
            text: "RS  MITRA  KELUARGA",
            confidence: 55,
            region: { l: 100, t: 50, r: 400, b: 80 },
            source: "text",
          },
          {
            text: "a",
            confidence: 10,
            source: "text",
          },
          {
            text: "Martha Friska",
            confidence: 90,
            region: { l: 120, t: 200, r: 280, b: 225 },
            source: "text",
          },
        ],
      },
      {
        page: 2,
        width: 2480,
        height: 3508,
        tableCount: 1,
        blocks: [
          {
            text: "INPATIENT",
            confidence: 80,
            region: { l: 50, t: 100, r: 150, b: 120 },
            source: "table",
          },
        ],
      },
    ];

    expect(buildOcrPageLinesPayload(pages)).toEqual([
      {
        page: 1,
        width: 2480,
        height: 3508,
        lines: [
          {
            text: "RS MITRA KELUARGA",
            region: { l: 100, t: 50, r: 400, b: 80 },
          },
          {
            text: "Martha Friska",
            region: { l: 120, t: 200, r: 280, b: 225 },
          },
        ],
      },
      {
        page: 2,
        width: 2480,
        height: 3508,
        lines: [
          {
            text: "INPATIENT",
            region: { l: 50, t: 100, r: 150, b: 120 },
          },
        ],
      },
    ]);
  });

  it("returns empty array when no pages have qualifying lines", () => {
    const pages: OcrPagePayload[] = [
      {
        page: 1,
        tableCount: 0,
        blocks: [{ text: "x", confidence: 0, source: "text" }],
      },
    ];
    expect(buildOcrPageLinesPayload(pages)).toEqual([]);
  });
});
