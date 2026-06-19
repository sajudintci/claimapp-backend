export const REVIEW_META_KEY = "_review";

export type ClaimReviewMeta = {
  reviewedFieldKeys: string[];
  updatedAt?: string;
};

export function parseClaimReviewMeta(
  payload: Record<string, unknown> | null | undefined,
): ClaimReviewMeta {
  if (!payload) return { reviewedFieldKeys: [] };
  const raw = payload[REVIEW_META_KEY];
  if (!raw || typeof raw !== "object") return { reviewedFieldKeys: [] };
  const meta = raw as ClaimReviewMeta;
  return {
    reviewedFieldKeys: Array.isArray(meta.reviewedFieldKeys)
      ? meta.reviewedFieldKeys.filter((key): key is string => typeof key === "string")
      : [],
    updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
  };
}

export function stripReviewMeta(payload: Record<string, unknown>): Record<string, unknown> {
  const { [REVIEW_META_KEY]: _review, ...rest } = payload;
  return rest;
}
