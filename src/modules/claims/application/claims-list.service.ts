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

  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Record<symbol, Date> = {};
    if (filters.dateFrom) {
      createdAt[Op.gte] = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    }
    if (filters.dateTo) {
      createdAt[Op.lte] = new Date(`${filters.dateTo}T23:59:59.999Z`);
    }
    Object.assign(where, { createdAt });
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

function readMetadataPatientName(metadata: Record<string, unknown> | null): string {
  const name = metadata?.patientName;
  return typeof name === "string" ? name.trim() : "";
}

function readMetadataDocumentType(metadata: Record<string, unknown> | null): string {
  const raw = metadata?.documentType;
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string" && v.trim()).join("; ");
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "";
}

function readMetadataPriority(metadata: Record<string, unknown> | null): string {
  const priority = metadata?.priority;
  return typeof priority === "string" ? priority.trim() : "";
}

function toCsvRow(item: ClaimListItemDto): ClaimCsvRow {
  const metadata = item.metadata;
  return {
    claimNumber: item.claimNumber,
    documentFileName: item.primaryDocument?.originalName ?? "",
    patientName:
      readMetadataPatientName(metadata) ||
      readSummaryField(item.extractionResult, "insuredName"),
    documentType: readMetadataDocumentType(metadata),
    priority: readMetadataPriority(metadata),
    hospitalName: readSummaryField(item.extractionResult, "provider"),
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
