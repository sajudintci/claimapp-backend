import { describe, expect, it } from "vitest";
import { NotificationType } from "@/modules/notifications/domain/notification-types";
import {
  buildClaimReviewedNotification,
  buildClaimUploadedNotification,
  buildExtractionCompletedNotification,
  buildExtractionFailedNotification,
  buildLowOcrCreditsNotification,
} from "@/modules/notifications/application/notification-events";

describe("notification-events", () => {
  it("builds success notification when extraction status is Extracted", () => {
    const notice = buildExtractionCompletedNotification({
      claimNumber: "CLM-001",
      status: "Extracted",
      insuredName: "Jane Doe",
      ocrInsufficient: false,
      llmExpected: true,
      llmStatus: "ok",
      hasBillingMismatch: false,
      confidence: 0.9,
    });

    expect(notice.type).toBe(NotificationType.SUCCESS);
    expect(notice.title).toBe("Extraction completed");
    expect(notice.message).toContain("CLM-001");
    expect(notice.message).toContain("Jane Doe");
  });

  it("builds warning notification with attention reasons", () => {
    const notice = buildExtractionCompletedNotification({
      claimNumber: "CLM-002",
      status: "Needs Attention",
      insuredName: null,
      ocrInsufficient: false,
      llmExpected: true,
      llmStatus: "failed",
      hasBillingMismatch: true,
      confidence: 0.5,
    });

    expect(notice.type).toBe(NotificationType.WARNING);
    expect(notice.message).toContain("structured extraction did not complete");
    expect(notice.message).toContain("billing totals may not match line items");
    expect(notice.message).toContain("overall confidence is low");
  });

  it("builds extraction failure notifications", () => {
    const creditFailure = buildExtractionFailedNotification({
      claimNumber: "CLM-003",
      errorMessage: "Insufficient OCR credits (need 3, have 0)",
      isCreditError: true,
    });
    expect(creditFailure.type).toBe(NotificationType.ERROR);
    expect(creditFailure.title).toContain("insufficient OCR credits");

    const genericFailure = buildExtractionFailedNotification({
      claimNumber: "CLM-004",
      errorMessage: "Claim not found",
      isCreditError: false,
    });
    expect(genericFailure.title).toBe("Extraction failed");
    expect(genericFailure.message).toContain("Claim not found");
  });

  it("builds claim lifecycle notifications", () => {
    const uploaded = buildClaimUploadedNotification({
      claimNumber: "CLM-005",
      fileName: "invoice.pdf",
    });
    expect(uploaded.type).toBe(NotificationType.INFO);
    expect(uploaded.message).toContain("invoice.pdf");

    const reviewed = buildClaimReviewedNotification({
      claimNumber: "CLM-005",
      status: "Reviewed",
    });
    expect(reviewed.type).toBe(NotificationType.SUCCESS);
    expect(reviewed.message).toContain("Reviewed");
  });

  it("builds low OCR credits warning", () => {
    const notice = buildLowOcrCreditsNotification({
      remaining: 12,
      threshold: 50,
    });
    expect(notice.type).toBe(NotificationType.WARNING);
    expect(notice.message).toContain("12 OCR credits");
    expect(notice.message).toContain("threshold: 50");
  });
});
