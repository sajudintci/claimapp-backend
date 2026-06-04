import fs from "fs/promises";
import path from "path";
import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { TextExtractionResult } from "@/modules/extraction/application/document-text-extractor";

export type OcrLogContext = {
  claimId: string;
  extractionJobId?: string;
  storagePath: string;
  mimeType: string;
};

function ocrCharCount(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function buildOcrLogDir(): string {
  return path.join(env.STORAGE_PATH, "logs", "ocr");
}

async function writeOcrLogFile(params: {
  context: OcrLogContext;
  result: TextExtractionResult;
}): Promise<string | null> {
  const shouldWrite =
    env.LOG_OCR_TO_FILE.toLowerCase() === "true" || env.NODE_ENV === "development";
  if (!shouldWrite || !params.result.text) return null;

  const logBody = params.result.filteredPlainText?.trim()
    ? params.result.filteredPlainText
    : params.result.text;

  const dir = buildOcrLogDir();
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jobPart = params.context.extractionJobId
    ? `-${params.context.extractionJobId.slice(0, 8)}`
    : "";
  const filename = `${params.context.claimId}${jobPart}-${stamp}.txt`;
  const filePath = path.join(dir, filename);

  const header = [
    `claimId: ${params.context.claimId}`,
    `extractionJobId: ${params.context.extractionJobId ?? "n/a"}`,
    `mimeType: ${params.context.mimeType}`,
    `source: ${params.result.source}`,
    `storagePath: ${params.context.storagePath}`,
    `charCount: ${ocrCharCount(logBody)}`,
    `llmCharCount: ${ocrCharCount(params.result.text)}`,
    `ocrFiltered: ${params.result.ocrFiltered}`,
    `lineCount: ${logBody.split(/\r?\n/).length}`,
    `ocrPageCount: ${params.result.ocrPageCount ?? "n/a"}`,
    "--- OCR TEXT ---",
    "",
  ].join("\n");

  await fs.writeFile(filePath, `${header}${logBody}`, "utf8");
  return filePath;
}

export async function logOcrExtraction(
  context: OcrLogContext,
  result: TextExtractionResult,
): Promise<void> {
  const logBody = result.filteredPlainText?.trim() ? result.filteredPlainText : result.text;
  const charCount = ocrCharCount(logBody);
  const lineCount = logBody ? logBody.split(/\r?\n/).length : 0;
  const preview = logBody.slice(0, env.OCR_LOG_PREVIEW_CHARS);
  const previewTruncated = logBody.length > env.OCR_LOG_PREVIEW_CHARS;

  let logFilePath: string | null = null;
  try {
    logFilePath = await writeOcrLogFile({ context, result });
  } catch (err) {
    logger.warn("Failed to write OCR log file", {
      claimId: context.claimId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("OCR extraction result", {
    claimId: context.claimId,
    extractionJobId: context.extractionJobId,
    mimeType: context.mimeType,
    storagePath: context.storagePath,
    source: result.source,
    ocrFiltered: result.ocrFiltered,
    ocrPageCount: result.ocrPageCount ?? null,
    charCount,
    filteredCharCount: result.filteredCharCount ?? null,
    lineCount,
    sufficient: charCount >= env.OCR_MIN_TEXT_CHARS,
    previewTruncated,
    ocrPreview: preview,
    ocrLogFile: logFilePath,
  });
}
