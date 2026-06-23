import type { FieldTrace, TracedField } from "@/modules/extraction/domain/extraction-schema";

export const MAX_FIELD_TRACES = 8;
export const MAX_TRACE_SOURCE_CHARS = 400;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTraceEntry(input: unknown): FieldTrace | null {
  if (!isObject(input)) return null;
  const source_text =
    typeof input.source_text === "string"
      ? input.source_text.trim().slice(0, MAX_TRACE_SOURCE_CHARS)
      : "";
  const page = typeof input.page === "number" && input.page > 0 ? input.page : null;
  if (!source_text) return null;
  return { source_text, page };
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
    const key = `${trace.page ?? "na"}::${trace.source_text}`;
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
