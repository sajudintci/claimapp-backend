export type ClaimStatusValue =
  | "Processing"
  | "Extracted"
  | "Draft"
  | "Reviewed"
  | "Needs Attention"
  | "Failed"
  | "Archived";

export type DashboardDisplayStatus =
  | "Pending Review"
  | "Pending Approval"
  | "Extracting"
  | "Draft"
  | "Approved"
  | "Rejected";

export type DashboardKpiMetrics = {
  totalUploaded: number;
  pendingReview: number;
  pendingApproval: number;
  approved: number;
  highPriorityCount: number;
  dueTodayCount: number;
  approvalRate: number;
  uploadTrend: string;
};

export type DashboardWorkQueueItem = {
  id: string;
  claimNumber: string;
  patientName: string;
  provider: string;
  status: ClaimStatusValue;
  displayStatus: DashboardDisplayStatus;
  submittedAt: string;
};

export type DashboardActivityItem = {
  id: string;
  title: string;
  actorName: string | null;
  createdAt: string;
};

export type DashboardQualityBucket = {
  label: string;
  pct: number;
  count: number;
};

export type DashboardThroughputDay = {
  label: string;
  uploaded: number;
  processed: number;
};

export type DashboardMetricsDto = {
  kpis: DashboardKpiMetrics;
  workQueue: DashboardWorkQueueItem[];
  recentActivity: DashboardActivityItem[];
  extractionQuality: DashboardQualityBucket[];
  throughput: DashboardThroughputDay[];
};

export type ClaimThroughputInput = {
  createdAt: Date;
  updatedAt: Date;
  status: string;
};

export type ClaimConfidenceInput = {
  confidencePercent: number | null;
};

const displayStatusMap: Record<ClaimStatusValue, DashboardDisplayStatus> = {
  Processing: "Extracting",
  Extracted: "Pending Approval",
  Draft: "Draft",
  "Needs Attention": "Pending Review",
  Reviewed: "Approved",
  Failed: "Rejected",
  Archived: "Approved",
};

export function toDashboardDisplayStatus(status: string): DashboardDisplayStatus {
  return displayStatusMap[status as ClaimStatusValue] ?? "Pending Review";
}

export function readConfidencePercent(extractionResult: Record<string, unknown> | null): number | null {
  if (!extractionResult) return null;
  const raw = extractionResult.confidence;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw <= 1) return Math.max(0, Math.min(100, Math.round(raw * 100)));
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function isHighPriorityConfidence(confidencePercent: number | null): boolean {
  return confidencePercent != null && confidencePercent > 0 && confidencePercent < 60;
}

export function formatTrendPercent(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? "+100%" : "+0%";
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}%`;
}

export function formatActivityTitle(params: {
  action: string;
  entityId: string | null;
}): string {
  const claimRef = params.entityId?.startsWith("CLM-")
    ? params.entityId
    : params.entityId
      ? `Claim ${params.entityId.slice(0, 8)}`
      : "Workflow event";

  const action = params.action.toLowerCase().replace(/_/g, " ");
  if (action.includes("assign")) return `${claimRef} assigned to you`;
  if (action.includes("approv")) return `${claimRef} ready for approval`;
  if (action.includes("extract") && action.includes("start")) return `${claimRef} extraction started`;
  if (action.includes("review") || action.includes("correct")) return `${claimRef} needs correction`;
  if (action.includes("upload")) return `${claimRef} uploaded`;
  if (action.includes("fail")) return `${claimRef} extraction failed`;

  return `${claimRef} ${action}`;
}

export function buildConfidenceDistribution(claims: ClaimConfidenceInput[]): DashboardQualityBucket[] {
  const withConfidence = claims.filter((claim) => claim.confidencePercent != null && claim.confidencePercent > 0);
  const total = withConfidence.length;

  if (total === 0) {
    return [
      { label: "High Confidence", pct: 0, count: 0 },
      { label: "Needs Verification", pct: 0, count: 0 },
      { label: "Missing or Unreadable", pct: 0, count: 0 },
    ];
  }

  const high = withConfidence.filter((claim) => (claim.confidencePercent ?? 0) >= 85).length;
  const needsVerification = withConfidence.filter(
    (claim) => (claim.confidencePercent ?? 0) >= 60 && (claim.confidencePercent ?? 0) < 85,
  ).length;
  const missing = withConfidence.filter((claim) => (claim.confidencePercent ?? 0) < 60).length;

  return [
    { label: "High Confidence", pct: Math.round((high / total) * 100), count: high },
    { label: "Needs Verification", pct: Math.round((needsVerification / total) * 100), count: needsVerification },
    { label: "Missing or Unreadable", pct: Math.round((missing / total) * 100), count: missing },
  ];
}

export function startOfLocalDay(base: Date, offsetDays = 0): Date {
  const day = new Date(base);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offsetDays);
  return day;
}

export function buildWeeklyThroughput(
  claims: ClaimThroughputInput[],
  now: Date = new Date(),
): DashboardThroughputDay[] {
  const days: DashboardThroughputDay[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const start = startOfLocalDay(now, -offset);
    const end = startOfLocalDay(now, -offset + 1);

    const uploaded = claims.filter((claim) => claim.createdAt >= start && claim.createdAt < end).length;
    const processed = claims.filter(
      (claim) => claim.status === "Reviewed" && claim.updatedAt >= start && claim.updatedAt < end,
    ).length;

    days.push({
      label: start.toLocaleDateString("en-US", { weekday: "short" }),
      uploaded,
      processed,
    });
  }

  return days;
}

export function readClaimSummary(
  extractionResult: Record<string, unknown> | null,
): { patientName: string; provider: string } {
  const summary =
    extractionResult?.summary && typeof extractionResult.summary === "object"
      ? (extractionResult.summary as Record<string, unknown>)
      : null;

  const patientName =
    typeof summary?.insuredName === "string" && summary.insuredName.trim()
      ? summary.insuredName.trim()
      : "—";
  const provider =
    typeof summary?.provider === "string" && summary.provider.trim() ? summary.provider.trim() : "—";

  return { patientName, provider };
}
