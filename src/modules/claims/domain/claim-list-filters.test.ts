import { describe, expect, it } from "vitest";
import {
  buildClaimsCsv,
  normalizeDateFilter,
  normalizeReviewerFilter,
  normalizeSearchQuery,
  normalizeStatusFilter,
  parseClaimListQuery,
  toIlikePattern,
} from "@/modules/claims/domain/claim-list-filters";

describe("claim-list-filters", () => {
  it("parses list query params", () => {
    expect(
      parseClaimListQuery({
        page: "2",
        limit: "15",
        status: "Reviewed",
        q: "  dewi  ",
        reviewer: "unassigned",
      }),
    ).toEqual({
      page: 2,
      limit: 15,
      status: "Reviewed",
      q: "dewi",
      reviewerId: undefined,
      unassigned: true,
    });
  });

  it("rejects invalid status values", () => {
    expect(normalizeStatusFilter("Invalid")).toBeUndefined();
    expect(normalizeStatusFilter("Needs Attention")).toBe("Needs Attention");
  });

  it("normalizes reviewer filter values", () => {
    expect(normalizeReviewerFilter("unassigned")).toEqual({ unassigned: true });
    expect(normalizeReviewerFilter("user-123")).toEqual({
      reviewerId: "user-123",
      unassigned: false,
    });
  });

  it("normalizes createdAt date filters", () => {
    expect(normalizeDateFilter("2026-06-20")).toBe("2026-06-20");
    expect(normalizeDateFilter("2026-13-01")).toBeUndefined();
    expect(normalizeDateFilter("invalid")).toBeUndefined();
  });

  it("parses createdAt date range query params", () => {
    expect(
      parseClaimListQuery({
        page: "1",
        limit: "10",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      }),
    ).toMatchObject({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
  });

  it("truncates long search queries", () => {
    const long = "a".repeat(250);
    expect(normalizeSearchQuery(long)?.length).toBe(200);
  });

  it("escapes ilike wildcard characters", () => {
    expect(toIlikePattern("100%")).toBe("%100\\%%");
  });

  it("builds csv export", () => {
    const csv = buildClaimsCsv([
      {
        claimNumber: "CLM-1",
        documentFileName: "file,one.pdf",
        patientName: "Dewi",
        documentType: "Inpatient Claim",
        priority: "Normal",
        hospitalName: "RS Martha Friska",
        uploadDate: "2026-06-22",
        status: "Reviewed",
        reviewerName: "Sarah",
      },
    ]);

    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"file,one.pdf"');
  });
});
