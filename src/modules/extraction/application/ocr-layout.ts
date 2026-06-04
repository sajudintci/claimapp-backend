export type AbbyyBox = {
  l: number;
  t: number;
  r: number;
  b: number;
};

export type OcrLinePayload = {
  text: string;
  confidence: number;
  region?: AbbyyBox;
  source: "text" | "table";
};

export type OcrRowPayload = {
  text: string;
  confidence: number;
  region?: AbbyyBox;
  lineIndexes: number[];
};

export type OcrPairPayload = {
  key: string;
  label: string;
  value: string;
  text: string;
  confidence: number;
  region?: AbbyyBox;
};

export type OcrTableCellPayload = {
  col: number;
  row: number;
  text: string;
  confidence: number;
  region?: AbbyyBox;
};

export type OcrTableRowPayload = {
  row: number;
  cells: OcrTableCellPayload[];
};

export type OcrTablePayload = {
  region?: AbbyyBox;
  rows: OcrTableRowPayload[];
};

/** Per-page structured OCR stored in extraction payload (schema v3). */
export type OcrStructuredPagePayload = {
  page: number;
  width?: number;
  height?: number;
  rotated?: string;
  lines: OcrLinePayload[];
  rows: OcrRowPayload[];
  pairs: OcrPairPayload[];
  tables: OcrTablePayload[];
  /** Flat row/line strings for highlight search (parallel to `regions`). */
  linesFlat: string[];
  regions: Array<AbbyyBox | undefined>;
};

export type LayoutLineInput = {
  text: string;
  confidence: number;
  position?: AbbyyBox;
  source: "text" | "table";
};

function slugKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "field";
}

export function unionBoxes(boxes: AbbyyBox[]): AbbyyBox | undefined {
  if (boxes.length === 0) return undefined;
  return {
    l: Math.min(...boxes.map((b) => b.l)),
    t: Math.min(...boxes.map((b) => b.t)),
    r: Math.max(...boxes.map((b) => b.r)),
    b: Math.max(...boxes.map((b) => b.b)),
  };
}

function centerY(box: AbbyyBox): number {
  return (box.t + box.b) / 2;
}

function lineHeight(box: AbbyyBox): number {
  return Math.max(box.b - box.t, 1);
}

function sameVisualRow(a: AbbyyBox, b: AbbyyBox): boolean {
  const overlap = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  const minH = Math.min(lineHeight(a), lineHeight(b));
  if (minH > 0 && overlap / minH >= 0.4) return true;
  return Math.abs(centerY(a) - centerY(b)) <= Math.max(10, minH * 0.6);
}

