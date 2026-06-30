import type { AbbyyBox, OcrPagePayload } from "@/modules/extraction/application/ocr-preprocess";
import { MAX_FIELD_TRACES } from "@/modules/extraction/domain/field-trace";

export type OcrBlockMatch = {
  text: string;
  page: number;
  region?: AbbyyBox;
  blockId?: string;
  score: number;
};

export type FindOcrBlockOptions = {
  pageHint?: number | null;
  /** Prefer blocks in the rightmost column (amount/qty columns). */
  preferRightmost?: boolean;
  /** Prefer blocks on the same visual row as this anchor box. */
  rowAnchor?: AbbyyBox;
  rowYTolerance?: number;
};

const DEFAULT_ROW_Y_TOLERANCE = 24;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAlnum(text: string): string {
  return normalize(text).replace(/[^\p{L}\p{N}]/gu, "");
}

function compactDigits(text: string): string {
  return text.replace(/\D/g, "");
}

function centerY(box: AbbyyBox): number {
  return (box.t + box.b) / 2;
}

function scoreBlockText(blockText: string, query: string): number {
  const blockNorm = normalize(blockText);
  const queryNorm = normalize(query);
  if (!blockNorm || !queryNorm) return 0;

  if (blockNorm === queryNorm) return 100;

  const blockCompact = compactAlnum(blockText);
  const queryCompact = compactAlnum(query);
  if (blockCompact && blockCompact === queryCompact) return 98;
  if (queryCompact.length >= 3 && blockCompact.includes(queryCompact)) {
    return 85 + Math.min(queryCompact.length, 15);
  }
  if (blockCompact.length >= 4 && queryCompact.includes(blockCompact)) return 72;

  const queryDigits = compactDigits(query);
  const blockDigits = compactDigits(blockText);
  if (queryDigits.length >= 2) {
    if (blockDigits === queryDigits) return 96;
    if (blockDigits.includes(queryDigits)) return 90 + Math.min(queryDigits.length, 10);
  }

  const queryWords = queryNorm.split(" ").filter((w) => w.length >= 3);
  if (queryWords.length > 0) {
    const hits = queryWords.filter((w) => blockNorm.includes(w)).length;
    return (hits / queryWords.length) * 55;
  }

  return 0;
}

function compareCandidates(
  a: OcrBlockMatch,
  b: OcrBlockMatch,
  options?: FindOcrBlockOptions,
): number {
  if (b.score !== a.score) return b.score - a.score;

  const yTol = options?.rowYTolerance ?? DEFAULT_ROW_Y_TOLERANCE;
  if (options?.rowAnchor) {
    const anchorY = centerY(options.rowAnchor);
    const aDist =
      a.region != null ? Math.abs(centerY(a.region) - anchorY) : Number.POSITIVE_INFINITY;
    const bDist =
      b.region != null ? Math.abs(centerY(b.region) - anchorY) : Number.POSITIVE_INFINITY;
    const aOnRow = aDist <= yTol;
    const bOnRow = bDist <= yTol;
    if (aOnRow !== bOnRow) return aOnRow ? -1 : 1;
    if (aDist !== bDist) return aDist - bDist;
  }

  if (options?.preferRightmost && a.region && b.region) {
    if (b.region.r !== a.region.r) return b.region.r - a.region.r;
    if (b.region.l !== a.region.l) return b.region.l - a.region.l;
  }

  return a.text.length - b.text.length;
}

function collectCandidates(
  pages: OcrPagePayload[],
  query: string,
  options?: FindOcrBlockOptions,
): OcrBlockMatch[] {
  const candidates: OcrBlockMatch[] = [];

  for (const page of pages) {
    if (options?.pageHint != null && options.pageHint > 0 && page.page !== options.pageHint) {
      continue;
    }

    for (const block of page.blocks) {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (text.length < 1) continue;
      const score = Math.max(scoreBlockText(text, query), scoreBlockText(query, text));
      if (score < 35) continue;
      candidates.push({
        text,
        page: page.page,
        region: block.region,
        blockId: block.id,
        score,
      });
    }
  }

  return candidates;
}

/** Resolve an OCR block (text + region) for a snippet or field value. */
export function findOcrBlockForSnippet(
  pages: OcrPagePayload[],
  snippet: string,
  options?: FindOcrBlockOptions,
): OcrBlockMatch | null {
  const query = snippet.trim();
  if (!query || pages.length === 0) return null;

  let candidates = collectCandidates(pages, query, options);
  if (candidates.length === 0 && options?.pageHint != null && options.pageHint > 0) {
    candidates = collectCandidates(pages, query, { ...options, pageHint: null });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => compareCandidates(a, b, options));
  return candidates[0] ?? null;
}

function ocrBlockDedupeKey(match: OcrBlockMatch): string {
  const region = match.region;
  const regionPart = region
    ? `${region.l},${region.t},${region.r},${region.b}`
    : "na";
  return `${match.page}::${regionPart}::${match.text}`;
}

/** All OCR block matches for a value (multiple pages and multiple positions per page). */
export function discoverOcrBlocksForValue(
  pages: OcrPagePayload[],
  snippet: string,
  options?: FindOcrBlockOptions & { maxTraces?: number },
): OcrBlockMatch[] {
  const query = snippet.trim();
  if (!query || pages.length === 0) return [];

  const maxTraces = options?.maxTraces ?? MAX_FIELD_TRACES;
  const candidates = collectCandidates(pages, query, { ...options, pageHint: null });
  candidates.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (b.score !== a.score) return b.score - a.score;
    const aTop = a.region?.t ?? 0;
    const bTop = b.region?.t ?? 0;
    if (aTop !== bTop) return aTop - bTop;
    return compareCandidates(a, b, options);
  });

  const seen = new Set<string>();
  const out: OcrBlockMatch[] = [];
  for (const match of candidates) {
    const key = ocrBlockDedupeKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
    if (out.length >= maxTraces) break;
  }

  return out;
}
