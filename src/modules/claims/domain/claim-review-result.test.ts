import { describe, expect, it } from "vitest";
import {
  parseClaimReviewMeta,
  REVIEW_META_KEY,
  stripReviewMeta,
} from "@/modules/claims/domain/claim-review-result";

describe("claim-review-result", () => {
  it("parses reviewed field keys from payload meta", () => {
    const meta = parseClaimReviewMeta({
      claims: [],
      [REVIEW_META_KEY]: {
        reviewedFieldKeys: ["Patient-name", "Billing-total_amount_read"],
        updatedAt: "2026-06-19T10:00:00.000Z",
      },
    });

    expect(meta.reviewedFieldKeys).toEqual(["Patient-name", "Billing-total_amount_read"]);
    expect(meta.updatedAt).toBe("2026-06-19T10:00:00.000Z");
  });

  it("returns empty meta when review block is missing", () => {
    expect(parseClaimReviewMeta({ claims: [] })).toEqual({ reviewedFieldKeys: [] });
    expect(parseClaimReviewMeta(null)).toEqual({ reviewedFieldKeys: [] });
  });

  it("strips review meta from payload", () => {
    const payload = {
      claims: [{ patient: { name: { value: "Jane" } } }],
      [REVIEW_META_KEY]: { reviewedFieldKeys: ["Patient-name"] },
    };
    expect(stripReviewMeta(payload)).toEqual({
      claims: [{ patient: { name: { value: "Jane" } } }],
    });
  });
});