/** Cluster lines into visual rows (sorted top→bottom, left→right within row). */
export function buildRowsFromLines(lines: LayoutLineInput[]): OcrRowPayload[] {
  const withBox = lines
    .map((line, index) => ({ line, index }))
    .filter((x) => x.line.position);

  const withoutBox = lines
    .map((line, index) => ({ line, index }))
    .filter((x) => !x.line.position);

  const sorted = [...withBox].sort(
    (a, b) =>
      centerY(a.line.position!) - centerY(b.line.position!) ||
      a.line.position!.l - b.line.position!.l,
  );

  const clusters: Array<Array<{ line: LayoutLineInput; index: number }>> = [];

  for (const item of sorted) {
    const box = item.line.position!;
    let placed = false;
    for (const cluster of clusters) {
      const ref = cluster[0]!.line.position!;
      if (sameVisualRow(ref, box)) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }

  const rows: OcrRowPayload[] = clusters.map((cluster) => {
    cluster.sort((a, b) => a.line.position!.l - b.line.position!.l);
    const texts = cluster.map((c) => c.line.text);
    const text = texts
      .join(" ")
      .replace(/\s*:\s*/g, " : ")
      .replace(/\s+/g, " ")
      .trim();
    const boxes = cluster.map((c) => c.line.position!).filter(Boolean) as AbbyyBox[];
    const confidences = cluster.map((c) => c.line.confidence);
    return {
      text,
      confidence: confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0,
      region: unionBoxes(boxes),
      lineIndexes: cluster.map((c) => c.index),
    };
  });

  for (const item of withoutBox) {
    rows.push({
      text: item.line.text,
      confidence: item.line.confidence,
      region: undefined,
      lineIndexes: [item.index],
    });
  }

  return rows.sort((a, b) => {
    if (a.region && b.region) return centerY(a.region) - centerY(b.region);
    if (a.region) return -1;
    if (b.region) return 1;
    return 0;
  });
}

const PAIR_LINE_RE = /^(.{1,80}?)\s*:\s*(.+)$/u;
const AMOUNT_RE = /^[\d.,]+(?:\s*(?:rb|rp))?$/i;
const LABEL_HINTS =
  /^(nama|name|nominal|jumlah|total|tanggal|tgl|patient|pasien|policy|polis|claim|klaim|diagnosis|provider|dokter|amount|biaya|qty|quantity)/i;

function pairFromRowText(row: OcrRowPayload): OcrPairPayload | null {
  const m = row.text.match(PAIR_LINE_RE);
  if (!m?.[1] || !m[2]) return null;
  const label = m[1].trim();
  const value = m[2].trim();
  if (label.length < 2 || value.length < 1) return null;
  return {
    key: slugKey(label),
    label,
    value,
    text: row.text,
    confidence: row.confidence,
    region: row.region,
  };
}

/** Label on one row, value on the next row (aligned columns). */
function pairsFromStackedRows(rows: OcrRowPayload[]): OcrPairPayload[] {
  const pairs: OcrPairPayload[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const top = rows[i]!;
    const bottom = rows[i + 1]!;
    if (!top.region || !bottom.region) continue;
    if (PAIR_LINE_RE.test(top.text) || PAIR_LINE_RE.test(bottom.text)) continue;

    const topIsLabel =
      top.text.endsWith(":") ||
      LABEL_HINTS.test(top.text) ||
      (!AMOUNT_RE.test(top.text) && top.text.length <= 40);
    const bottomIsValue =
      AMOUNT_RE.test(bottom.text) ||
      (!LABEL_HINTS.test(bottom.text) && bottom.text.length <= 60);

    const colAligned = Math.abs(top.region.l - bottom.region.l) < 120;
    if (!topIsLabel || !bottomIsValue || !colAligned) continue;

    const label = top.text.replace(/:$/, "").trim();
    const value = bottom.text.trim();
    pairs.push({
      key: slugKey(label),
      label,
      value,
      text: `${label} : ${value}`,
      confidence: Math.min(top.confidence, bottom.confidence),
      region: unionBoxes([top.region, bottom.region]),
    });
  }
  return pairs;
}

export function buildPairsFromRows(rows: OcrRowPayload[]): OcrPairPayload[] {
  const pairs: OcrPairPayload[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const p = pairFromRowText(row);
    if (!p || seen.has(p.key)) continue;
    seen.add(p.key);
    pairs.push(p);
  }

  for (const p of pairsFromStackedRows(rows)) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    pairs.push(p);
  }

  return pairs;
}

export type AbbyyTableCellInput = {
  lines?: Array<{ text?: string; confidence?: unknown; position?: AbbyyBox }>;
  position?: AbbyyBox;
  colRowPosition?: { l?: number; t?: number; r?: number; b?: number };
};

export type AbbyyTableInput = {
  position?: AbbyyBox;
  cells?: AbbyyTableCellInput[];
};

function cellGridKey(cell: AbbyyTableCellInput): { row: number; col: number } | null {
  const cr = cell.colRowPosition;
  if (!cr || typeof cr !== "object") return null;
  const col = Number(cr.l);
  const row = Number(cr.t);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  return { row, col };
}

