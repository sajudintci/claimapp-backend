import { describe, expect, it } from "vitest";
import {
  filterOcrJson,
  prepareForLLM,
  preprocessAbbyyOcrJson,
} from "./ocr-preprocess";

describe("filterOcrJson", () => {
  it("returns empty for invalid input", () => {
    expect(filterOcrJson(null).pageCount).toBe(0);
  });

  it("parses ABBYY layout pages into blocks and plain text", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            width: 1000,
            height: 1400,
            texts: [
              {
                id: "block-1",
                lines: [
                  {
                    text: "Nama Pasien",
                    confidence: 90,
                    position: { l: 100, t: 200, r: 220, b: 220 },
                  },
                  {
                    text: "No Pegawai",
                    confidence: 88,
                    position: { l: 500, t: 200, r: 620, b: 220 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(filtered.pageCount).toBe(1);
    expect(filtered.allLines).toHaveLength(2);
    expect(filtered.plainText).toContain("Nama Pasien");
    expect(filtered.plainText).toContain("No Pegawai");
    expect(filtered.pages[0]!.blocks).toHaveLength(2);
  });
});

describe("prepareForLLM", () => {
  it("builds structured blocks and plain text sections without pre-extract hints", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            width: 1000,
            height: 1400,
            texts: [
              {
                lines: [
                  {
                    text: "Martha Friska Hospital",
                    confidence: 95,
                    position: { l: 100, t: 50, r: 400, b: 80 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const prepared = prepareForLLM(filtered, 8000);
    expect(prepared.ocrText).toContain("=== STRUCTURED OCR BLOCKS");
    expect(prepared.ocrText).not.toContain("PRE-EXTRACTED");
    expect(prepared.ocrText).not.toContain("LAYOUT PAIRS");
    expect(prepared.ocrText).toContain("Martha Friska Hospital");
    expect(prepared.ocrText).toContain("=== FILTERED OCR TEXT");
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.chunks[0]!.text).toContain("--- Page 1 ---");
  });

  it("separates wide columns with || in plain text rows", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            texts: [
              {
                lines: [
                  {
                    text: "Nama Pasien",
                    confidence: 90,
                    position: { l: 100, t: 200, r: 220, b: 220 },
                  },
                  {
                    text: "No Pegawai",
                    confidence: 88,
                    position: { l: 500, t: 200, r: 620, b: 220 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const prepared = prepareForLLM(filtered, 8000);
    expect(prepared.filteredPlainText).toContain("Nama Pasien || No Pegawai");
  });
});

describe("preprocessAbbyyOcrJson", () => {
  it("returns null when no lines", () => {
    expect(preprocessAbbyyOcrJson({ layout: { pages: [{ texts: [] }] } })).toBeNull();
  });
});
