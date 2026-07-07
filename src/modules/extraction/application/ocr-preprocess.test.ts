import { describe, expect, it } from "vitest";
import {
  combineAbbyyTextAndLayout,
  filterOcrJson,
  prepareForLLM,
  preprocessAbbyyOcrJson,
  splitAbbyyPlainTextByPage,
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
    expect(filtered.pages[0]!.blocks[0]!.confidence).toBe(90);
    expect(filtered.pages[0]!.blocks[1]!.confidence).toBe(88);
  });

  it("uses OcrJson layout index for page numbers", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            texts: [
              {
                lines: [
                  {
                    text: "(Page 8 of 13)",
                    confidence: 55,
                    position: { l: 24, t: 40, r: 206, b: 75 },
                  },
                  {
                    text: "PAYMENT RECEIPT",
                    confidence: 90,
                    position: { l: 100, t: 100, r: 300, b: 130 },
                  },
                ],
              },
            ],
          },
          {
            texts: [
              {
                lines: [
                  {
                    text: "(Page 9 of 13)",
                    confidence: 55,
                    position: { l: 24, t: 40, r: 206, b: 75 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(filtered.pages[0]!.page).toBe(1);
    expect(filtered.pages[1]!.page).toBe(2);
    expect(filtered.allLines[0]!.page).toBe(1);
    expect(filtered.allLines.find((line) => line.text === "PAYMENT RECEIPT")?.page).toBe(1);
  });

  it("splits merged table cell lines into word boxes for precise highlights", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            width: 1654,
            height: 2340,
            tables: [
              {
                cells: [
                  {
                    lines: [
                      {
                        text: "VISITE 800.000,",
                        confidence: 55,
                        position: { l: 139, t: 990, r: 1252, b: 1028 },
                        words: [
                          {
                            text: "VISITE",
                            confidence: 55,
                            position: { l: 139, t: 991, r: 202, b: 1009 },
                          },
                          {
                            text: "800.000,",
                            confidence: 55,
                            position: { l: 1176, t: 1008, r: 1252, b: 1028 },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const blocks = filtered.pages[0]!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks.find((b) => b.text === "VISITE")?.region).toEqual({
      l: 139,
      t: 991,
      r: 202,
      b: 1009,
    });
    expect(blocks.find((b) => b.text === "800.000,")?.region).toEqual({
      l: 1176,
      t: 1008,
      r: 1252,
      b: 1028,
    });
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
    expect(prepared.ocrText).toContain("=== OCR TEXT (visual rows");
    expect(prepared.ocrText).not.toContain("PRE-EXTRACTED");
    expect(prepared.ocrText).not.toContain("LAYOUT PAIRS");
    expect(prepared.ocrText).toContain("Martha Friska Hospital");
    expect(prepared.ocrText).not.toContain("confidence=95, source=text");
    expect(prepared.ocrText).not.toMatch(/confidence=0\.\d+/);
    expect(prepared.ocrText).toContain("=== OCR TEXT REPEATED");
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

  it("maps ABBYY confidence -1 to 0", () => {
    const filtered = filterOcrJson({
      layout: {
        pages: [
          {
            texts: [
              {
                lines: [{ text: "Valid line", confidence: -1, position: { l: 10, t: 20, r: 100, b: 40 } }],
              },
            ],
          },
        ],
      },
    });
    expect(filtered.pages[0]!.blocks[0]!.confidence).toBe(0);
  });
});

describe("splitAbbyyPlainTextByPage", () => {
  it("splits ABBYY Text output by page markers", () => {
    const pages = splitAbbyyPlainTextByPage(
      "(Page 8 of 13)\nPAYMENT RECEIPT\n\n(Page 9 of 13)\nTagihan Pasien",
    );

    expect(pages).toEqual([
      { page: 1, text: "PAYMENT RECEIPT" },
      { page: 2, text: "Tagihan Pasien" },
    ]);
  });

  it("tolerates OCR typos in page markers", () => {
    const pages = splitAbbyyPlainTextByPage("(Page 10' of 13)\nLine A\n(Page 11' of 13)\nLine B");
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
  });
});

describe("combineAbbyyTextAndLayout", () => {
  const layoutJson = {
    layout: {
      pages: [
        {
          texts: [
            {
              lines: [
                {
                  text: "(Page 8 of 13)",
                  confidence: 55,
                  position: { l: 24, t: 40, r: 206, b: 75 },
                },
                {
                  text: "PAYMENT RECEIPT",
                  confidence: 90,
                  position: { l: 100, t: 100, r: 300, b: 130 },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it("uses Text file body for LLM without prepareForLLM headers", () => {
    const plainText = "(Page 8 of 13)\nPAYMENT RECEIPT\nNama Pasien";
    const prepared = combineAbbyyTextAndLayout(plainText, layoutJson, 8000);

    expect(prepared).not.toBeNull();
    expect(prepared!.filteredPlainText).toBe(plainText);
    expect(prepared!.ocrText).toBe(plainText);
    expect(prepared!.ocrText).not.toContain("=== OCR TEXT");
    expect(prepared!.pages[0]!.page).toBe(1);
    expect(prepared!.pages[0]!.blocks.find((block) => block.text === "PAYMENT RECEIPT")?.region).toEqual({
      l: 100,
      t: 100,
      r: 300,
      b: 130,
    });
    expect(prepared!.chunks).toEqual([{ page: 1, text: "PAYMENT RECEIPT\nNama Pasien" }]);
  });

  it("returns null when layout has no pages", () => {
    expect(combineAbbyyTextAndLayout("hello", { layout: { pages: [] } })).toBeNull();
  });
});