function joinCellLines(cell: AbbyyTableCellInput): {
  text: string;
  confidence: number;
  region?: AbbyyBox;
} {
  const parts: string[] = [];
  let confSum = 0;
  let confN = 0;
  const boxes: AbbyyBox[] = [];
  const cellBox = cell.position;

  for (const line of cell.lines ?? []) {
    const t = String(line.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length < 1) continue;
    parts.push(t);
    const c = Number(line.confidence);
    if (Number.isFinite(c)) {
      confSum += c > 1 ? c / 100 : c;
      confN++;
    }
    const lb = line.position;
    if (lb && lb.r > lb.l && lb.b > lb.t) boxes.push(lb);
  }

  if (cellBox && cellBox.r > cellBox.l && cellBox.b > cellBox.t) {
    boxes.push(cellBox);
  }

  const text = parts.join(" ").trim();
  return {
    text,
    confidence: confN > 0 ? confSum / confN : 0,
    region: unionBoxes(boxes),
  };
}

export function buildTablesFromAbbyy(tables: AbbyyTableInput[]): OcrTablePayload[] {
  const out: OcrTablePayload[] = [];

  for (const table of tables) {
    if (!table.cells?.length) continue;

    const cellMap = new Map<string, OcrTableCellPayload>();

    for (const cell of table.cells) {
      const grid = cellGridKey(cell);
      const joined = joinCellLines(cell);
      if (!joined.text || joined.text.length < 1) continue;

      const row = grid?.row ?? 0;
      const col = grid?.col ?? 0;
      const key = `${row}-${col}`;

      const existing = cellMap.get(key);
      if (existing) {
        existing.text = `${existing.text} ${joined.text}`.trim();
        existing.confidence = (existing.confidence + joined.confidence) / 2;
        if (existing.region && joined.region) {
          existing.region = unionBoxes([existing.region, joined.region]);
        } else {
          existing.region = existing.region ?? joined.region;
        }
      } else {
        cellMap.set(key, {
          row,
          col,
          text: joined.text,
          confidence: joined.confidence,
          region: joined.region,
        });
      }
    }

    if (cellMap.size === 0) continue;

    const rowIndices = [...new Set([...cellMap.values()].map((c) => c.row))].sort(
      (a, b) => a - b,
    );

    const tableRows: OcrTableRowPayload[] = rowIndices.map((rowIndex) => ({
      row: rowIndex,
      cells: [...cellMap.values()]
        .filter((c) => c.row === rowIndex)
        .sort((a, b) => a.col - b.col),
    }));

    out.push({
      region: table.position,
      rows: tableRows,
    });
  }

  return out;
}

export function renderPagePlainText(page: {
  page: number;
  rows: OcrRowPayload[];
  tables: OcrTablePayload[];
  lines: OcrLinePayload[];
}): string {
  const parts: string[] = [`--- Page ${page.page} ---`];

  if (page.rows.length > 0) {
    for (const row of page.rows) {
      parts.push(row.text);
    }
  } else {
    for (const line of page.lines) {
      parts.push(line.text);
    }
  }

  for (const table of page.tables) {
    parts.push("[TABLE]");
    for (const tr of table.rows) {
      const cols = tr.cells.map((c) => c.text).filter(Boolean);
      if (cols.length) parts.push(cols.join(" | "));
    }
  }

  return parts.join("\n");
}

/** Flat string lines for backward-compatible consumers. */
export function flatLinesFromPage(page: {
  rows: OcrRowPayload[];
  lines: OcrLinePayload[];
}): string[] {
  if (page.rows.length > 0) return page.rows.map((r) => r.text);
  return page.lines.map((l) => l.text);
}

/** Regions parallel to flat lines (row-based when available). */
export function flatRegionsFromPage(page: {
  rows: OcrRowPayload[];
  lines: OcrLinePayload[];
}): Array<AbbyyBox | undefined> {
  if (page.rows.length > 0) return page.rows.map((r) => r.region);
  return page.lines.map((l) => l.region);
}
