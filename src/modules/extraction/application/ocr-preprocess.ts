import { env } from "@/config/env";
import { TracedField } from "@/modules/extraction/domain/extraction-schema";
import {
  buildPairsFromRows,
  buildRowsFromLines,
  buildTablesFromAbbyy,
  flatLinesFromPage,
  flatRegionsFromPage,
  renderPagePlainText,
  type AbbyyBox,
  type AbbyyTableCellInput,
  type AbbyyTableInput,
  type LayoutLineInput,
  type OcrLinePayload,
  type OcrPairPayload,
  type OcrRowPayload,
  type OcrStructuredPagePayload,
  type OcrTablePayload,
} from "@/modules/extraction/application/ocr-layout";

export type { AbbyyBox, OcrLinePayload, OcrRowPayload, OcrPairPayload, OcrTablePayload };

export type OcrLine = {
  text: string;
  page: number;
  confidence: number;
  position?: AbbyyBox;
};

export type FilteredOcrJson = {
  pages: OcrStructuredPagePayload[];
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

/** Stored on extraction payload (schema v3). */
export type OcrPageLinesPayload = OcrStructuredPagePayload;

export const OCR_LAYOUT_SCHEMA_VERSION = 3;

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

type AbbyyPosition = { l?: number; t?: number; r?: number; b?: number };
type AbbyyLine = { text?: string; confidence?: number; position?: AbbyyPosition };
type AbbyyTextBlock = { lines?: AbbyyLine[] };
type AbbyyCell = {
  lines?: AbbyyLine[];
  position?: AbbyyPosition;
  colRowPosition?: { l?: number; t?: number; r?: number; b?: number };
};
type AbbyyTable = { position?: AbbyyPosition; cells?: AbbyyCell[] };
type AbbyyPage = {
  width?: number;
  height?: number;
  rotated?: string;
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

export function parseAbbyyPosition(pos?: AbbyyPosition): AbbyyBox | undefined {
  if (!pos || typeof pos !== "object") return undefined;
  const l = Number(pos.l);
  const t = Number(pos.t);
  const r = Number(pos.r);
  const b = Number(pos.b);
  if (![l, t, r, b].every(Number.isFinite)) return undefined;
  if (r <= l || b <= t) return undefined;
  return { l, t, r, b };
}

function collectLinesFromPage(page: AbbyyPage, pageNumber: number): OcrLine[] {
  const out: OcrLine[] = [];

  const pushLine = (line: AbbyyLine, source: "text" | "table") => {
    const text = normalizeLineText(String(line.text ?? ""));
    if (text.length < 2) return;
    out.push({
      text,
      page: pageNumber,
      confidence: normalizeConfidence(line.confidence),
      position: parseAbbyyPosition(line.position),
    });
  };

  for (const block of page.texts ?? []) {
    for (const line of block.lines ?? []) pushLine(line, "text");
  }

  for (const table of page.tables ?? []) {
    for (const cell of table.cells ?? []) {
      for (const line of cell.lines ?? []) pushLine(line, "table");
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

function toLayoutLines(
  pageLines: OcrLine[],
  tableOnlyTexts: Set<string>,
): LayoutLineInput[] {
  return pageLines.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    position: l.position,
    source: tableOnlyTexts.has(l.text) ? "table" : "text",
  }));
}

function mapAbbyyTables(tables: AbbyyTable[]): AbbyyTableInput[] {
  return tables.map((table) => ({
    position: parseAbbyyPosition(table.position),
    cells: (table.cells ?? []).map(
      (cell): AbbyyTableCellInput => ({
        position: parseAbbyyPosition(cell.position),
        colRowPosition: cell.colRowPosition,
        lines: (cell.lines ?? []).map((line) => ({
          text: line.text,
          confidence: line.confidence,
          position: parseAbbyyPosition(line.position),
        })),
      }),
    ),
  }));
}

function buildStructuredPage(
  page: AbbyyPage,
  pageNumber: number,
  pageLines: OcrLine[],
): OcrStructuredPagePayload {
  const pageWidth = Number(page.width);
  const pageHeight = Number(page.height);

  const tableTexts = new Set<string>();
  for (const table of page.tables ?? []) {
    for (const cell of table.cells ?? []) {
      for (const line of cell.lines ?? []) {
        const t = normalizeLineText(String(line.text ?? ""));
        if (t.length >= 2) tableTexts.add(t);
      }
    }
  }

  const layoutInputs = toLayoutLines(pageLines, tableTexts);
  const linePayloads: OcrLinePayload[] = layoutInputs.map((l) => ({
    text: l.text,
    confidence: l.confidence,
    region: l.position,
    source: l.source,
  }));

  const rows = buildRowsFromLines(layoutInputs);
  const pairs = buildPairsFromRows(rows);
  const tables = buildTablesFromAbbyy(mapAbbyyTables(page.tables ?? []));

  const structured: OcrStructuredPagePayload = {
    page: pageNumber,
    width: Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : undefined,
    height: Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : undefined,
    rotated: page.rotated,
    lines: linePayloads,
    rows,
    pairs,
    tables,
    linesFlat: flatLinesFromPage({ rows, lines: linePayloads }),
    regions: flatRegionsFromPage({ rows, lines: linePayloads }),
  };

  return structured;
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
  const structuredPages: OcrStructuredPagePayload[] = [];

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const pageLines = dedupeAdjacentLines(collectLinesFromPage(page, pageNumber));
    allLines.push(...pageLines);
    structuredPages.push(buildStructuredPage(page, pageNumber, pageLines));
  });

  const plainText = structuredPages.map((p) => renderPagePlainText(p)).join("\n\n");

  return {
    pages: structuredPages,
    allLines,
    plainText,
    pageCount: structuredPages.length,
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
      /(?:patient\s*name|nama\s*pasien|nama\s*tertanggung|insured\s*name)\s*[:\-]?\s*([^\n\r|]{2,120})/i,
      /(?:^|\|)\s*nama\s*(?:pasien|tertanggung)?\s*[:\-]?\s*([A-Za-z][^\n\r|]{1,80})/i,
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
      /(?:total(?:\s*amount)?|grand\s*total|jumlah|total\s*tagihan|total\s*bayar|nominal)\s*[:\-]?\s*(?:Rp\.?\s*)?([\d.,]+)/i,
    ],
  },
];

