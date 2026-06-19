export type ClaimListFilters = {
  organizationId: string;
  page: number;
  limit: number;
  status?: string;
  q?: string;
  reviewerId?: string;
  unassigned?: boolean;
};

export type ParsedClaimListQuery = {
  page: number;
  limit: number;
  status?: string;
  q?: string;
  reviewerId?: string;
  unassigned: boolean;
};

const VALID_STATUSES = new Set([
  "Processing",
  "Extracted",
  "Draft",
  "Reviewed",
  "Needs Attention",
  "Failed",
  "Archived",
]);

export function normalizeSearchQuery(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 200);
}

export function normalizeStatusFilter(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !VALID_STATUSES.has(trimmed)) return undefined;
  return trimmed;
}

export function normalizeReviewerFilter(raw: unknown): { reviewerId?: string; unassigned: boolean } {
  if (typeof raw !== "string") return { unassigned: false };
  const trimmed = raw.trim();
  if (!trimmed) return { unassigned: false };
  if (trimmed === "unassigned") return { unassigned: true };
  return { reviewerId: trimmed, unassigned: false };
}

export function parseClaimListQuery(query: Record<string, unknown>): ParsedClaimListQuery {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const reviewer = normalizeReviewerFilter(query.reviewer ?? query.reviewerId);

  return {
    page,
    limit,
    status: normalizeStatusFilter(query.status),
    q: normalizeSearchQuery(query.q),
    reviewerId: reviewer.reviewerId,
    unassigned: reviewer.unassigned,
  };
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export function toIlikePattern(value: string): string {
  return `%${escapeIlikePattern(value)}%`;
}

export type ClaimCsvRow = {
  claimNumber: string;
  claimDate: string;
  documentFileName: string;
  patientName: string;
  provider: string;
  uploadDate: string;
  status: string;
  reviewerName: string;
};

export function buildClaimsCsv(rows: ClaimCsvRow[]): string {
  const header = [
    "Claim Ref",
    "Claim Date",
    "Document",
    "Patient",
    "Provider",
    "Upload Date",
    "Status",
    "Reviewer",
  ];

  const lines = rows.map((row) =>
    [
      row.claimNumber,
      row.claimDate,
      row.documentFileName,
      row.patientName,
      row.provider,
      row.uploadDate,
      row.status,
      row.reviewerName,
    ]
      .map(csvEscape)
      .join(","),
  );

  return [header.join(","), ...lines].join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
