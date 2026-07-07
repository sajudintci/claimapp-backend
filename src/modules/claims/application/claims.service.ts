import { Op } from "sequelize";
import { sequelize } from "@/database/sequelize";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ClaimModel } from "@/database/models/claim.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { createId } from "@/utils/id";
import { StorageService } from "@/storage/storage.interface";
import { queueExtractionRequested } from "@/modules/shared/application/outbox.service";
import {
  ensureOrganizationOcrCredits,
  InsufficientOcrCreditsError,
  reserveOcrCredits,
} from "@/modules/ocr-credits/application/ocr-credits.service";
import type { ClaimUploadMetadata } from "@/modules/claims/domain/claim-upload-metadata";

export class ClaimsService {
  constructor(private readonly storage: StorageService) {}

  async uploadClaim(params: {
    organizationId: string;
    createdBy: string;
    claimNumber: string;
    file: Express.Multer.File;
    reviewerId?: string | null;
    metadata?: ClaimUploadMetadata | null;
  }) {
    await ensureOrganizationOcrCredits(params.organizationId);

    const claimId = createId();
    const documentId = createId();
    const extractionJobId = createId();
    const uploaded = await this.storage.saveUpload(params.file);

    const { claim, extractionJob } = await sequelize.transaction(async (transaction) => {
      const claim = await ClaimModel.create(
        {
          id: claimId,
          organizationId: params.organizationId,
          createdBy: params.createdBy,
          claimNumber: params.claimNumber,
          reviewerId: params.reviewerId ?? null,
          status: "Processing",
          extractionResult: null,
          reviewedResult: null,
          metadata: params.metadata ?? null,
        } as any,
        { transaction },
      );

      await ClaimDocumentModel.create(
        {
          id: documentId,
          claimId: claim.id,
          originalName: params.file.originalname,
          mimeType: params.file.mimetype,
          storagePath: uploaded.path,
        } as any,
        { transaction },
      );

      const extractionJob = await ExtractionJobModel.create(
        {
          id: extractionJobId,
          claimId: claim.id,
          status: "QUEUED",
          progressStage: "queued",
          attempts: 0,
          errorMessage: null,
        } as any,
        { transaction },
      );

      await queueExtractionRequested(
        { claimId: claim.id, extractionJobId: extractionJob.id },
        transaction,
      );

      try {
        await reserveOcrCredits(
          {
            organizationId: params.organizationId,
            claimId: claim.id,
            extractionJobId: extractionJob.id,
            credits: 1,
          },
          transaction,
        );
      } catch (err) {
        if (err instanceof InsufficientOcrCreditsError) {
          throw new Error("INSUFFICIENT_OCR_CREDITS");
        }
        throw err;
      }

      return { claim, extractionJob };
    });

    return { claim, extractionJob };
  }

  async retryExtraction(params: { claimId: string; organizationId: string }) {
    await ensureOrganizationOcrCredits(params.organizationId);

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

    const extractionJobId = createId();

    const extractionJob = await sequelize.transaction(async (transaction) => {
      const extractionJob = await ExtractionJobModel.create(
        {
          id: extractionJobId,
          claimId: claim.id,
          status: "QUEUED",
          progressStage: "queued",
          attempts: 0,
          errorMessage: null,
        } as any,
        { transaction },
      );

      await ClaimModel.update(
        { status: "Processing", extractionResult: null },
        { where: { id: claim.id }, transaction },
      );

      await queueExtractionRequested(
        { claimId: claim.id, extractionJobId: extractionJob.id },
        transaction,
      );

      try {
        await reserveOcrCredits(
          {
            organizationId: params.organizationId,
            claimId: claim.id,
            extractionJobId: extractionJob.id,
            credits: 1,
          },
          transaction,
        );
      } catch (err) {
        if (err instanceof InsufficientOcrCreditsError) {
          throw new Error("INSUFFICIENT_OCR_CREDITS");
        }
        throw err;
      }

      return extractionJob;
    });

    return { claimId: claim.id, extractionJob };
  }
}