const TOTAL_AMOUNT_LABEL =
  /^(nominal|jumlah|total|grand\s*total|total\s*bayar|jumlah\s*tagihan|amount\s*due|total\s*due)$/i;

function extractTotalFromPairs(pages: OcrStructuredPagePayload[]): TracedField | null {
  let best: TracedField | null = null;

  for (const page of pages) {
    for (const pair of page.pairs) {
      const label = pair.label.trim();
      const value = pair.value.trim();
      if (!value || !/\d/.test(value)) continue;
      if (!TOTAL_AMOUNT_LABEL.test(label) && !TOTAL_AMOUNT_LABEL.test(pair.key)) continue;

      const hit: TracedField = {
        value,
        source_text: pair.text,
        page: page.page,
        confidence: pair.confidence,
      };
      if (!best || hit.confidence > best.confidence) best = hit;
    }
  }

  return best;
}

function extractFromText(
  text: string,
  page: number,
  confidence: number,
  pattern: FieldPattern,
): TracedField | null {
  for (const re of pattern.patterns) {
    const match = text.match(re);
    if (!match?.[1]) continue;
    const value = match[1].trim();
    if (!value) continue;
    if (pattern.key === "totalAmount" && !/\d/.test(value)) continue;
    return {
      value,
      source_text: text,
      page,
      confidence,
    };
  }
  return null;
}

function extractFromLine(line: OcrLine, pattern: FieldPattern): TracedField | null {
  return extractFromText(line.text, line.page, line.confidence, pattern);
}

export function extractFields(filtered: FilteredOcrJson): PreExtractedFields {
  const result = {} as PreExtractedFields;

  for (const key of PRE_EXTRACTED_FIELD_KEYS) {
    result[key] = { ...NOT_FOUND };
  }

  for (const pattern of FIELD_PATTERNS) {
    let best: TracedField | null = null;

    if (pattern.key === "totalAmount") {
      best = extractTotalFromPairs(filtered.pages);
    }

    for (const line of filtered.allLines) {
      const hit = extractFromLine(line, pattern);
      if (!hit) continue;
      if (!best || hit.confidence > best.confidence) best = hit;
    }

    for (const page of filtered.pages) {
      for (const row of page.rows) {
        const hit = extractFromText(row.text, page.page, row.confidence, pattern);
        if (!hit) continue;
        if (!best || hit.confidence > best.confidence) best = hit;
      }
      for (const pair of page.pairs) {
        const hit = extractFromText(pair.text, page.page, pair.confidence, pattern);
        if (!hit) continue;
        if (!best || hit.confidence > best.confidence) best = hit;
      }
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
    text: renderPagePlainText(p),
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

  const layoutPairs = filtered.pages
    .flatMap((p) =>
      p.pairs
        .filter((pair) => pair.value.trim().length > 0)
        .map((pair) => `page ${p.page}: ${pair.text}`),
    )
    .slice(0, 80)
    .join("\n");

  const ocrText = [
    "=== PRE-EXTRACTED KEY FIELDS (verify against OCR; do not invent) ===",
    hints,
    "",
    layoutPairs.length > 0
      ? "=== LAYOUT PAIRS (label : value from OCR position) ===\n" + layoutPairs
      : "",
    "",
    "=== FILTERED OCR TEXT (rows + tables, by page) ===",
    ocrBody,
  ].join("\n");

  const filteredCharCount = filtered.plainText.replace(/\s+/g, "").length;

  return {
    ocrText,
    filteredPlainText: filtered.plainText,
    ocrCharCount: ocrText.replace(/\s+/g, "").length,
    filteredCharCount,
    pageCount: filtered.pageCount,
    ocrPageLines: filtered.pages,
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
