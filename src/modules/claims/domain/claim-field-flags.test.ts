import { describe, expect, it } from "vitest";
import {
  countFlaggedFields,
  FIELD_FLAGS_META_KEY,
  parseClaimFieldFlags,
  stripFieldFlags,
} from "@/modules/claims/domain/claim-field-flags";

describe("claim-field-flags", () => {
  it("parses field flags from payload meta", () => {
    const meta = parseClaimFieldFlags({
      claims: [],
      [FIELD_FLAGS_META_KEY]: {
        flags: {
          "Patient-name": 2,
          "Billing-total_amount_read": 1,
        },
        updatedAt: "2026-06-19T10:00:00.000Z",
      },
    });

    expect(meta.flags).toEqual({
      "Patient-name": 2,
      "Billing-total_amount_read": 1,
    });
    expect(meta.updatedAt).toBe("2026-06-19T10:00:00.000Z");
    expect(countFlaggedFields(meta)).toBe(2);
  });

  it("returns empty flags when meta block is missing", () => {
    expect(parseClaimFieldFlags({ claims: [] })).toEqual({ flags: {} });
    expect(parseClaimFieldFlags(null)).toEqual({ flags: {} });
  });

  it("migrates legacy _review.fieldCheckStatus", () => {
    const meta = parseClaimFieldFlags({
      claims: [],
      _review: {
        fieldCheckStatus: { "Patient-name": 3 },
      },
    });
    expect(meta.flags).toEqual({ "Patient-name": 3 });
  });

  it("migrates legacy reviewedFieldKeys to status 2", () => {
    const meta = parseClaimFieldFlags({
      claims: [],
      _review: {
        reviewedFieldKeys: ["Patient-name"],
      },
    });
    expect(meta.flags).toEqual({ "Patient-name": 2 });
  });

  it("strips field flags from payload", () => {
    const payload = {
      claims: [{ patient: { name: { value: "Jane" } } }],
      [FIELD_FLAGS_META_KEY]: { flags: { "Patient-name": 2 } },
    };
    expect(stripFieldFlags(payload)).toEqual({
      claims: [{ patient: { name: { value: "Jane" } } }],
    });
  });
});
