import { describe, expect, it } from "vitest";
import {
  buildOcrPreprocessHistoryPayload,
  OCR_PREPROCESS_HISTORY_SCHEMA_VERSION,
} from "./ocr-preprocess-history";
import { OCR_FORMAT_SCHEMA_VERSION, type LlmPreparedInput } from "@/modules/extraction/application/ocr-preprocess";

describe("buildOcrPreprocessHistoryPayload", () => {
  it("captures LLM OCR payload and page summaries", () => {
    const prepared: LlmPreparedInput = {
      ocrText: "=== STRUCTURED OCR BLOCKS ===\nNama Pasien",
      filteredPlainText: "Nama Pasien",
      ocrCharCount: 120,
      filteredCharCount: 10,
      pageCount: 1,
      chunks: [{ page: 1, text: "--- Page 1 ---\nNama Pasien" }],
      pages: [
        {
          page: 1,
          blocks: [
            {
              text: "Nama Pasien",
              confidence: 90,
              region: { l: 100, t: 200, r: 220, b: 220 },
              source: "text",
            },
          ],
          tableCount: 0,
        },
      ],
    };

    const payload = buildOcrPreprocessHistoryPayload(prepared, OCR_FORMAT_SCHEMA_VERSION);
    expect(payload.schemaVersion).toBe(OCR_PREPROCESS_HISTORY_SCHEMA_VERSION);
    expect(payload.formatSchemaVersion).toBe(OCR_FORMAT_SCHEMA_VERSION);
    expect(payload.ocrText).toContain("STRUCTURED OCR BLOCKS");
    expect(payload.pageSummaries).toEqual([{ page: 1, blockCount: 1, tableCount: 0 }]);
  });
});
