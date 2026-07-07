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
  /** Set when matching monetary values — prefers longer digit strings on score ties. */
  monetary?: boolean;
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

/** True when the search value is a numeric amount (digits with optional ., separators). */
export function isMonetaryQuery(query: string): boolean {
  return /^\d[\d.,\s]*$/.test(query.replace(/\s/g, ""));
}

function centerY(box: AbbyyBox): number {
  return (box.t + box.b) / 2;
}

function scoreMonetaryBlock(blockText: string, query: string): number {
  const blockNorm = normalize(blockText);
  const queryNorm = normalize(query);
  if (!blockNorm || !queryNorm) return 0;
  if (blockNorm === queryNorm) return 100;

  const queryDigits = compactDigits(query);
  const blockDigits = compactDigits(blockText);
  if (queryDigits.length < 2 || blockDigits.length < queryDigits.length) return 0;
  if (blockDigits === queryDigits) return 96;

  return 0;
}

function scoreBlockText(blockText: string, query: string): number {
  if (isMonetaryQuery(query)) {
    return scoreMonetaryBlock(blockText, query);
  }

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
  // Guard: block must be at least 6 chars and cover at least 40% of the query
  // to avoid single-word false positives matching multi-word phrases.
  if (
    blockCompact.length >= 6 &&
    blockCompact.length >= queryCompact.length * 0.4 &&
    queryCompact.includes(blockCompact)
  ) {
    const queryWordCount = queryNorm.split(" ").filter((w) => w.length >= 2).length;
    if (queryWordCount >= 2 && blockCompact.length < queryCompact.length * 0.55) {
      const hits = queryNorm.split(" ").filter((w) => w.length >= 3 && blockNorm.includes(w)).length;
      return queryWordCount > 0 ? (hits / queryWordCount) * 55 : 0;
    }
    return 72;
  }

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

  if (options?.monetary) return b.text.length - a.text.length;

  return a.text.length - b.text.length;
}

function collectCandidates(
  pages: OcrPagePayload[],
  query: string,
  options?: FindOcrBlockOptions,
): OcrBlockMatch[] {
  const candidates: OcrBlockMatch[] = [];
  const monetary = options?.monetary ?? isMonetaryQuery(query);

  for (const page of pages) {
    if (options?.pageHint != null && options.pageHint > 0 && page.page !== options.pageHint) {
      continue;
    }

    for (const block of page.blocks) {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (text.length < 1) continue;
      const score = monetary
        ? scoreBlockText(text, query)
        : Math.max(scoreBlockText(text, query), scoreBlockText(query, text));
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

function withMonetaryOptions(
  query: string,
  options?: FindOcrBlockOptions,
): FindOcrBlockOptions {
  const monetary = options?.monetary ?? isMonetaryQuery(query);
  return { ...options, monetary };
}

/** Resolve an OCR block (text + region) for a snippet or field value. */
export function findOcrBlockForSnippet(
  pages: OcrPagePayload[],
  snippet: string,
  options?: FindOcrBlockOptions,
): OcrBlockMatch | null {
  const query = snippet.trim();
  if (!query || pages.length === 0) return null;

  const resolvedOptions = withMonetaryOptions(query, options);
  let candidates = collectCandidates(pages, query, resolvedOptions);
  if (candidates.length === 0 && options?.pageHint != null && options.pageHint > 0) {
    candidates = collectCandidates(pages, query, { ...resolvedOptions, pageHint: null });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => compareCandidates(a, b, resolvedOptions));
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
  const minPageScore = minPageInclusionScore(query);
  const resolvedOptions = withMonetaryOptions(query, options);
  const candidates = collectCandidates(pages, query, { ...resolvedOptions, pageHint: null });
  if (candidates.length === 0) return [];

  const byPage = new Map<number, OcrBlockMatch[]>();
  for (const candidate of candidates) {
    const bucket = byPage.get(candidate.page) ?? [];
    bucket.push(candidate);
    byPage.set(candidate.page, bucket);
  }

  const seen = new Set<string>();
  const out: OcrBlockMatch[] = [];

  const pushMatch = (match: OcrBlockMatch) => {
    const key = ocrBlockDedupeKey(match);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(match);
  };

  const bestOnPage = (page: number): OcrBlockMatch =>
    [...byPage.get(page)!].sort((a, b) => compareCandidates(a, b, resolvedOptions))[0]!;

  // Phase 1: best match on each layout page index (guarantees multi-page coverage).
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const best = bestOnPage(page);
    if (best.score < minPageScore) continue;
    pushMatch(best);
    if (out.length >= maxTraces) return sortOcrBlockMatches(out);
  }

  // Phase 2: additional positions on the same page (header + footer), strong matches only.
  const STRONG_MATCH_SCORE = 85;
  const queryCompactLen = compactAlnum(query).length;
  const remaining = candidates
    .filter((candidate) => {
      if (candidate.score < STRONG_MATCH_SCORE) return false;
      if (seen.has(ocrBlockDedupeKey(candidate))) return false;
      if (queryCompactLen < 4) return true;
      return compactAlnum(candidate.text).length >= queryCompactLen * 0.55;
    })
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return compareCandidates(a, b, resolvedOptions);
    });

  for (const match of remaining) {
    pushMatch(match);
    if (out.length >= maxTraces) break;
  }

  return sortOcrBlockMatches(out);
}

function sortOcrBlockMatches(matches: OcrBlockMatch[]): OcrBlockMatch[] {
  return [...matches].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    return (a.region?.t ?? 0) - (b.region?.t ?? 0);
  });
}

/** Minimum best-on-page score to include a layout page in multi-location traces. */
function minPageInclusionScore(query: string): number {
  if (isMonetaryQuery(query)) return 96;
  const queryWords = normalize(query).split(" ").filter((w) => w.length >= 3);
  // Multi-word values need a majority word hit (55) or strong substring match (72+).
  if (queryWords.length >= 2) return 55;
  return 35;
}
