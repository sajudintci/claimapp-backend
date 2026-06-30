import type { FieldTrace, TracedField } from "@/modules/extraction/domain/extraction-schema";

export const MAX_FIELD_TRACES = 8;
export const MAX_TRACE_SOURCE_CHARS = 400;

/** Dedupe key: same page + source_text can have multiple regions (e.g. header/footer). */
export function traceDedupeKey(trace: FieldTrace): string {
  const region = trace.region;
  const regionPart = region
    ? `${region.l},${region.t},${region.r},${region.b}`
    : "na";
  return `${trace.page ?? "na"}::${regionPart}::${trace.source_text}`;
}

export function mergeTraceLists(...lists: FieldTrace[][]): FieldTrace[] {
  const seen = new Set<string>();
  const out: FieldTrace[] = [];

  for (const list of lists) {
    for (const trace of list) {
      if (trace.page == null || trace.page <= 0) continue;
      const key = traceDedupeKey(trace);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trace);
      if (out.length >= MAX_FIELD_TRACES) return out;
    }
  }

  return out.sort((a, b) => {
    const pageA = a.page ?? 0;
    const pageB = b.page ?? 0;
    if (pageA !== pageB) return pageA - pageB;
    return (a.region?.t ?? 0) - (b.region?.t ?? 0);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRegion(input: unknown): FieldTrace["region"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const l = Number((input as { l?: unknown }).l);
  const t = Number((input as { t?: unknown }).t);
  const r = Number((input as { r?: unknown }).r);
  const b = Number((input as { b?: unknown }).b);
  if (![l, t, r, b].every(Number.isFinite)) return undefined;
  if (r <= l || b <= t) return undefined;
  return { l, t, r, b };
}

function normalizeTraceEntry(input: unknown): FieldTrace | null {
  if (!isObject(input)) return null;
  const source_text =
    typeof input.source_text === "string"
      ? input.source_text.trim().slice(0, MAX_TRACE_SOURCE_CHARS)
      : "";
  const page = typeof input.page === "number" && input.page > 0 ? input.page : null;
  if (!source_text) return null;
  const region = parseRegion(input.region);
  return region ? { source_text, page, region } : { source_text, page };
}

/** Normalize traces from LLM input; always includes primary source_text/page when present. */
export function normalizeFieldTraces(
  input: unknown,
  primary: { source_text: string; page: number | null },
): FieldTrace[] {
  const seen = new Set<string>();
  const traces: FieldTrace[] = [];

  const push = (trace: FieldTrace | null) => {
    if (!trace) return;
    const key = traceDedupeKey(trace);
    if (seen.has(key)) return;
    seen.add(key);
    traces.push(trace);
  };

  if (isObject(input) && Array.isArray(input.traces)) {
    for (const entry of input.traces) {
      push(normalizeTraceEntry(entry));
      if (traces.length >= MAX_FIELD_TRACES) break;
    }
  }

  push(
    primary.source_text.trim()
      ? { source_text: primary.source_text.trim().slice(0, MAX_TRACE_SOURCE_CHARS), page: primary.page }
      : null,
  );

  return traces.slice(0, MAX_FIELD_TRACES);
}

export function tracesFromField(field: Pick<TracedField, "source_text" | "page" | "traces">): FieldTrace[] {
  if (field.traces && field.traces.length > 0) return field.traces;
  if (field.source_text.trim()) {
    return [{ source_text: field.source_text, page: field.page }];
  }
  return [];
}

export function primaryTracePages(field: Pick<TracedField, "source_text" | "page" | "traces">): number[] {
  const pages = new Set<number>();
  for (const trace of tracesFromField(field)) {
    if (trace.page != null && trace.page > 0) pages.add(trace.page);
  }
  if (pages.size === 0 && field.page != null && field.page > 0) pages.add(field.page);
  return Array.from(pages).sort((a, b) => a - b);
}

export function formatTracePages(field: Pick<TracedField, "source_text" | "page" | "traces">): string {
  const pages = primaryTracePages(field);
  if (pages.length === 0) return "-";
  if (pages.length === 1) return String(pages[0]);
  return pages.join(", ");
}

export function attachTracesToField(field: TracedField): TracedField {
  const traces = tracesFromField(field);
  if (traces.length === 0) return field;
  const primary = traces[0]!;
  return {
    ...field,
    source_text: field.source_text || primary.source_text,
    page: field.page ?? primary.page,
    traces,
  };
}
