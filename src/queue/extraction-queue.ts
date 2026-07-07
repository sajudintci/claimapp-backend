import { Job, Queue, Worker } from "bullmq";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
import { env } from "@/config/env";
import { getRedisConnection } from "@/config/redis";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ExtractionResultModel } from "@/database/models/extraction-result.model";
import { ClaimModel } from "@/database/models/claim.model";
import { validateClaimsBilling } from "@/modules/extraction/application/billing-validation";
import {
  extractTextFromDocument,
  isOcrTextSufficient,
} from "@/modules/extraction/application/document-text-extractor";
import { logOcrExtraction } from "@/modules/extraction/application/ocr-log";
import {
  buildExtractionSummaryFromLlm,
  isLlmPostProcessEnabled,
  postProcessExtractionWithLlm,
} from "@/modules/extraction/application/llm-post-process";
import { updateExtractionJobProgress } from "@/modules/extraction/application/extraction-job-progress";
import { buildOcrPageLinesPayload } from "@/modules/extraction/application/ocr-page-lines-payload";
import { saveOcrPreprocessHistory } from "@/modules/extraction/application/ocr-preprocess-history.service";
import { createId } from "@/utils/id";
import {
  adjustOcrCreditReservation,
  deductOcrCreditsForSuccessfulExtraction,
  InsufficientOcrCreditsError,
  releaseOcrCreditReservation,
} from "@/modules/ocr-credits/application/ocr-credits.service";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import {
  buildExtractionCompletedNotification,
  buildExtractionFailedNotification,
  buildLowOcrCreditsNotification,
} from "@/modules/notifications/application/notification-events";
import { createOrganizationNotification } from "@/modules/notifications/application/notifications.service";
import { writeSystemAudit } from "@/utils/audit-request";
import { logger } from "@/infrastructure/logger/winston";

const connection = getRedisConnection();
export const extractionQueue = new Queue("extraction-queue", { connection });

let extractionWorker: Worker<ExtractionPayload> | null = null;

type ExtractionPayload = { claimId: string; extractionJobId: string };

function parseAmount(text: string) {
  const amountMatch =
    text.match(/(?:amount|total|nilai|tagihan)[^\d]{0,20}([\d.,]+)/i) ??
    text.match(/\b(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?)\b/);
  if (!amountMatch?.[1]) return null;
  const normalized = amountMatch[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const amount = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function parseInsuredName(text: string) {
  const lineMatch = text.match(/(?:insured\s*name|nama\s*tertanggung|nama\s*pasien)\s*[:\-]\s*([^\n\r]+)/i);
  if (lineMatch?.[1]) return lineMatch[1].trim();
  const firstTextLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 4 && /[a-z]/i.test(line));
  return firstTextLine ?? "Unknown";
}

function estimateConfidence(text: string) {
  const len = text.replace(/\s+/g, "").length;
  if (len > 300) return 0.9;
  if (len > 120) return 0.8;
  return 0.65;
}

function resolveClaimStatus(params: {
  confidence: number;
  llmExpected: boolean;
  llmStatus: string;
  hasBillingMismatch: boolean;
  ocrInsufficient: boolean;
}): string {
  if (params.ocrInsufficient) return "Needs Attention";
  if (params.llmExpected && params.llmStatus === "failed") return "Needs Attention";
  if (params.hasBillingMismatch) return "Needs Attention";
  if (params.confidence < 0.65) return "Needs Attention";
  return "Extracted";
}

export type ExtractionEnqueuePayload = { claimId: string; extractionJobId: string };

export type EnqueueExtractionResult = {
  enqueued: boolean;
  reason?: "already_completed" | "job_failed" | "job_not_found" | "already_queued" | "enqueued";
};

/** Idempotent enqueue — never re-queue jobs already completed/failed in DB. */
export const enqueueExtraction = async (
  payload: ExtractionEnqueuePayload,
): Promise<EnqueueExtractionResult> => {
  const job = await ExtractionJobModel.findByPk(payload.extractionJobId);
  if (!job) {
    logger.warn("Skip enqueue: extraction job not found", payload);
    return { enqueued: false, reason: "job_not_found" };
  }

  if (job.status === "COMPLETED") {
    logger.info("Skip enqueue: extraction already completed", payload);
    return { enqueued: false, reason: "already_completed" };
  }

  if (job.status === "FAILED") {
    logger.info("Skip enqueue: extraction job already failed", payload);
    return { enqueued: false, reason: "job_failed" };
  }

  const existing = await extractionQueue.getJob(payload.extractionJobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed") {
      return { enqueued: false, reason: "already_queued" };
    }
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }

  await extractionQueue.add("extract", payload, {
    jobId: payload.extractionJobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
  });

  return { enqueued: true, reason: "enqueued" };
};

