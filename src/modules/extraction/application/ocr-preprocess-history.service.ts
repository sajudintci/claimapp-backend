import { ClaimModel } from "@/database/models/claim.model";
import { OcrPreprocessHistoryModel } from "@/database/models/ocr-preprocess-history.model";
import {
  buildOcrPreprocessHistoryPayload,
  type OcrPreprocessHistoryPayload,
} from "@/modules/extraction/domain/ocr-preprocess-history";
import {
  OCR_FORMAT_SCHEMA_VERSION,
  type LlmPreparedInput,
} from "@/modules/extraction/application/ocr-preprocess";
import { createId } from "@/utils/id";

export type OcrPreprocessHistoryDto = {
  id: string;
  claimId: string;
  extractionJobId: string;
  source: string;
  payload: OcrPreprocessHistoryPayload;
  createdAt: string;
};

function mapHistoryRow(row: OcrPreprocessHistoryModel): OcrPreprocessHistoryDto {
  return {
    id: row.id,
    claimId: row.claimId,
    extractionJobId: row.extractionJobId,
    source: row.source,
    payload: row.payload as unknown as OcrPreprocessHistoryPayload,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function saveOcrPreprocessHistory(params: {
  claimId: string;
  extractionJobId: string;
  source: string;
  prepared: LlmPreparedInput;
}): Promise<OcrPreprocessHistoryDto> {
  const payload = buildOcrPreprocessHistoryPayload(
    params.prepared,
    OCR_FORMAT_SCHEMA_VERSION,
  );

  const row = await OcrPreprocessHistoryModel.create({
    id: createId(),
    claimId: params.claimId,
    extractionJobId: params.extractionJobId,
    source: params.source,
    payload: payload as unknown as Record<string, unknown>,
  } as OcrPreprocessHistoryModel);

  return mapHistoryRow(row);
}

export async function listOcrPreprocessHistoriesForClaim(params: {
  claimId: string;
  organizationId: string;
  limit?: number;
}): Promise<OcrPreprocessHistoryDto[]> {
  const claim = await ClaimModel.findOne({
    where: { id: params.claimId, organizationId: params.organizationId },
    attributes: ["id"],
  });
  if (!claim) return [];

  const rows = await OcrPreprocessHistoryModel.findAll({
    where: { claimId: params.claimId },
    order: [["createdAt", "DESC"]],
    limit: params.limit ?? 20,
  });

  return rows.map(mapHistoryRow);
}

export async function getOcrPreprocessHistoryForClaim(params: {
  claimId: string;
  historyId: string;
  organizationId: string;
}): Promise<OcrPreprocessHistoryDto | null> {
  const claim = await ClaimModel.findOne({
    where: { id: params.claimId, organizationId: params.organizationId },
    attributes: ["id"],
  });
  if (!claim) return null;

  const row = await OcrPreprocessHistoryModel.findOne({
    where: { id: params.historyId, claimId: params.claimId },
  });
  if (!row) return null;

  return mapHistoryRow(row);
}
