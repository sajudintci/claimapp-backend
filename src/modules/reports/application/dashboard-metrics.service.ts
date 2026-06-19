import { Op } from "sequelize";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { ClaimModel } from "@/database/models/claim.model";
import { UserModel } from "@/database/models/user.model";
import { mapAuditLogRow } from "@/modules/audit/application/audit-mapper";
import {
  buildConfidenceDistribution,
  buildWeeklyThroughput,
  DashboardMetricsDto,
  formatActivityTitle,
  formatTrendPercent,
  isHighPriorityConfidence,
  readClaimSummary,
  readConfidencePercent,
  startOfLocalDay,
  toDashboardDisplayStatus,
  type ClaimStatusValue,
} from "@/modules/reports/domain/dashboard-metrics";

const WORK_QUEUE_STATUSES = [
  "Needs Attention",
  "Draft",
  "Extracted",
  "Processing",
  "Failed",
  "Reviewed",
] as const;

export async function getDashboardMetrics(organizationId: string): Promise<DashboardMetricsDto> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = startOfLocalDay(now, 1);
  const weekStart = startOfLocalDay(now, -6);
  const previousWeekStart = startOfLocalDay(now, -13);
  const previousWeekEnd = startOfLocalDay(now, -6);

  const orgWhere = { organizationId };

  const [
    totalUploaded,
    pendingReview,
    pendingApproval,
    approved,
    recentUploadCount,
    previousUploadCount,
    workQueueRows,
    activityRows,
    weekClaims,
    throughputClaims,
    attentionRows,
    dueTodayCount,
  ] = await Promise.all([
    ClaimModel.count({ where: orgWhere }),
    ClaimModel.count({ where: { ...orgWhere, status: "Needs Attention" } }),
    ClaimModel.count({
      where: { ...orgWhere, status: { [Op.in]: ["Extracted", "Draft"] } },
    }),
    ClaimModel.count({ where: { ...orgWhere, status: "Reviewed" } }),
    ClaimModel.count({
      where: {
        ...orgWhere,
        createdAt: { [Op.gte]: startOfLocalDay(now, -6), [Op.lt]: tomorrowStart },
      },
    }),
    ClaimModel.count({
      where: {
        ...orgWhere,
        createdAt: { [Op.gte]: previousWeekStart, [Op.lt]: previousWeekEnd },
      },
    }),
    ClaimModel.findAll({
      where: {
        ...orgWhere,
        status: { [Op.in]: [...WORK_QUEUE_STATUSES] },
      },
      attributes: ["id", "claimNumber", "status", "extractionResult", "createdAt"],
      order: [["updatedAt", "DESC"]],
      limit: 5,
    }),
    AuditLogModel.findAll({
      where: orgWhere,
      include: [{ model: UserModel, attributes: ["id", "name", "email"], required: false }],
      order: [["createdAt", "DESC"]],
      limit: 4,
    }),
    ClaimModel.findAll({
      where: {
        ...orgWhere,
        createdAt: { [Op.gte]: weekStart },
      },
      attributes: ["extractionResult"],
    }),
    ClaimModel.findAll({
      where: {
        ...orgWhere,
        [Op.or]: [
          { createdAt: { [Op.gte]: weekStart } },
          { updatedAt: { [Op.gte]: weekStart }, status: "Reviewed" },
        ],
      },
      attributes: ["createdAt", "updatedAt", "status"],
    }),
    ClaimModel.findAll({
      where: { ...orgWhere, status: "Needs Attention" },
      attributes: ["extractionResult"],
    }),
    ClaimModel.count({
      where: {
        ...orgWhere,
        status: "Extracted",
        createdAt: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart },
      },
    }),
  ]);

  const highPriorityCount = attentionRows.filter((row) =>
    isHighPriorityConfidence(readConfidencePercent(row.extractionResult)),
  ).length;

  const approvalRate =
    totalUploaded > 0 ? Math.round((approved / totalUploaded) * 1000) / 10 : 0;

  const workQueue = workQueueRows.map((row) => {
    const summary = readClaimSummary(row.extractionResult);
    return {
      id: row.id,
      claimNumber: row.claimNumber,
      patientName: summary.patientName,
      provider: summary.provider,
      status: row.status as ClaimStatusValue,
      displayStatus: toDashboardDisplayStatus(row.status),
      submittedAt: row.createdAt.toISOString(),
    };
  });

  const recentActivity = activityRows.map((row) => {
    const dto = mapAuditLogRow(row);
    return {
      id: dto.id,
      title: formatActivityTitle({ action: dto.action, entityId: dto.entityId }),
      actorName: dto.actorName,
      createdAt: dto.createdAt,
    };
  });

  const extractionQuality = buildConfidenceDistribution(
    weekClaims.map((row) => ({
      confidencePercent: readConfidencePercent(row.extractionResult),
    })),
  );

  const throughput = buildWeeklyThroughput(
    throughputClaims.map((row) => ({
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      status: row.status,
    })),
    now,
  );

  return {
    kpis: {
      totalUploaded,
      pendingReview,
      pendingApproval,
      approved,
      highPriorityCount,
      dueTodayCount,
      approvalRate,
      uploadTrend: formatTrendPercent(recentUploadCount, previousUploadCount),
    },
    workQueue,
    recentActivity,
    extractionQuality,
    throughput,
  };
}
