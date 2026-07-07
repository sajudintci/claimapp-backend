import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { ClaimsService } from "@/modules/claims/application/claims.service";
import {
  exportClaimsCsv,
  listClaimReviewers,
  listClaims,
} from "@/modules/claims/application/claims-list.service";
import { parseClaimListQuery } from "@/modules/claims/domain/claim-list-filters";
import { getStorageService, openStorageRefStream } from "@/storage/storage.factory";
import { ClaimModel } from "@/database/models/claim.model";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { ExtractionResultModel } from "@/database/models/extraction-result.model";
import { UserModel } from "@/database/models/user.model";
import { mapExtractionJobDto } from "@/modules/extraction/application/extraction-job-mapper";
import {
  getOcrPreprocessHistoryForClaim,
  listOcrPreprocessHistoriesForClaim,
} from "@/modules/extraction/application/ocr-preprocess-history.service";
import {
  countFlaggedFields,
  parseClaimFieldFlags,
} from "@/modules/claims/domain/claim-field-flags";
import {
  parseClaimUploadMetadata,
  validateClaimUploadInput,
} from "@/modules/claims/domain/claim-upload-metadata";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import {
  buildClaimReviewedNotification,
  buildClaimUploadedNotification,
} from "@/modules/notifications/application/notification-events";
import { createOrganizationNotification } from "@/modules/notifications/application/notifications.service";
import { writeAuditFromRequest } from "@/utils/audit-request";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();
const claimsService = new ClaimsService(getStorageService());

router.use(authMiddleware);

router.get("/", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const parsed = parseClaimListQuery(req.query as Record<string, unknown>);
  const result = await listClaims({ organizationId: org, ...parsed });
  return res.success({ items: result.items }, { pagination: result.pagination });
});

router.get("/reviewers", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const reviewers = await listClaimReviewers(org);
  return res.success({ items: reviewers });
});

