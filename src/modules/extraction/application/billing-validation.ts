import { parseAmountFromText, tracedFieldValue } from "@/modules/extraction/application/extraction-summary";
import { ExtractionClaim } from "@/modules/extraction/domain/extraction-schema";

export type ClaimBillingValidation = {
  claimIndex: number;
  totalAmountRead: number | null;
  totalAmountCalculatedFromItems: number | null;
  llmTotalAmountCalculated: number | null;
  readVsItemsMismatch: boolean;
  llmCalculatedVsItemsMismatch: boolean;
  readVsLlmCalculatedMismatch: boolean;
  messages: string[];
};

export type ExtractionValidation = {
  hasBillingMismatch: boolean;
  claims: ClaimBillingValidation[];
};

function sumLineItemAmounts(claim: ExtractionClaim): number | null {
  let sum = 0;
  let hasAmount = false;

  for (const item of claim.items) {
    const amount = parseAmountFromText(String(item.amount ?? ""));
    if (amount == null) continue;
    sum += amount;
    hasAmount = true;
  }

  return hasAmount ? sum : null;
}

function amountsMismatch(
  left: number | null,
  right: number | null,
  tolerancePercent: number,
): boolean {
  if (left == null || right == null) return false;
  const tolerance = Math.max(Math.abs(left) * (tolerancePercent / 100), 1);
  return Math.abs(left - right) > tolerance;
}

export function validateClaimsBilling(
  claims: ExtractionClaim[],
  tolerancePercent: number,
): ExtractionValidation {
  const claimValidations = claims.map((claim, claimIndex) => {
    const totalAmountRead = parseAmountFromText(
      tracedFieldValue(claim.billing.total_amount_read),
    );
    const llmTotalAmountCalculated = parseAmountFromText(
      tracedFieldValue(claim.billing.total_amount_calculated),
    );
    const totalAmountCalculatedFromItems = sumLineItemAmounts(claim);

    const readVsItemsMismatch = amountsMismatch(
      totalAmountRead,
      totalAmountCalculatedFromItems,
      tolerancePercent,
    );
    const llmCalculatedVsItemsMismatch = amountsMismatch(
      llmTotalAmountCalculated,
      totalAmountCalculatedFromItems,
      tolerancePercent,
    );
    const readVsLlmCalculatedMismatch = amountsMismatch(
      totalAmountRead,
      llmTotalAmountCalculated,
      tolerancePercent,
    );

    const messages: string[] = [];
    if (readVsItemsMismatch) {
      messages.push(
        `Invoice total (${totalAmountRead}) does not match sum of line items (${totalAmountCalculatedFromItems}).`,
      );
    }
    if (llmCalculatedVsItemsMismatch) {
      messages.push(
        `LLM calculated total (${llmTotalAmountCalculated}) does not match sum of line items (${totalAmountCalculatedFromItems}).`,
      );
    }
    if (readVsLlmCalculatedMismatch) {
      messages.push(
        `Invoice total (${totalAmountRead}) does not match LLM calculated total (${llmTotalAmountCalculated}).`,
      );
    }

    return {
      claimIndex,
      totalAmountRead,
      totalAmountCalculatedFromItems,
      llmTotalAmountCalculated,
      readVsItemsMismatch,
      llmCalculatedVsItemsMismatch,
      readVsLlmCalculatedMismatch,
      messages,
    };
  });

  const hasBillingMismatch = claimValidations.some(
    (v) =>
      v.readVsItemsMismatch ||
      v.llmCalculatedVsItemsMismatch ||
      v.readVsLlmCalculatedMismatch,
  );

  return { hasBillingMismatch, claims: claimValidations };
}