export const initExtractionQueue = async () => {
  if (!env.RUN_EXTRACTION_WORKER) {
    logger.info("Extraction worker disabled (RUN_EXTRACTION_WORKER=false)");
    return;
  }

  extractionWorker = new Worker(
    "extraction-queue",
    async (job: Job<ExtractionPayload>) => {
      await ExtractionJobModel.update(
        { status: "PROCESSING", attempts: job.attemptsMade + 1, progressStage: "ocr" },
        { where: { id: job.data.extractionJobId } },
      );

      const claim = await ClaimModel.findByPk(job.data.claimId);
      if (!claim) {
        throw new Error("Claim not found");
      }

      const latestDocument = await ClaimDocumentModel.findOne({
        where: { claimId: job.data.claimId },
        order: [["createdAt", "DESC"]],
      });
      if (!latestDocument) {
        throw new Error("No document found for claim");
      }

      const extracted = await extractTextFromDocument(
        latestDocument.storagePath,
        latestDocument.mimeType,
        {
          claimId: job.data.claimId,
          originalFileName: latestDocument.originalName,
        },
      );

      await logOcrExtraction(
        {
          claimId: job.data.claimId,
          extractionJobId: job.data.extractionJobId,
          storagePath: latestDocument.storagePath,
          mimeType: latestDocument.mimeType,
        },
        extracted,
      );

      if (extracted.llmPrepared) {
        await saveOcrPreprocessHistory({
          claimId: job.data.claimId,
          extractionJobId: job.data.extractionJobId,
          source: extracted.source,
          prepared: extracted.llmPrepared,
        });
      }

      await updateExtractionJobProgress(job.data.extractionJobId, "llm");

      await adjustOcrCreditReservation({
        organizationId: claim.organizationId,
        extractionJobId: job.data.extractionJobId,
        pageCount: extracted.ocrPageCount,
      });

      const ocrSufficient = isOcrTextSufficient(extracted.text, extracted.filteredPlainText);
      const localConfidence = estimateConfidence(
        extracted.filteredPlainText ?? extracted.text,
      );
      const llmExpected = isLlmPostProcessEnabled();

      let llmOutcome = ocrSufficient
        ? await postProcessExtractionWithLlm(extracted.text, {
            filteredPlainText: extracted.filteredPlainText ?? extracted.text,
            extractionJobId: job.data.extractionJobId,
            ocrPages: extracted.llmPrepared?.pages,
          })
        : {
            status: "failed" as const,
            result: null,
            error: `OCR text too short (${(extracted.filteredPlainText ?? extracted.text).replace(/\s+/g, "").length} chars). Document may be unreadable or scanned without text layer.`,
            attempts: 0,
          };

      if (!ocrSufficient) {
        logger.warn("Skipping LLM: insufficient OCR text", {
          claimId: job.data.claimId,
          source: extracted.source,
          ocrPageCount: extracted.ocrPageCount,
          textLength: (extracted.filteredPlainText ?? extracted.text).length,
        });
      }

      const llmResult = llmOutcome.result;
      const llmSummary = buildExtractionSummaryFromLlm(llmResult);
      const claims = llmResult?.claims ?? [];

      const validation =
        claims.length > 0
          ? validateClaimsBilling(claims, env.BILLING_MISMATCH_TOLERANCE_PERCENT)
          : { hasBillingMismatch: false, claims: [] };
      let confidence = llmResult?.confidence ?? localConfidence;
      const verification = llmOutcome.verification;
      if (verification && verification.fieldsRejected > 0) {
        const penalty = Math.min(0.35, verification.fieldsRejected * 0.04);
        confidence = Math.max(0, confidence - penalty);
      }
      const ocrPageLines = extracted.llmPrepared
        ? buildOcrPageLinesPayload(extracted.llmPrepared.pages)
        : undefined;

      const extractedPayload = {
        claimId: job.data.claimId,
        source: extracted.source,
        rawText: extracted.filteredPlainText ?? extracted.text,
        ocrRawText: extracted.filteredPlainText ?? extracted.text,
        ocrCharCount: (extracted.filteredPlainText ?? extracted.text).replace(/\s+/g, "").length,
        ocrSufficient,
        ocrFiltered: extracted.ocrFiltered,
        ocrPageCount: extracted.ocrPageCount ?? null,
        ...(ocrPageLines && ocrPageLines.length > 0 ? { ocrPageLines } : {}),
        abbyyTransactionId: extracted.abbyyTransactionId ?? null,
        abbyySkillId: extracted.abbyySkillId ?? null,
        abbyyRawResults: extracted.abbyyRawResults ?? null,
        summary: {
          insuredName: llmSummary?.insuredName ?? parseInsuredName(extracted.text),
          amount: llmSummary?.amount ?? parseAmount(extracted.text),
          diagnosis: llmSummary?.diagnosis ?? null,
          provider: llmSummary?.provider ?? null,
        },
        claims,
        structuredData: llmResult ? { claims: llmResult.claims } : null,
        validation,
        confidence,
        llmEnhanced: llmOutcome.status === "ok",
        llmStatus: llmOutcome.status,
        llmError: llmOutcome.error,
        llmAttempts: llmOutcome.attempts,
        extractionVerification: llmOutcome.verification ?? null,
        schemaVersion: 5,
      };

      const nextStatus = resolveClaimStatus({
        confidence,
        llmExpected,
        llmStatus: llmOutcome.status,
        hasBillingMismatch: validation.hasBillingMismatch,
        ocrInsufficient: !ocrSufficient,
      });

      if (llmOutcome.status === "failed") {
        logger.warn("Extraction completed without LLM structured output", {
          claimId: job.data.claimId,
          error: llmOutcome.error,
          attempts: llmOutcome.attempts,
          ocrSource: extracted.source,
          ocrCharCount: extractedPayload.ocrCharCount,
        });
      }

      const creditDebit = await deductOcrCreditsForSuccessfulExtraction({
        organizationId: claim.organizationId,
        claimId: job.data.claimId,
        extractionJobId: job.data.extractionJobId,
        pageCount: extracted.ocrPageCount,
      });

      const finalPayload = {
        ...extractedPayload,
        ocrCreditsCharged: creditDebit.credits,
      };

      await updateExtractionJobProgress(job.data.extractionJobId, "persist");

      const existingResult = await ExtractionResultModel.findOne({
        where: { extractionJobId: job.data.extractionJobId },
      });
      if (existingResult) {
        await existingResult.update({
          payload: finalPayload,
          source: extracted.source,
        });
      } else {
        await ExtractionResultModel.create({
          id: createId(),
          claimId: job.data.claimId,
          extractionJobId: job.data.extractionJobId,
          payload: finalPayload,
          source: extracted.source,
        } as any);
      }

      await ClaimModel.update(
        {
          extractionResult: finalPayload,
          status: nextStatus,
        },
        { where: { id: job.data.claimId } },
      );

      await ExtractionJobModel.update(
        { status: "COMPLETED", errorMessage: null, progressStage: "completed" },
        { where: { id: job.data.extractionJobId } },
      );

      await writeSystemAudit({
        organizationId: claim.organizationId,
        userId: claim.createdBy,
        action: AuditAction.EXTRACTION_COMPLETED,
        entityType: "claim",
        entityId: job.data.claimId,
        afterChanges: {
          status: nextStatus,
          ocrCreditsCharged: creditDebit.credits,
          llmStatus: llmOutcome.status,
          result: "Success",
        },
      });

      const extractionNotice = buildExtractionCompletedNotification({
        claimNumber: claim.claimNumber,
        status: nextStatus,
        insuredName: extractedPayload.summary.insuredName,
        ocrInsufficient: !ocrSufficient,
        llmExpected,
        llmStatus: llmOutcome.status,
        hasBillingMismatch: validation.hasBillingMismatch,
        confidence,
      });
      await createOrganizationNotification({
        organizationId: claim.organizationId,
        ...extractionNotice,
      });

      if (
        creditDebit.remaining <= env.OCR_LOW_CREDITS_NOTIFICATION_THRESHOLD &&
        creditDebit.remaining + creditDebit.credits > env.OCR_LOW_CREDITS_NOTIFICATION_THRESHOLD
      ) {
        const lowCreditsNotice = buildLowOcrCreditsNotification({
          remaining: creditDebit.remaining,
          threshold: env.OCR_LOW_CREDITS_NOTIFICATION_THRESHOLD,
        });
        await createOrganizationNotification({
          organizationId: claim.organizationId,
          ...lowCreditsNotice,
        });
      }
    },
    {
      connection,
      concurrency: env.BULKHEAD_EXTRACTION_WORKER_CONCURRENCY,
    },
  );

  extractionWorker.on("failed", async (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    const isCreditError = err instanceof InsufficientOcrCreditsError;
    logger.error("Extraction job failed", {
      message: err.message,
      stack: err.stack,
      jobId: job.id,
      code: isCreditError ? err.code : undefined,
    });
    const errorMessage = isCreditError
      ? `Insufficient OCR credits (need ${err.required}, have ${err.remaining})`
      : err.message;

    await ExtractionJobModel.update(
      {
        status: "FAILED",
        errorMessage,
        attempts: job.attemptsMade + 1,
        progressStage: "failed",
      },
      { where: { id: job.data.extractionJobId } },
    );
    const failedClaim = await ClaimModel.findByPk(job.data.claimId);
    if (failedClaim) {
      await releaseOcrCreditReservation({
        organizationId: failedClaim.organizationId,
        extractionJobId: job.data.extractionJobId,
      });

      if (isCreditError) {
        await ClaimModel.update(
          { status: "Failed" },
          { where: { id: job.data.claimId } },
        );
      }
      await writeSystemAudit({
        organizationId: failedClaim.organizationId,
        userId: failedClaim.createdBy,
        action: AuditAction.EXTRACTION_FAILED,
        entityType: "claim",
        entityId: job.data.claimId,
        result: "Failed",
        afterChanges: {
          error: err.message,
          extractionJobId: job.data.extractionJobId,
          result: "Failed",
        },
      });

      const failureNotice = buildExtractionFailedNotification({
        claimNumber: failedClaim.claimNumber,
        errorMessage,
        isCreditError,
      });
      await createOrganizationNotification({
        organizationId: failedClaim.organizationId,
        ...failureNotice,
      });
    }
  });

  logger.info("Extraction queue initialized", {
    workerConcurrency: env.BULKHEAD_EXTRACTION_WORKER_CONCURRENCY,
  });
};

export async function stopExtractionQueue(): Promise<void> {
  if (!extractionWorker) return;
  await extractionWorker.close();
  extractionWorker = null;
  logger.info("Extraction worker stopped");
}
