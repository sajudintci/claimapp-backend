import { NotificationType, type NotificationTypeValue } from "@/modules/notifications/domain/notification-types";

export type NotificationContent = {
  type: NotificationTypeValue;
  title: string;
  message: string;
};

export function buildExtractionCompletedNotification(params: {
  claimNumber: string;
  status: string;
  insuredName?: string | null;
  ocrInsufficient: boolean;
  llmExpected: boolean;
  llmStatus: string;
  hasBillingMismatch: boolean;
  confidence: number;
}): NotificationContent {
  const label = params.claimNumber.trim() || "Claim";
  const patient = params.insuredName?.trim();

  if (params.status === "Extracted") {
    return {
      type: NotificationType.SUCCESS,
      title: "Extraction completed",
      message: patient
        ? `Claim ${label} for ${patient} was extracted successfully and is ready for review.`
        : `Claim ${label} was extracted successfully and is ready for review.`,
    };
  }

  const reasons: string[] = [];
  if (params.ocrInsufficient) {
    reasons.push("OCR text was too short or unreadable");
  }
  if (params.llmExpected && params.llmStatus === "failed") {
    reasons.push("structured extraction did not complete");
  }
  if (params.hasBillingMismatch) {
    reasons.push("billing totals may not match line items");
  }
  if (params.confidence < 0.65) {
    reasons.push("overall confidence is low");
  }

  const reasonText =
    reasons.length > 0 ? reasons.join("; ") : "manual review is recommended";

  return {
    type: NotificationType.WARNING,
    title: "Extraction needs attention",
    message: patient
      ? `Claim ${label} for ${patient} was processed but needs attention: ${reasonText}.`
      : `Claim ${label} was processed but needs attention: ${reasonText}.`,
  };
}

export function buildExtractionFailedNotification(params: {
  claimNumber: string;
  errorMessage: string;
  isCreditError: boolean;
}): NotificationContent {
  const label = params.claimNumber.trim() || "Claim";

  if (params.isCreditError) {
    return {
      type: NotificationType.ERROR,
      title: "Extraction failed — insufficient OCR credits",
      message: `Claim ${label} could not be processed because your organization has insufficient OCR credits. ${params.errorMessage}`,
    };
  }

  return {
    type: NotificationType.ERROR,
    title: "Extraction failed",
    message: `Claim ${label} extraction failed after multiple attempts: ${params.errorMessage}`,
  };
}

export function buildClaimUploadedNotification(params: {
  claimNumber: string;
  fileName: string;
}): NotificationContent {
  const label = params.claimNumber.trim() || "Claim";
  return {
    type: NotificationType.INFO,
    title: "Claim uploaded",
    message: `Claim ${label} was uploaded (${params.fileName}) and extraction has been queued.`,
  };
}

export function buildClaimReviewedNotification(params: {
  claimNumber: string;
  status: string;
}): NotificationContent {
  const label = params.claimNumber.trim() || "Claim";
  return {
    type: NotificationType.SUCCESS,
    title: "Claim reviewed",
    message: `Claim ${label} was marked as ${params.status}.`,
  };
}

export function buildLowOcrCreditsNotification(params: {
  remaining: number;
  threshold: number;
}): NotificationContent {
  return {
    type: NotificationType.WARNING,
    title: "OCR credits running low",
    message: `Your organization has ${params.remaining} OCR credit${params.remaining === 1 ? "" : "s"} remaining (threshold: ${params.threshold}). Add credits or wait for the monthly quota reset to avoid extraction failures.`,
  };
}
