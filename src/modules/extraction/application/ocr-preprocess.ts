import { env } from "@/config/env";
import { TracedField } from "@/modules/extraction/domain/extraction-schema";

export type OcrLine = {
  text: string;
  page: number;
  confidence: number;
};

export type FilteredOcrPage = {
  page: number;
  lines: string[];
};

export type FilteredOcrJson = {
  pages: FilteredOcrPage[];
  allLines: OcrLine[];
  plainText: string;
  pageCount: number;
};

export type PreExtractedFieldKey =
  | "policyNumber"
  | "claimNumber"
  | "patientName"
  | "dob"
  | "admissionDate"
  | "dischargeDate"
  | "totalAmount";

export type PreExtractedFields = Record<PreExtractedFieldKey, TracedField>;

export type OcrPageLinesPayload = {
  page: number;
  lines: string[];
};

export type LlmPreparedInput = {
  ocrText: string;
  filteredPlainText: string;
  ocrCharCount: number;
  filteredCharCount: number;
  pageCount: number;
  ocrPageLines: OcrPageLinesPayload[];
  preExtracted: PreExtractedFields;
  chunks: Array<{ page: number; text: string }>;
};

const NOT_FOUND: TracedField = {
  value: "not_found",
  source_text: "",
  page: null,
  confidence: 0,
};

export const PRE_EXTRACTED_FIELD_KEYS: PreExtractedFieldKey[] = [
  "policyNumber",
  "claimNumber",
  "patientName",
  "dob",
  "admissionDate",
  "dischargeDate",
  "totalAmount",
];

type AbbyyLine = { text?: string; confidence?: number };
type AbbyyTextBlock = { lines?: AbbyyLine[] };
type AbbyyCell = { lines?: AbbyyLine[] };
type AbbyyTable = { cells?: AbbyyCell[] };
type AbbyyPage = {
  texts?: AbbyyTextBlock[];
  tables?: AbbyyTable[];
};

type AbbyyOcrJson = {
  layout?: { pages?: AbbyyPage[] };
};

function normalizeLineText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeConfidence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.max(0, Math.min(1, n / 100)) : Math.max(0, Math.min(1, n));
}

function collectLinesFromPage(page: AbbyyPage, pageNumber: number): OcrLine[] {
  const out: OcrLine[] = [];

  const pushLine = (line: AbbyyLine) => {
    const text = normalizeLineText(String(line.text ?? ""));
    if (text.length < 2) return;
    out.push({
      text,
      page: pageNumber,
      confidence: normalizeConfidence(line.confidence),
    });
  };

  for (const block of page.texts ?? []) {
    for (const line of block.lines ?? []) pushLine(line);
  }

  for (const table of page.tables ?? []) {
    for (const cell of table.cells ?? []) {
      for (const line of cell.lines ?? []) pushLine(line);
    }
  }

  return out;
}

function dedupeAdjacentLines(lines: OcrLine[]): OcrLine[] {
  const result: OcrLine[] = [];
  for (const line of lines) {
    const prev = result[result.length - 1];
    if (prev && prev.text === line.text && prev.page === line.page) continue;
    result.push(line);
  }
  return result;
}

function isAbbyyLayoutJson(input: unknown): input is AbbyyOcrJson {
  if (!input || typeof input !== "object") return false;
  const layout = (input as AbbyyOcrJson).layout;
  return Boolean(layout && Array.isArray(layout.pages) && layout.pages.length > 0);
}

export function filterOcrJson(input: unknown): FilteredOcrJson {
  if (!isAbbyyLayoutJson(input)) {
    return { pages: [], allLines: [], plainText: "", pageCount: 0 };
  }

  const pages = input.layout!.pages!;
  const allLines: OcrLine[] = [];
  const filteredPages: FilteredOcrPage[] = [];

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const pageLines = dedupeAdjacentLines(collectLinesFromPage(page, pageNumber));
    allLines.push(...pageLines);
    filteredPages.push({
      page: pageNumber,
      lines: pageLines.map((l) => l.text),
    });
  });

  const plainText = filteredPages
    .map((p) => `--- Page ${p.page} ---\n${p.lines.join("\n")}`)
    .join("\n\n");

  return {
    pages: filteredPages,
    allLines,
    plainText,
    pageCount: filteredPages.length,
  };
}

type FieldPattern = {
  key: PreExtractedFieldKey;
  patterns: RegExp[];
};

