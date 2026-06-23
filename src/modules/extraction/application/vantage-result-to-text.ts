import {
  LlmPreparedInput,
  preprocessAbbyyOcrJson,
} from "@/modules/extraction/application/ocr-preprocess";
import { AbbyyProcessResult } from "@/modules/extraction/infrastructure/abbyy-vantage-client";

export type AbbyyOcrTextResult = {
  text: string;
  ocrPageCount?: number;
  ocrFiltered: boolean;
  filteredPlainText?: string;
  filteredCharCount?: number;
  llmPrepared?: LlmPreparedInput;
};

function normalizePlainText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function fallbackPlainTextFromBody(body: string): string {
  return normalizePlainText(body.trim());
}

function tryPreprocessJsonBody(body: string): AbbyyOcrTextResult | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    const prepared = preprocessAbbyyOcrJson(parsed);
    if (!prepared) return null;

    return {
      text: prepared.ocrText,
      ocrPageCount: prepared.pageCount,
      ocrFiltered: true,
      filteredPlainText: prepared.filteredPlainText,
      filteredCharCount: prepared.filteredCharCount,
      llmPrepared: prepared,
    };
  } catch {
    return null;
  }
}

export function abbyyResultsToOcrText(result: AbbyyProcessResult): AbbyyOcrTextResult {
  const jsonFiles = result.rawResults.filter((file) => {
    const type = (file.type ?? "").toLowerCase();
    const ct = file.contentType.toLowerCase();
    return type.includes("json") || ct.includes("json");
  });

  for (const file of jsonFiles) {
    const preprocessed = tryPreprocessJsonBody(file.body);
    if (preprocessed) return preprocessed;
  }

  const textFiles = result.rawResults.filter((file) => {
    const type = (file.type ?? "").toLowerCase();
    const ct = file.contentType.toLowerCase();
    return (
      type.includes("text") ||
      type.includes("txt") ||
      ct.includes("text/plain") ||
      (ct.includes("text/") && !ct.includes("json"))
    );
  });

  const chunks: string[] = [];
  for (const file of textFiles) {
    const trimmed = file.body.trim();
    if (trimmed) chunks.push(trimmed);
  }

  if (chunks.length === 0) {
    for (const file of result.rawResults) {
      const trimmed = file.body.trim();
      if (trimmed) chunks.push(trimmed);
    }
  }

  const text = normalizePlainText(chunks.join("\n\n"));
  let ocrPageCount: number | undefined;
  const pageMarkers = text.match(/---\s*Page\s+\d+\s*---/gi);
  if (pageMarkers) ocrPageCount = pageMarkers.length;

  return {
    text,
    ocrPageCount,
    ocrFiltered: false,
  };
}
