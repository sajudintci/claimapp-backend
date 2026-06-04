import { Op } from "sequelize";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ClaimModel } from "@/database/models/claim.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { createId } from "@/utils/id";
import { StorageService } from "@/storage/storage.interface";
import { enqueueExtraction } from "@/queue/extraction-queue";
import {
  assertSufficientOcrCredits,
  ensureOrganizationOcrCredits,
  InsufficientOcrCreditsError,
} from "@/modules/ocr-credits/application/ocr-credits.service";

export class ClaimsService {
  constructor(private readonly storage: StorageService) {}

  async uploadClaim(params: {
    organizationId: string;
    createdBy: string;
    claimNumber: string;
    file: Express.Multer.File;
  }) {
    await ensureOrganizationOcrCredits(params.organizationId);
    try {
      await assertSufficientOcrCredits(params.organizationId, 1);
    } catch (err) {
      if (err instanceof InsufficientOcrCreditsError) {
        throw new Error("INSUFFICIENT_OCR_CREDITS");
      }
      throw err;
    }

    const claim = await ClaimModel.create(
      {
        id: createId(),
        organizationId: params.organizationId,
        createdBy: params.createdBy,
        claimNumber: params.claimNumber,
        status: "Processing",
        extractionResult: null,
        reviewedResult: null
      } as any
    );

    const uploaded = await this.storage.saveUpload(params.file);

    await ClaimDocumentModel.create(
      {
        id: createId(),
        claimId: claim.id,
        originalName: params.file.originalname,
        mimeType: params.file.mimetype,
        storagePath: uploaded.path
      } as any
    );

    const extractionJob = await ExtractionJobModel.create(
      {
        id: createId(),
        claimId: claim.id,
        status: "QUEUED",
        attempts: 0,
        errorMessage: null
      } as any
    );

    await enqueueExtraction({ claimId: claim.id, extractionJobId: extractionJob.id });

    return { claim, extractionJob };
  }

  async retryExtraction(params: { claimId: string; organizationId: string }) {
    await ensureOrganizationOcrCredits(params.organizationId);
    try {
      await assertSufficientOcrCredits(params.organizationId, 1);
    } catch (err) {
      if (err instanceof InsufficientOcrCreditsError) {
        throw new Error("INSUFFICIENT_OCR_CREDITS");
      }
      throw err;
    }

    const claim = await ClaimModel.findOne({
      where: { id: params.claimId, organizationId: params.organizationId },
    });
    if (!claim) {
      throw new Error("CLAIM_NOT_FOUND");
    }

    const document = await ClaimDocumentModel.findOne({
      where: { claimId: claim.id },
      order: [["createdAt", "DESC"]],
    });
    if (!document) {
      throw new Error("DOCUMENT_NOT_FOUND");
    }

    const activeJob = await ExtractionJobModel.findOne({
      where: { claimId: claim.id, status: { [Op.in]: ["QUEUED", "PROCESSING"] } },
      order: [["createdAt", "DESC"]],
    });
    if (activeJob) {
      throw new Error("EXTRACTION_ALREADY_IN_PROGRESS");
    }

    const extractionJob = await ExtractionJobModel.create(
      {
        id: createId(),
        claimId: claim.id,
        status: "QUEUED",
        attempts: 0,
        errorMessage: null,
      } as any,
    );

    await ClaimModel.update(
      { status: "Processing", extractionResult: null },
      { where: { id: claim.id } },
    );

    await enqueueExtraction({ claimId: claim.id, extractionJobId: extractionJob.id });

    return { claimId: claim.id, extractionJob };
  }
}
