import { describe, expect, it } from "vitest";
import {
  formatTracePages,
  normalizeFieldTraces,
  primaryTracePages,
  tracesFromField,
} from "@/modules/extraction/domain/field-trace";

describe("field-trace", () => {
  it("normalizes traces array and deduplicates primary snippet", () => {
    const traces = normalizeFieldTraces(
      {
        traces: [
          { source_text: "Nama Pasien: Budi", page: 1 },
          { source_text: "Patient Name Budi", page: 3 },
        ],
      },
      { source_text: "Nama Pasien: Budi", page: 1 },
    );

    expect(traces).toHaveLength(2);
    expect(traces[0]).toEqual({ source_text: "Nama Pasien: Budi", page: 1 });
    expect(traces[1]).toEqual({ source_text: "Patient Name Budi", page: 3 });
  });

  it("falls back to primary source when traces missing", () => {
    expect(
      tracesFromField({ source_text: "Total 1.500.000", page: 2 }),
    ).toEqual([{ source_text: "Total 1.500.000", page: 2 }]);
  });

  it("formats multiple pages for display", () => {
    expect(
      formatTracePages({
        source_text: "Budi",
        page: 1,
        traces: [
          { source_text: "Budi", page: 1 },
          { source_text: "Budi", page: 4 },
        ],
      }),
    ).toBe("1, 4");
    expect(primaryTracePages({ source_text: "", page: null, traces: [] })).toEqual([]);
  });
});
