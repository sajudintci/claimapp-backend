import { Router } from "express";
import path from "path";
import multer from "multer";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { ClaimsService } from "@/modules/claims/application/claims.service";
import { LocalStorageService } from "@/storage/local/local-storage.service";
import { ClaimModel } from "@/database/models/claim.model";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { ExtractionResultModel } from "@/database/models/extraction-result.model";
import { toPagination } from "@/utils/pagination";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { writeAuditFromRequest } from "@/utils/audit-request";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();
const claimsService = new ClaimsService(new LocalStorageService());

router.use(authMiddleware);

router.get("/", async (req, res) => {
  const { page, limit, status } = req.query;
  const pg = toPagination(Number(page), Number(limit));
  const where: Record<string, unknown> = { organizationId: req.auth?.org };
  if (status) where.status = status;

  const result = await ClaimModel.findAndCountAll({
    where,
    limit: pg.limit,
    offset: pg.offset,
    order: [["createdAt", "DESC"]]
  });

  const totalRows = Number(result.count);
  const totalPages = Math.max(1, Math.ceil(totalRows / pg.limit));
  res.success(
    { items: result.rows },
    {
      pagination: {
        page: pg.page,
        limit: pg.limit,
        totalRows,
        totalPages,
      },
    },
  );
});

router.get("/:claimId", async (req, res) => {
  const claim = await ClaimModel.findOne({
    where: { id: req.params.claimId, organizationId: req.auth?.org }
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

  return res.success({ claim, documents, latestJob, latestResult });
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
  return res.sendFile(path.resolve(document.storagePath));
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
    const data = await claimsService.uploadClaim({
      organizationId: req.auth!.org,
      createdBy: req.auth!.sub,
      claimNumber: req.body.claimNumber ?? `CLM-${Date.now()}`,
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
        result: "Success",
      },
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
  return res.success(job);
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
  await ClaimModel.update(
    { reviewedResult: req.body.reviewedResult, status: nextStatus },
    { where: { id: req.params.claimId, organizationId: req.auth?.org } },
  );

  await writeAuditFromRequest(req, {
    action: AuditAction.CLAIM_REVIEW_UPDATED,
    entityType: "claim",
    entityId: req.params.claimId,
    beforeChanges: { status: existing.status },
    afterChanges: { status: nextStatus, result: "Success" },
  });

  const updated = await ClaimModel.findByPk(req.params.claimId);
  return res.success(updated, { code: "DATA_UPDATED", message: "Claim reviewed successfully" });
});

export const claimsRoutes = router;
