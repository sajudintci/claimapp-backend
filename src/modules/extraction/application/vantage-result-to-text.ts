import {
  combineAbbyyTextAndLayout,
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

type RawResultFile = AbbyyProcessResult["rawResults"][number];

function normalizePlainText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function findResultFile(
  rawResults: RawResultFile[],
  typeName: string,
): RawResultFile | undefined {
  const needle = typeName.toLowerCase();
  const byType = rawResults.find((file) => (file.type ?? "").toLowerCase() === needle);
  if (byType) return byType;

  if (needle === "ocrjson") {
    return rawResults.find((file) => {
      const type = (file.type ?? "").toLowerCase();
      const ct = file.contentType.toLowerCase();
      return type.includes("json") || type.includes("ocrjson") || ct.includes("json");
    });
  }

  if (needle === "text") {
    return rawResults.find((file) => {
      const type = (file.type ?? "").toLowerCase();
      const ct = file.contentType.toLowerCase();
      if (type === "ocrjson" || type.includes("json") || ct.includes("json")) return false;
      return (
        type === "text" ||
        type.includes("txt") ||
        ct.includes("text/plain") ||
        (ct.includes("text/") && !ct.includes("json"))
      );
    });
  }

  return undefined;
}

function resultFromLlmPrepared(prepared: LlmPreparedInput, useFormattedOcrText: boolean): AbbyyOcrTextResult {
  return {
    text: useFormattedOcrText ? prepared.ocrText : prepared.filteredPlainText,
    ocrPageCount: prepared.pageCount,
    ocrFiltered: true,
    filteredPlainText: prepared.filteredPlainText,
    filteredCharCount: prepared.filteredCharCount,
    llmPrepared: prepared,
  };
}

function tryPreprocessJsonBody(body: string): AbbyyOcrTextResult | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    const prepared = preprocessAbbyyOcrJson(parsed);
    if (!prepared) return null;
    return resultFromLlmPrepared(prepared, true);
  } catch {
    return null;
  }
}

function tryCombineDualFiles(ocrJsonFile: RawResultFile, textFile: RawResultFile): AbbyyOcrTextResult | null {
  try {
    const parsed = JSON.parse(ocrJsonFile.body) as unknown;
    const prepared = combineAbbyyTextAndLayout(textFile.body, parsed);
    if (!prepared) return null;
    return resultFromLlmPrepared(prepared, false);
  } catch {
    return null;
  }
}

function buildTextOnlyResult(rawResults: RawResultFile[]): AbbyyOcrTextResult {
  const textFile = findResultFile(rawResults, "Text");
  const chunks: string[] = [];

  if (textFile?.body.trim()) {
    chunks.push(textFile.body.trim());
  } else {
    for (const file of rawResults) {
      const type = (file.type ?? "").toLowerCase();
      const ct = file.contentType.toLowerCase();
      if (type.includes("json") || ct.includes("json")) continue;
      const trimmed = file.body.trim();
      if (trimmed) chunks.push(trimmed);
    }
  }

  const text = normalizePlainText(chunks.join("\n\n"));
  let ocrPageCount: number | undefined;
  const legacyMarkers = text.match(/---\s*Page\s+\d+\s*---/gi);
  const abbyyMarkers = text.match(/\(\s*Page\s+\d+[^)]*of\s+\d+\s*\)/gi);
  if (abbyyMarkers) ocrPageCount = abbyyMarkers.length;
  else if (legacyMarkers) ocrPageCount = legacyMarkers.length;

  return {
    text,
    ocrPageCount,
    ocrFiltered: false,
  };
}

export function abbyyResultsToOcrText(result: AbbyyProcessResult): AbbyyOcrTextResult {
  const ocrJsonFile = findResultFile(result.rawResults, "OcrJson");
  const textFile = findResultFile(result.rawResults, "Text");

  if (ocrJsonFile && textFile) {
    const combined = tryCombineDualFiles(ocrJsonFile, textFile);
    if (combined) return combined;
  }

  if (ocrJsonFile) {
    const jsonOnly = tryPreprocessJsonBody(ocrJsonFile.body);
    if (jsonOnly) return jsonOnly;
  }

  return buildTextOnlyResult(result.rawResults);
}
