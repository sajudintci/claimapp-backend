import { Job, Queue, Worker } from "bullmq";
import { env } from "@/config/env";
import { ClaimDocumentModel } from "@/database/models/claim-document.model";
import { ExtractionJobModel } from "@/database/models/extraction-job.model";
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
import { logger } from "@/infrastructure/logger/winston";
import { createId } from "@/utils/id";
import {
  assertSufficientOcrCredits,
  creditsFromPageCount,
  deductOcrCreditsForSuccessfulExtraction,
  InsufficientOcrCreditsError,
} from "@/modules/ocr-credits/application/ocr-credits.service";
import { AuditAction } from "@/modules/audit/domain/audit-actions";
import { writeSystemAudit } from "@/utils/audit-request";

const connection = { host: env.REDIS_HOST, port: env.REDIS_PORT };
export const extractionQueue = new Queue("extraction-queue", { connection });

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

export const enqueueExtraction = async (payload: ExtractionPayload) => {
  await extractionQueue.add("extract", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 }
  });
};

export const initExtractionQueue = async () => {
  const worker = new Worker(
    "extraction-queue",
    async (job: Job<ExtractionPayload>) => {
      await ExtractionJobModel.update(
        { status: "PROCESSING", attempts: job.attemptsMade + 1 },
        { where: { id: job.data.extractionJobId } },
      );

      const claim = await ClaimModel.findByPk(job.data.claimId);
      if (!claim) {
        throw new Error("Claim not found");
      }

      await assertSufficientOcrCredits(claim.organizationId, 1);

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

      const ocrCreditsRequired = creditsFromPageCount(extracted.ocrPageCount);
      await assertSufficientOcrCredits(claim.organizationId, ocrCreditsRequired);

      const ocrSufficient = isOcrTextSufficient(extracted.text, extracted.filteredPlainText);
      const localConfidence = estimateConfidence(
        extracted.filteredPlainText ?? extracted.text,
      );
      const llmExpected = isLlmPostProcessEnabled();

      let llmOutcome = ocrSufficient
        ? await postProcessExtractionWithLlm(extracted.text)
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
      const confidence = llmResult?.confidence ?? localConfidence;
      const extractedPayload = {
        claimId: job.data.claimId,
        source: extracted.source,
        rawText: extracted.filteredPlainText ?? extracted.text,
        ocrRawText: extracted.filteredPlainText ?? extracted.text,
        ocrCharCount: (extracted.filteredPlainText ?? extracted.text).replace(/\s+/g, "").length,
        ocrSufficient,
        ocrFiltered: extracted.ocrFiltered,
        ocrPageCount: extracted.ocrPageCount ?? null,
        ocrPageLines: extracted.ocrPageLines ?? null,
        preExtractedFields: extracted.preExtracted ?? null,
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
        schemaVersion: 2,
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

      await ExtractionResultModel.create({
        id: createId(),
        claimId: job.data.claimId,
        payload: finalPayload,
        source: extracted.source,
      } as any);

      await ClaimModel.update(
        {
          extractionResult: finalPayload,
          status: nextStatus,
        },
        { where: { id: job.data.claimId } },
      );

      await ExtractionJobModel.update(
        { status: "COMPLETED", errorMessage: null },
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
    },
    { connection }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const isCreditError = err instanceof InsufficientOcrCreditsError;
    logger.error("Extraction job failed", {
      message: err.message,
      stack: err.stack,
      jobId: job.id,
      code: isCreditError ? err.code : undefined,
    });
    await ExtractionJobModel.update(
      {
        status: "FAILED",
        errorMessage: isCreditError
          ? `Insufficient OCR credits (need ${err.required}, have ${err.remaining})`
          : err.message,
        attempts: job.attemptsMade + 1,
      },
      { where: { id: job.data.extractionJobId } },
    );
    const failedClaim = await ClaimModel.findByPk(job.data.claimId);
    if (failedClaim) {
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
    }
  });

  logger.info("Extraction queue initialized");
};
