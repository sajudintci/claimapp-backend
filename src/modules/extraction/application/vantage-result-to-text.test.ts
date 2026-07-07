import { describe, expect, it } from "vitest";
import { abbyyResultsToOcrText } from "./vantage-result-to-text";
import type { AbbyyProcessResult } from "@/modules/extraction/infrastructure/abbyy-vantage-client";

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

function makeResult(rawResults: AbbyyProcessResult["rawResults"]): AbbyyProcessResult {
  return {
    transactionId: "tx-1",
    skillId: "skill-1",
    rawResults,
  };
}

describe("abbyyResultsToOcrText", () => {
  it("prefers dual OcrJson + Text files: Text for LLM, OcrJson for layout", () => {
    const plainText = "(Page 8 of 13)\nPAYMENT RECEIPT\nNama Pasien";
    const result = abbyyResultsToOcrText(
      makeResult([
        {
          fileId: "json-1",
          type: "OcrJson",
          contentType: "application/json",
          body: JSON.stringify(layoutJson),
        },
        {
          fileId: "text-1",
          type: "Text",
          contentType: "text/plain",
          body: plainText,
        },
      ]),
    );

    expect(result.text).toBe(plainText);
    expect(result.filteredPlainText).toBe(plainText);
    expect(result.ocrFiltered).toBe(true);
    expect(result.ocrPageCount).toBe(1);
    expect(result.text).not.toContain("=== OCR TEXT");
    expect(result.llmPrepared?.pages[0]?.page).toBe(1);
    expect(
      result.llmPrepared?.pages[0]?.blocks.find((block) => block.text === "PAYMENT RECEIPT")?.region,
    ).toEqual({
      l: 100,
      t: 100,
      r: 300,
      b: 130,
    });
  });

  it("falls back to json-only preprocess when Text file is missing", () => {
    const result = abbyyResultsToOcrText(
      makeResult([
        {
          fileId: "json-1",
          type: "OcrJson",
          contentType: "application/json",
          body: JSON.stringify({
            layout: {
              pages: [
                {
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
          }),
        },
      ]),
    );

    expect(result.ocrFiltered).toBe(true);
    expect(result.text).toContain("=== OCR TEXT");
    expect(result.text).toContain("Martha Friska Hospital");
  });

  it("falls back to plain Text when OcrJson is missing", () => {
    const plainText = "(Page 8 of 13)\nPAYMENT RECEIPT";
    const result = abbyyResultsToOcrText(
      makeResult([
        {
          fileId: "text-1",
          type: "Text",
          contentType: "text/plain",
          body: plainText,
        },
      ]),
    );

    expect(result.text).toBe(plainText);
    expect(result.ocrFiltered).toBe(false);
    expect(result.llmPrepared).toBeUndefined();
    expect(result.ocrPageCount).toBe(1);
  });
});
