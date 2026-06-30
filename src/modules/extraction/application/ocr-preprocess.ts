import { env } from "@/config/env";

export type AbbyyBox = {
  l: number;
  t: number;
  r: number;
  b: number;
};

export type OcrLine = {
  text: string;
  page: number;
  confidence: number;
  position?: AbbyyBox;
};

export type OcrTextBlockPayload = {
  id?: string;
  text: string;
  confidence: number;
  region?: AbbyyBox;
  source: "text" | "table";
};

export type OcrPagePayload = {
  page: number;
  width?: number;
  height?: number;
  rotated?: string;
  blocks: OcrTextBlockPayload[];
  tableCount: number;
};

export type FilteredOcrJson = {
  pages: OcrPagePayload[];
  allLines: OcrLine[];
  plainText: string;
  pageCount: number;
};

export const OCR_FORMAT_SCHEMA_VERSION = 6;

export type LlmPreparedInput = {
  ocrText: string;
  filteredPlainText: string;
  ocrCharCount: number;
  filteredCharCount: number;
  pageCount: number;
  pages: OcrPagePayload[];
  chunks: Array<{ page: number; text: string }>;
};

type AbbyyPosition = { l?: number; t?: number; r?: number; b?: number };
type AbbyyWord = { text?: string; confidence?: number; position?: AbbyyPosition };
type AbbyyLine = {
  text?: string;
  confidence?: number;
  position?: AbbyyPosition;
  words?: AbbyyWord[];
};
type AbbyyTextBlock = { id?: string; lines?: AbbyyLine[] };
type AbbyyCell = {
  lines?: AbbyyLine[];
  position?: AbbyyPosition;
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

const ROW_Y_TOLERANCE_PX = 20;
const COLUMN_GAP_PX = 60;

function normalizeLineText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserve ABBYY line confidence on the 0–100 scale (matches raw JSON). */
function normalizeAbbyyConfidence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= 1) return Math.round(Math.max(0, Math.min(1, n)) * 100);
  return Math.round(Math.max(0, Math.min(100, n)));
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

function centerY(box: AbbyyBox): number {
  return (box.t + box.b) / 2;
}

function horizontalGap(a: AbbyyBox, b: AbbyyBox): number {
  if (b.l >= a.r) return b.l - a.r;
  if (a.l >= b.r) return a.l - b.r;
  return 0;
}

function expandLineToBlocks(
  line: AbbyyLine,
  source: "text" | "table",
  blockId?: string,
): OcrTextBlockPayload[] {
  const lineText = normalizeLineText(String(line.text ?? ""));
  const lineConfidence = normalizeAbbyyConfidence(line.confidence);
  const lineRegion = parseAbbyyPosition(line.position);

  const wordEntries = (line.words ?? [])
    .map((word) => ({
      text: normalizeLineText(String(word.text ?? "")),
      region: parseAbbyyPosition(word.position),
      confidence: normalizeAbbyyConfidence(word.confidence ?? line.confidence),
    }))
    .filter((entry) => entry.text.length >= 2 && entry.region);

  const hasWideWordSpread =
    wordEntries.length >= 2 &&
    wordEntries.some((entry, index) => {
      if (index === 0) return false;
      const prev = wordEntries[index - 1]!;
      return horizontalGap(prev.region!, entry.region!) >= COLUMN_GAP_PX;
    });

  const useWordBoxes =
    wordEntries.length > 0 &&
    (source === "table" || wordEntries.length >= 2 || hasWideWordSpread);

  if (useWordBoxes) {
    return wordEntries.map((entry) => ({
      id: blockId,
      text: entry.text,
      confidence: entry.confidence,
      region: entry.region,
      source,
    }));
  }

  if (lineText.length < 2) return [];
  return [
    {
      id: blockId,
      text: lineText,
      confidence: lineConfidence,
      region: lineRegion,
      source,
    },
  ];
}

function collectBlocksFromPage(page: AbbyyPage, pageNumber: number): OcrTextBlockPayload[] {
  const blocks: OcrTextBlockPayload[] = [];

  for (const block of page.texts ?? []) {
    for (const line of block.lines ?? []) {
      blocks.push(...expandLineToBlocks(line, "text", block.id));
    }
  }

  for (const table of page.tables ?? []) {
    for (const cell of table.cells ?? []) {
      for (const line of cell.lines ?? []) {
        blocks.push(...expandLineToBlocks(line, "table"));
      }
    }
  }

  blocks.sort(
    (a, b) =>
      (a.region?.t ?? 0) - (b.region?.t ?? 0) ||
      (a.region?.l ?? 0) - (b.region?.l ?? 0),
  );

  return blocks;
}

