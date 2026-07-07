export const REVIEW_META_KEY = "_review";

export type ClaimReviewMeta = {
  updatedAt?: string;
};

export function parseClaimReviewMeta(
  payload: Record<string, unknown> | null | undefined,
): ClaimReviewMeta {
  if (!payload) return {};
  const raw = payload[REVIEW_META_KEY];
  if (!raw || typeof raw !== "object") return {};
  const meta = raw as ClaimReviewMeta;
  return {
    updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
  };
}

export function stripReviewMeta(payload: Record<string, unknown>): Record<string, unknown> {
  const { [REVIEW_META_KEY]: _review, ...rest } = payload;
  return rest;
}
