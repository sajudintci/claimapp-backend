import type { LlmPreparedInput } from "@/modules/extraction/application/ocr-preprocess";

export const OCR_PREPROCESS_HISTORY_SCHEMA_VERSION = 2;

export type OcrPreprocessPageSummary = {
  page: number;
  blockCount: number;
  tableCount: number;
};

export type OcrPreprocessHistoryPayload = {
  schemaVersion: number;
  formatSchemaVersion: number;
  ocrText: string;
  filteredPlainText: string;
  ocrCharCount: number;
  filteredCharCount: number;
  pageCount: number;
  chunks: LlmPreparedInput["chunks"];
  pageSummaries: OcrPreprocessPageSummary[];
};

export function buildOcrPreprocessHistoryPayload(
  prepared: LlmPreparedInput,
  formatSchemaVersion: number,
): OcrPreprocessHistoryPayload {
  return {
    schemaVersion: OCR_PREPROCESS_HISTORY_SCHEMA_VERSION,
    formatSchemaVersion,
    ocrText: prepared.ocrText,
    filteredPlainText: prepared.filteredPlainText,
    ocrCharCount: prepared.ocrCharCount,
    filteredCharCount: prepared.filteredCharCount,
    pageCount: prepared.pageCount,
    chunks: prepared.chunks,
    pageSummaries: prepared.pages.map((page) => ({
      page: page.page,
      blockCount: page.blocks.length,
      tableCount: page.tableCount,
    })),
  };
}