const FIELD_PATTERNS: FieldPattern[] = [
  {
    key: "policyNumber",
    patterns: [
      /(?:policy\s*(?:no|number|#)|no\.?\s*polis|polis)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    ],
  },
  {
    key: "claimNumber",
    patterns: [
      /(?:claim\s*(?:no|number|#)|no\.?\s*klaim|klaim\s*no)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    ],
  },
  {
    key: "patientName",
    patterns: [
      /(?:patient\s*name|nama\s*pasien|nama\s*tertanggung|insured\s*name)\s*[:\-]?\s*([^\n\r|]+)/i,
    ],
  },
  {
    key: "dob",
    patterns: [
      /(?:dob|date\s*of\s*birth|tanggal\s*lahir|tgl\.?\s*lahir)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    ],
  },
  {
    key: "admissionDate",
    patterns: [
      /(?:admission\s*date|tgl\.?\s*masuk|tanggal\s*masuk|tgl\s*rawat\s*in)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    ],
  },
  {
    key: "dischargeDate",
    patterns: [
      /(?:discharge\s*date|tgl\.?\s*keluar|tanggal\s*keluar|tgl\s*pulang)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
    ],
  },
  {
    key: "totalAmount",
    patterns: [
      /(?:total(?:\s*amount)?|grand\s*total|jumlah|total\s*tagihan|total\s*bayar)\s*[:\-]?\s*(?:Rp\.?\s*)?([\d.,]+)/i,
    ],
  },
];

function extractFromLine(line: OcrLine, pattern: FieldPattern): TracedField | null {
  for (const re of pattern.patterns) {
    const match = line.text.match(re);
    if (!match?.[1]) continue;
    const value = match[1].trim();
    if (!value) continue;
    return {
      value,
      source_text: line.text,
      page: line.page,
      confidence: line.confidence,
    };
  }
  return null;
}

export function extractFields(filtered: FilteredOcrJson): PreExtractedFields {
  const result = {} as PreExtractedFields;

  for (const key of PRE_EXTRACTED_FIELD_KEYS) {
    result[key] = { ...NOT_FOUND };
  }

  for (const pattern of FIELD_PATTERNS) {
    let best: TracedField | null = null;

    for (const line of filtered.allLines) {
      const hit = extractFromLine(line, pattern);
      if (!hit) continue;
      if (!best || hit.confidence > best.confidence) best = hit;
    }

    if (best) result[pattern.key] = best;
  }

  return result;
}

function valueInSource(value: string | number, sourceText: string): boolean {
  if (value === "not_found") return true;
  const v = String(value).trim();
  if (!v || !sourceText) return false;
  return sourceText.includes(v);
}

export function validateOutput(fields: PreExtractedFields): PreExtractedFields {
  const validated = {} as PreExtractedFields;

  for (const key of PRE_EXTRACTED_FIELD_KEYS) {
    const field = fields[key];
    if (
      field.value === "not_found" ||
      (field.source_text && valueInSource(field.value, field.source_text))
    ) {
      validated[key] = field;
      continue;
    }
    validated[key] = { ...NOT_FOUND };
  }

  return validated;
}

export function prepareForLLM(
  filtered: FilteredOcrJson,
  preExtracted: PreExtractedFields,
  maxChars = env.LLM_OCR_MAX_CHARS,
): LlmPreparedInput {
  const chunks = filtered.pages.map((p) => ({
    page: p.page,
    text: `--- Page ${p.page} ---\n${p.lines.join("\n")}`,
  }));

  let ocrBody = filtered.plainText;
  if (ocrBody.length > maxChars) {
    ocrBody = ocrBody.slice(0, maxChars);
  }

  const hints = PRE_EXTRACTED_FIELD_KEYS.map((key) => {
    const f = preExtracted[key];
    if (f.value === "not_found") return `${key}: not_found`;
    return `${key}: ${f.value} (page ${f.page}, source: "${f.source_text.slice(0, 120)}")`;
  }).join("\n");

  const ocrText = [
    "=== PRE-EXTRACTED KEY FIELDS (verify against OCR; do not invent) ===",
    hints,
    "",
    "=== FILTERED OCR TEXT (line-level, by page) ===",
    ocrBody,
  ].join("\n");

  const filteredCharCount = filtered.plainText.replace(/\s+/g, "").length;

  return {
    ocrText,
    filteredPlainText: filtered.plainText,
    ocrCharCount: ocrText.replace(/\s+/g, "").length,
    filteredCharCount,
    pageCount: filtered.pageCount,
    ocrPageLines: filtered.pages.map((p) => ({ page: p.page, lines: p.lines })),
    preExtracted,
    chunks,
  };
}

export function preprocessAbbyyOcrJson(
  rawJson: unknown,
  maxChars = env.LLM_OCR_MAX_CHARS,
): LlmPreparedInput | null {
  const filtered = filterOcrJson(rawJson);
  if (filtered.pageCount === 0 || filtered.allLines.length === 0) {
    return null;
  }

  const extracted = extractFields(filtered);
  const validated = validateOutput(extracted);
  return prepareForLLM(filtered, validated, maxChars);
}
