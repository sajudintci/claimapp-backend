import { Op, type WhereOptions } from "sequelize";
import { sequelize } from "@/database/sequelize";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ClaimModel } from "@/database/models/claim.model";
import { UserModel } from "@/database/models/user.model";
import { mapClaimListItem, type ClaimListItemDto } from "@/modules/claims/application/claim-list-mapper";
import {
  buildClaimsCsv,
  type ClaimCsvRow,
  type ClaimListFilters,
  toIlikePattern,
} from "@/modules/claims/domain/claim-list-filters";
import { toPagination } from "@/utils/pagination";

const EXPORT_LIMIT = 1000;

function buildSearchWhere(needle: string): WhereOptions {
  const pattern = toIlikePattern(needle);
  const escaped = sequelize.escape(pattern);

  return {
    [Op.or]: [
      { claimNumber: { [Op.iLike]: pattern } },
      sequelize.literal(`"ClaimModel"."extractionResult"->'summary'->>'insuredName' ILIKE ${escaped}`),
      sequelize.literal(`"ClaimModel"."extractionResult"->'summary'->>'provider' ILIKE ${escaped}`),
      sequelize.literal(
        `EXISTS (SELECT 1 FROM claim_documents cd WHERE cd."claimId" = "ClaimModel"."id" AND cd."deletedAt" IS NULL AND cd."originalName" ILIKE ${escaped})`,
      ),
    ],
  };
}

function buildWhere(filters: ClaimListFilters): WhereOptions {
  const where: WhereOptions = { organizationId: filters.organizationId };

  if (filters.status) {
    Object.assign(where, { status: filters.status });
  }

  if (filters.unassigned) {
    Object.assign(where, { reviewerId: null });
  } else if (filters.reviewerId) {
    Object.assign(where, { reviewerId: filters.reviewerId });
  }

  if (filters.q) {
    Object.assign(where, buildSearchWhere(filters.q));
  }

  return where;
}

const listIncludes = [
  {
    model: UserModel,
    as: "reviewer",
    attributes: ["id", "name"],
    required: false,
  },
  {
    model: ClaimDocumentModel,
    attributes: ["id", "originalName"],
    separate: true,
    limit: 1,
    order: [["createdAt", "DESC"]] as [string, string][],
  },
];

export async function listClaims(filters: ClaimListFilters) {
  const pg = toPagination(filters.page, filters.limit);
  const where = buildWhere(filters);

  const result = await ClaimModel.findAndCountAll({
    where,
    include: listIncludes,
    limit: pg.limit,
    offset: pg.offset,
    order: [["createdAt", "DESC"]],
    distinct: true,
  });

  const totalRows = Number(result.count);
  const totalPages = Math.max(1, Math.ceil(totalRows / pg.limit));

  return {
    items: result.rows.map(mapClaimListItem),
    pagination: {
      page: pg.page,
      limit: pg.limit,
      totalRows,
      totalPages,
    },
  };
}

export async function listClaimReviewers(organizationId: string) {
  const rows = await UserModel.findAll({
    where: { organizationId, isActive: true },
    attributes: ["id", "name"],
    order: [["name", "ASC"]],
  });

  return rows.map((row) => ({ id: row.id, name: row.name }));
}

function readSummaryField(
  extractionResult: Record<string, unknown> | null,
  field: "insuredName" | "provider",
): string {
  const summary = extractionResult?.summary;
  if (!summary || typeof summary !== "object") return "";
  const value = (summary as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function readClaimDate(extractionResult: Record<string, unknown> | null): string {
  const claims = extractionResult?.claims;
  if (!Array.isArray(claims) || claims.length === 0) return "";
  const encounter = claims[0]?.encounter;
  if (!encounter || typeof encounter !== "object") return "";
  const admission = (encounter as Record<string, unknown>).admission_date;
  if (!admission || typeof admission !== "object") return "";
  const value = (admission as Record<string, unknown>).value;
  return typeof value === "string" && value !== "not_found" ? value : "";
}

function toCsvRow(item: ClaimListItemDto): ClaimCsvRow {
  return {
    claimNumber: item.claimNumber,
    claimDate: readClaimDate(item.extractionResult),
    documentFileName: item.primaryDocument?.originalName ?? "",
    patientName: readSummaryField(item.extractionResult, "insuredName"),
    provider: readSummaryField(item.extractionResult, "provider"),
    uploadDate: item.createdAt.slice(0, 10),
    status: item.status,
    reviewerName: item.reviewer?.name ?? "",
  };
}

export async function exportClaimsCsv(filters: Omit<ClaimListFilters, "page" | "limit">) {
  const where = buildWhere({ ...filters, page: 1, limit: EXPORT_LIMIT });

  const rows = await ClaimModel.findAll({
    where,
    include: listIncludes,
    limit: EXPORT_LIMIT,
    order: [["createdAt", "DESC"]],
  });

  const items = rows.map(mapClaimListItem).map(toCsvRow);
  return buildClaimsCsv(items);
}
