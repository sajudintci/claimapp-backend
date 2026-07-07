import { describe, expect, it } from "vitest";
import {
  parseClaimReviewMeta,
  REVIEW_META_KEY,
  stripReviewMeta,
} from "@/modules/claims/domain/claim-review-result";

describe("claim-review-result", () => {
  it("parses review timestamp from payload meta", () => {
    const meta = parseClaimReviewMeta({
      claims: [],
      [REVIEW_META_KEY]: {
        updatedAt: "2026-06-19T10:00:00.000Z",
      },
    });

    expect(meta.updatedAt).toBe("2026-06-19T10:00:00.000Z");
  });

  it("returns empty meta when review block is missing", () => {
    expect(parseClaimReviewMeta({ claims: [] })).toEqual({});
    expect(parseClaimReviewMeta(null)).toEqual({});
  });

  it("strips review meta from payload", () => {
    const payload = {
      claims: [{ patient: { name: { value: "Jane" } } }],
      [REVIEW_META_KEY]: { updatedAt: "2026-06-19T10:00:00.000Z" },
    };
    expect(stripReviewMeta(payload)).toEqual({
      claims: [{ patient: { name: { value: "Jane" } } }],
    });
  });
});