function collectLinesFromBlocks(blocks: OcrTextBlockPayload[], pageNumber: number): OcrLine[] {
  return blocks.map((block) => ({
    text: block.text,
    page: pageNumber,
    confidence: block.confidence,
    position: block.region,
  }));
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

function groupBlocksIntoVisualRows(blocks: OcrTextBlockPayload[]): string[] {
  const withBox = blocks.filter((block) => block.region);
  if (withBox.length === 0) {
    return blocks.map((block) => block.text).filter(Boolean);
  }

  const sorted = [...withBox].sort(
    (a, b) =>
      centerY(a.region!) - centerY(b.region!) ||
      a.region!.l - b.region!.l,
  );

  const rows: OcrTextBlockPayload[][] = [];
  for (const block of sorted) {
    const box = block.region!;
    let placed = false;
    for (const row of rows) {
      const ref = row[0]!.region!;
      if (Math.abs(centerY(ref) - centerY(box)) <= ROW_Y_TOLERANCE_PX) {
        row.push(block);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([block]);
  }

  return rows.map((row) => {
    row.sort((a, b) => (a.region?.l ?? 0) - (b.region?.l ?? 0));
    const parts: string[] = [];
    for (let i = 0; i < row.length; i++) {
      const current = row[i]!;
      if (i === 0) {
        parts.push(current.text);
        continue;
      }
      const prev = row[i - 1]!;
      const gap =
        prev.region && current.region
          ? horizontalGap(prev.region, current.region)
          : 0;
      const separator = gap >= COLUMN_GAP_PX ? " || " : " ";
      parts.push(`${separator}${current.text}`);
    }
    return parts.join("");
  });
}

function renderStructuredBlocks(pages: OcrPagePayload[]): string {
  const lines: string[] = [];

  for (const page of pages) {
    lines.push(`--- Page ${page.page} ---`);
    if (page.width && page.height) {
      lines.push(`page_dimensions: width=${page.width}, height=${page.height}`);
    }
    if (page.tableCount > 0) {
      lines.push(`tables: ${page.tableCount}`);
    }

    for (const block of page.blocks) {
      const idPrefix = block.id ? `${block.id.slice(0, 8)} ` : "";
      if (block.region) {
        const { l, r, t, b } = block.region;
        lines.push(
          `[${idPrefix}x:${l}-${r}, y:${t}-${b}] "${block.text}" (confidence=${block.confidence}, source=${block.source})`,
        );
      } else {
        lines.push(`[${idPrefix}] "${block.text}" (confidence=${block.confidence})`);
      }
    }
  }

  return lines.join("\n");
}

export function renderPagePlainText(page: OcrPagePayload): string {
  const lines: string[] = [`--- Page ${page.page} ---`];
  lines.push(...groupBlocksIntoVisualRows(page.blocks));

  const tableBlocks = page.blocks.filter((block) => block.source === "table");
  if (tableBlocks.length > 0) {
    lines.push("[TABLE]");
    lines.push(tableBlocks.map((block) => block.text).join(" | "));
  }

  return lines.join("\n");
}

function buildPagePayload(page: AbbyyPage, pageNumber: number): OcrPagePayload {
  const pageWidth = Number(page.width);
  const pageHeight = Number(page.height);
  const blocks = collectBlocksFromPage(page, pageNumber);

  return {
    page: pageNumber,
    width: Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : undefined,
    height: Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : undefined,
    rotated: page.rotated,
    blocks,
    tableCount: page.tables?.length ?? 0,
  };
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
  const structuredPages: OcrPagePayload[] = [];

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    const pagePayload = buildPagePayload(page, pageNumber);
    structuredPages.push(pagePayload);
    allLines.push(...dedupeAdjacentLines(collectLinesFromBlocks(pagePayload.blocks, pageNumber)));
  });

  const plainText = structuredPages.map((page) => renderPagePlainText(page)).join("\n\n");

  return {
    pages: structuredPages,
    allLines,
    plainText,
    pageCount: structuredPages.length,
  };
}

export function prepareForLLM(
  filtered: FilteredOcrJson,
  maxChars = env.LLM_OCR_MAX_CHARS,
): LlmPreparedInput {
  const chunks = filtered.pages.map((page) => ({
    page: page.page,
    text: renderPagePlainText(page),
  }));

  const structuredBlocks = renderStructuredBlocks(filtered.pages);
  const structuredCap = Math.max(4000, Math.floor(maxChars * 0.75));
  const structuredSection = structuredBlocks.slice(0, structuredCap);

  let plainBody = filtered.plainText;
  const remaining = Math.max(0, maxChars - structuredSection.length - 200);
  if (plainBody.length > remaining) {
    plainBody = plainBody.slice(0, remaining);
  }

  const ocrText = [
    "=== STRUCTURED OCR BLOCKS (position + text, top to bottom) ===",
    structuredSection,
    "",
    "=== FILTERED OCR TEXT (visual rows by page) ===",
    plainBody,
  ].join("\n");

  const filteredCharCount = filtered.plainText.replace(/\s+/g, "").length;

  return {
    ocrText,
    filteredPlainText: filtered.plainText,
    ocrCharCount: ocrText.replace(/\s+/g, "").length,
    filteredCharCount,
    pageCount: filtered.pageCount,
    pages: filtered.pages,
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

  return prepareForLLM(filtered, maxChars);
}
