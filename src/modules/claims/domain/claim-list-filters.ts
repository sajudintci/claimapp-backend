export type ClaimListFilters = {
  organizationId: string;
  page: number;
  limit: number;
  status?: string;
  q?: string;
  reviewerId?: string;
  unassigned?: boolean;
  /** Inclusive lower bound on claim.createdAt (YYYY-MM-DD). */
  dateFrom?: string;
  /** Inclusive upper bound on claim.createdAt (YYYY-MM-DD). */
  dateTo?: string;
};

export type ParsedClaimListQuery = {
  page: number;
  limit: number;
  status?: string;
  q?: string;
  reviewerId?: string;
  unassigned: boolean;
  dateFrom?: string;
  dateTo?: string;
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

/** Normalize YYYY-MM-DD for claim.createdAt range filters. */
export function normalizeDateFilter(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return trimmed;
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
    dateFrom: normalizeDateFilter(query.dateFrom),
    dateTo: normalizeDateFilter(query.dateTo),
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
  documentFileName: string;
  patientName: string;
  documentType: string;
  priority: string;
  hospitalName: string;
  uploadDate: string;
  status: string;
  reviewerName: string;
};

export function buildClaimsCsv(rows: ClaimCsvRow[]): string {
  const header = [
    "Claim Ref",
    "Document",
    "Patient",
    "Document Type",
    "Priority",
    "Rumah Sakit",
    "Upload Date",
    "Status",
    "Reviewer",
  ];

  const lines = rows.map((row) =>
    [
      row.claimNumber,
      row.documentFileName,
      row.patientName,
      row.documentType,
      row.priority,
      row.hospitalName,
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
