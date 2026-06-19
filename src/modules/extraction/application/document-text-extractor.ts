import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import {
  OcrPageLinesPayload,
  PreExtractedFields,
} from "@/modules/extraction/application/ocr-preprocess";
import { abbyyResultsToOcrText } from "@/modules/extraction/application/vantage-result-to-text";
import { processDocumentWithAbbyy } from "@/modules/extraction/infrastructure/abbyy-vantage-client";
import { readStorageRef } from "@/storage/storage.factory";

export type TextExtractionSource = "abbyy-vantage";

export type TextExtractionResult = {
  text: string;
  source: TextExtractionSource;
  ocrPageCount?: number;
  ocrFiltered: boolean;
  filteredPlainText?: string;
  filteredCharCount?: number;
  ocrPageLines?: OcrPageLinesPayload[];
  preExtracted?: PreExtractedFields;
  abbyyTransactionId?: string;
  abbyySkillId?: string;
  abbyyRawResults?: unknown;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function meaningfulTextLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export async function extractTextFromDocument(
  storagePath: string,
  mimeType: string,
  logContext?: { claimId?: string; originalFileName?: string },
): Promise<TextExtractionResult> {
  if (!env.ABBYY_CLIENT_ID || !env.ABBYY_CLIENT_SECRET) {
    throw new Error("ABBYY_CLIENT_ID and ABBYY_CLIENT_SECRET are required");
  }

  logger.info("Starting ABBYY Vantage OCR", {
    claimId: logContext?.claimId,
    storagePath,
    mimeType,
  });

  const fileBuffer = await readStorageRef(storagePath);
  const abbyyResult = await processDocumentWithAbbyy({
    buffer: fileBuffer,
    mimeType,
    originalFileName: logContext?.originalFileName,
  });
  const ocrOutput = abbyyResultsToOcrText(abbyyResult);
  const text = normalizeWhitespace(ocrOutput.text);
  const sufficiencySource = ocrOutput.filteredPlainText ?? text;

  logger.info("ABBYY Vantage OCR text ready", {
    claimId: logContext?.claimId,
    transactionId: abbyyResult.transactionId,
    skillId: abbyyResult.skillId,
    ocrFiltered: ocrOutput.ocrFiltered,
    charCount: meaningfulTextLength(text),
    filteredCharCount: ocrOutput.filteredCharCount ?? meaningfulTextLength(sufficiencySource),
    preview: text.slice(0, 400),
    ocrPageCount: ocrOutput.ocrPageCount,
    preExtractedFound: ocrOutput.preExtracted
      ? Object.values(ocrOutput.preExtracted).filter((f) => f.value !== "not_found").length
      : 0,
  });

  return {
    text,
    source: "abbyy-vantage",
    ocrPageCount: ocrOutput.ocrPageCount,
    ocrFiltered: ocrOutput.ocrFiltered,
    filteredPlainText: ocrOutput.filteredPlainText,
    filteredCharCount: ocrOutput.filteredCharCount,
    ocrPageLines: ocrOutput.ocrPageLines,
    preExtracted: ocrOutput.preExtracted,
    abbyyTransactionId: abbyyResult.transactionId,
    abbyySkillId: abbyyResult.skillId,
    abbyyRawResults: abbyyResult.rawResults.map((file) => ({
      fileId: file.fileId,
      type: file.type,
      contentType: file.contentType,
      bodyPreview: file.body.slice(0, 2000),
    })),
  };
}

export function isOcrTextSufficient(text: string, filteredPlainText?: string): boolean {
  const source = filteredPlainText?.trim() ? filteredPlainText : text;
  return meaningfulTextLength(source) >= env.OCR_MIN_TEXT_CHARS;
}