router.get("/export", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const parsed = parseClaimListQuery(req.query as Record<string, unknown>);
  const csv = await exportClaimsCsv({
    organizationId: org,
    status: parsed.status,
    q: parsed.q,
    reviewerId: parsed.reviewerId,
    unassigned: parsed.unassigned,
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="claims-export.csv"');
  return res.send(csv);
});

router.get("/:claimId", async (req, res) => {
  const claim = await ClaimModel.findOne({
    where: { id: req.params.claimId, organizationId: req.auth?.org },
    include: [
      {
        model: UserModel,
        as: "reviewer",
        attributes: ["id", "name", "email"],
        required: false,
      },
    ],
  });
  if (!claim) {
    return res.fail({
      status: 404,
      code: "CLAIM_NOT_FOUND",
      message: "Claim not found",
      error: { type: "NotFoundError" },
    });
  }

  const [documents, latestJob, latestResult] = await Promise.all([
    ClaimDocumentModel.findAll({ where: { claimId: claim.id }, order: [["createdAt", "DESC"]] }),
    ExtractionJobModel.findOne({ where: { claimId: claim.id }, order: [["createdAt", "DESC"]] }),
    ExtractionResultModel.findOne({ where: { claimId: claim.id }, order: [["createdAt", "DESC"]] })
  ]);

  return res.success({
    claim,
    documents,
    latestJob: latestJob ? mapExtractionJobDto(latestJob) : null,
    latestResult,
  });
});

router.get("/:claimId/documents/:documentId/preview", async (req, res) => {
  const claim = await ClaimModel.findOne({
    where: { id: req.params.claimId, organizationId: req.auth?.org },
    attributes: ["id"],
  });
  if (!claim) {
    return res.fail({
      status: 404,
      code: "CLAIM_NOT_FOUND",
      message: "Claim not found",
      error: { type: "NotFoundError" },
    });
  }

  const document = await ClaimDocumentModel.findOne({
    where: { id: req.params.documentId, claimId: claim.id },
  });
  if (!document) {
    return res.fail({
      status: 404,
      code: "DOCUMENT_NOT_FOUND",
      message: "Document not found",
      error: { type: "NotFoundError" },
    });
  }

  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${document.originalName}"`);

  const { stream } = await openStorageRefStream(document.storagePath);
  stream.on("error", (err) => {
    if (!res.headersSent) {
      res.fail({
        status: 500,
        code: "DOCUMENT_READ_FAILED",
        message: "Failed to read document",
        error: { type: "StorageError", details: err.message },
      });
    }
  });
  return stream.pipe(res);
});

router.post("/upload", upload.single("document"), async (req, res) => {
  if (!req.file) {
    return res.fail({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "document is required",
      error: { type: "ValidationError", details: [{ field: "document", message: "document is required" }] },
    });
  }
  const mime = req.file.mimetype;
  if (!["application/pdf", "image/jpeg", "image/png"].includes(mime)) {
    return res.fail({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Unsupported file type",
      error: { type: "ValidationError", details: [{ field: "document", message: "Unsupported file type" }] },
    });
  }

  try {
    const reviewerId =
      typeof req.body.reviewerId === "string" && req.body.reviewerId.trim()
        ? req.body.reviewerId.trim()
        : null;

    const uploadMetadata = parseClaimUploadMetadata(req.body as Record<string, unknown>);
    const validationErrors = validateClaimUploadInput({
      claimNumber: req.body.claimNumber,
      reviewerId,
      metadata: uploadMetadata,
    });
    if (validationErrors.length > 0) {
      return res.fail({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Upload metadata is incomplete",
        error: { type: "ValidationError", details: validationErrors },
      });
    }

    const data = await claimsService.uploadClaim({
      organizationId: req.auth!.org,
      createdBy: req.auth!.sub,
      claimNumber: String(req.body.claimNumber).trim(),
      reviewerId: reviewerId!,
      metadata: uploadMetadata,
      file: req.file,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.CLAIM_UPLOADED,
      entityType: "claim",
      entityId: data.claim.id,
      afterChanges: {
        claimNumber: data.claim.claimNumber,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        extractionJobId: data.extractionJob.id,
        metadata: uploadMetadata,
        result: "Success",
      },
    });

    const uploadNotice = buildClaimUploadedNotification({
      claimNumber: data.claim.claimNumber,
      fileName: req.file.originalname,
    });
    await createOrganizationNotification({
      organizationId: req.auth!.org,
      ...uploadNotice,
    });

    return res.success(data, {
      status: 201,
      code: "DATA_CREATED",
      message: "Claim uploaded successfully",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    if (message === "INSUFFICIENT_OCR_CREDITS") {
      return res.fail({
        status: 402,
        code: "INSUFFICIENT_OCR_CREDITS",
        message: "Insufficient OCR credits. Add credits or wait for quota reset.",
        error: { type: "PaymentRequiredError" },
      });
    }
    throw err;
  }
});

router.get("/:claimId/extraction-status", async (req, res) => {
  const claim = await ClaimModel.findOne({
    where: { id: req.params.claimId, organizationId: req.auth?.org },
    attributes: ["id"],
  });
  if (!claim) {
    return res.fail({
      status: 404,
      code: "CLAIM_NOT_FOUND",
      message: "Claim not found",
      error: { type: "NotFoundError" },
    });
  }

  const job = await ExtractionJobModel.findOne({
    where: { claimId: req.params.claimId },
    order: [["createdAt", "DESC"]],
  });
  if (!job) {
    return res.fail({
      status: 404,
      code: "EXTRACTION_JOB_NOT_FOUND",
      message: "Extraction job not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(mapExtractionJobDto(job));
});

router.get("/:claimId/ocr-preprocess-histories", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const items = await listOcrPreprocessHistoriesForClaim({
    claimId: req.params.claimId,
    organizationId: org,
    limit: 50,
  });

  return res.success({ items });
});

router.get("/:claimId/ocr-preprocess-histories/:historyId", async (req, res) => {
  const org = req.auth?.org;
  if (!org) {
    return res.fail({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Organization context is required",
    });
  }

  const item = await getOcrPreprocessHistoryForClaim({
    claimId: req.params.claimId,
    historyId: req.params.historyId,
    organizationId: org,
  });

  if (!item) {
    return res.fail({
      status: 404,
      code: "OCR_PREPROCESS_HISTORY_NOT_FOUND",
      message: "OCR preprocess history not found",
      error: { type: "NotFoundError" },
    });
  }

  return res.success(item);
});

router.post("/:claimId/extraction/retry", async (req, res) => {
  try {
    const data = await claimsService.retryExtraction({
      claimId: req.params.claimId,
      organizationId: req.auth!.org,
    });

    await writeAuditFromRequest(req, {
      action: AuditAction.CLAIM_EXTRACTION_RETRY,
      entityType: "claim",
      entityId: data.claimId,
      afterChanges: {
        extractionJobId: data.extractionJob.id,
        result: "Success",
      },
    });

    return res.success(data, {
      status: 202,
      code: "EXTRACTION_RETRY_QUEUED",
      message: "Extraction retry has been queued",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retry failed";
    if (message === "CLAIM_NOT_FOUND") {
      return res.fail({
        status: 404,
        code: "CLAIM_NOT_FOUND",
        message: "Claim not found",
        error: { type: "NotFoundError" },
      });
    }
    if (message === "DOCUMENT_NOT_FOUND") {
      return res.fail({
        status: 400,
        code: "DOCUMENT_NOT_FOUND",
        message: "No document available to extract",
        error: { type: "ValidationError" },
      });
    }
    if (message === "EXTRACTION_ALREADY_IN_PROGRESS") {
      return res.fail({
        status: 409,
        code: "EXTRACTION_ALREADY_IN_PROGRESS",
        message: "Extraction is already queued or running",
        error: { type: "ConflictError" },
      });
    }
    if (message === "INSUFFICIENT_OCR_CREDITS") {
      return res.fail({
        status: 402,
        code: "INSUFFICIENT_OCR_CREDITS",
        message: "Insufficient OCR credits. Add credits or wait for quota reset.",
        error: { type: "PaymentRequiredError" },
      });
    }
    throw err;
  }
});

router.get("/:claimId/extraction-result", async (req, res) => {
  const result = await ExtractionResultModel.findOne({
    where: { claimId: req.params.claimId },
    order: [["createdAt", "DESC"]]
  });
  if (!result) {
    return res.fail({
      status: 404,
      code: "EXTRACTION_RESULT_NOT_FOUND",
      message: "Extraction result not found",
      error: { type: "NotFoundError" },
    });
  }
  return res.success(result);
});

router.patch("/:claimId/review", async (req, res) => {
  const existing = await ClaimModel.findOne({
    where: { id: req.params.claimId, organizationId: req.auth?.org },
  });
  if (!existing) {
    return res.fail({
      status: 404,
      code: "CLAIM_NOT_FOUND",
      message: "Claim not found",
      error: { type: "NotFoundError" },
    });
  }

  const nextStatus = req.body.status ?? "Reviewed";
  const reviewedResult = req.body.reviewedResult as Record<string, unknown> | null | undefined;
  const fieldFlags = parseClaimFieldFlags(reviewedResult);

  await ClaimModel.update(
    {
      reviewedResult: reviewedResult ?? null,
      status: nextStatus,
      reviewerId: req.auth?.sub ?? null,
    },
    { where: { id: req.params.claimId, organizationId: req.auth?.org } },
  );

  await writeAuditFromRequest(req, {
    action: AuditAction.CLAIM_REVIEW_UPDATED,
    entityType: "claim",
    entityId: req.params.claimId,
    beforeChanges: { status: existing.status },
    afterChanges: {
      status: nextStatus,
      flaggedFieldCount: countFlaggedFields(fieldFlags),
      result: "Success",
    },
  });

  const reviewNotice = buildClaimReviewedNotification({
    claimNumber: existing.claimNumber,
    status: nextStatus,
  });
  await createOrganizationNotification({
    organizationId: req.auth!.org,
    ...reviewNotice,
  });

  const updated = await ClaimModel.findByPk(req.params.claimId);
  return res.success(updated, { code: "DATA_UPDATED", message: "Claim reviewed successfully" });
});

export const claimsRoutes = router;
