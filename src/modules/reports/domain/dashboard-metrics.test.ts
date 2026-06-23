import { describe, expect, it } from "vitest";
import {
  buildConfidenceDistribution,
  buildWeeklyThroughput,
  formatActivityTitle,
  formatTrendPercent,
  isHighPriorityConfidence,
  readConfidencePercent,
  readExtractedPatientName,
  toDashboardDisplayStatus,
} from "@/modules/reports/domain/dashboard-metrics";

describe("dashboard-metrics domain", () => {
  it("maps claim statuses to dashboard display labels", () => {
    expect(toDashboardDisplayStatus("Draft")).toBe("Draft");
    expect(toDashboardDisplayStatus("Needs Attention")).toBe("Pending Review");
    expect(toDashboardDisplayStatus("Processing")).toBe("Extracting");
    expect(toDashboardDisplayStatus("Reviewed")).toBe("Approved");
  });

  it("normalizes confidence from extraction result payload", () => {
    expect(readConfidencePercent({ confidence: 0.87 })).toBe(87);
    expect(readConfidencePercent({ confidence: 72 })).toBe(72);
    expect(readConfidencePercent(null)).toBeNull();
  });

  it("flags low confidence as high priority", () => {
    expect(isHighPriorityConfidence(59)).toBe(true);
    expect(isHighPriorityConfidence(85)).toBe(false);
    expect(isHighPriorityConfidence(null)).toBe(false);
  });

  it("formats upload trend percentages", () => {
    expect(formatTrendPercent(11, 10)).toBe("+10,0%");
    expect(formatTrendPercent(9, 10)).toBe("-10,0%");
    expect(formatTrendPercent(3, 0)).toBe("+100%");
  });

  it("builds confidence distribution buckets", () => {
    const rows = buildConfidenceDistribution([
      { confidencePercent: 90 },
      { confidencePercent: 70 },
      { confidencePercent: 40 },
    ]);

    expect(rows).toEqual([
      { label: "High Confidence", pct: 33, count: 1 },
      { label: "Needs Verification", pct: 33, count: 1 },
      { label: "Missing or Unreadable", pct: 33, count: 1 },
    ]);
  });

  it("builds weekly throughput from claim timestamps", () => {
    const now = new Date("2026-06-19T15:00:00.000Z");
    const createdAt = new Date("2026-06-19T10:00:00.000Z");
    const updatedAt = new Date("2026-06-18T10:00:00.000Z");

    const throughput = buildWeeklyThroughput(
      [
        { createdAt, updatedAt: createdAt, status: "Processing" },
        { createdAt: updatedAt, updatedAt, status: "Reviewed" },
      ],
      now,
    );

    expect(throughput).toHaveLength(7);
    expect(throughput[throughput.length - 1]?.uploaded).toBe(1);
    expect(throughput[throughput.length - 2]?.processed).toBe(1);
  });

  it("formats activity titles for common audit actions", () => {
    expect(
      formatActivityTitle({ action: "CLAIM_ASSIGNED", entityId: "CLM-2026-04128" }),
    ).toBe("CLM-2026-04128 assigned to you");
    expect(
      formatActivityTitle({ action: "EXTRACTION_STARTED", entityId: "CLM-2026-04129" }),
    ).toBe("CLM-2026-04129 extraction started");
  });

  it("reads patient name from extraction patient.name only", () => {
    expect(
      readExtractedPatientName({
        summary: { insuredName: "From Summary" },
        claims: [{ patient: { name: { value: "Dewi Susanti" } } }],
      }),
    ).toBe("Dewi Susanti");

    expect(
      readExtractedPatientName({
        summary: { insuredName: "From Summary" },
        claims: [{ patient: { name: { value: "not_found" } } }],
      }),
    ).toBe("not_found");

    expect(readExtractedPatientName(null)).toBe("not_found");
  });

  it("reads patient name from structuredData.claims when root claims are absent", () => {
    expect(
      readExtractedPatientName({
        structuredData: {
          claims: [{ patient: { name: { value: "Via Structured Data" } } }],
        },
      }),
    ).toBe("Via Structured Data");
  });
});
