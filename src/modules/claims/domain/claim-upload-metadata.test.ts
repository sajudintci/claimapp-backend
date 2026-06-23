import { describe, expect, it } from "vitest";
import {
  parseClaimUploadMetadata,
  validateClaimUploadInput,
} from "@/modules/claims/domain/claim-upload-metadata";

describe("claim-upload-metadata", () => {
  it("parses optional upload metadata fields", () => {
    expect(
      parseClaimUploadMetadata({
        patientName: " Dewi ",
        documentType: "Inpatient Claim",
        priority: "High",
        notes: "Urgent review",
      }),
    ).toEqual({
      patientName: "Dewi",
      documentType: ["Inpatient Claim"],
      priority: "High",
      notes: "Urgent review",
    });
  });

  it("parses multiple document types", () => {
    expect(
      parseClaimUploadMetadata({
        documentType: ["Inpatient Claim", "Outpatient Claim", "Inpatient Claim"],
      }),
    ).toEqual({
      patientName: null,
      documentType: ["Inpatient Claim", "Outpatient Claim"],
      priority: null,
      notes: null,
    });
  });

  it("normalizes blank values to null or empty arrays", () => {
    expect(
      parseClaimUploadMetadata({
        patientName: "   ",
        documentType: "",
        priority: undefined,
        notes: null,
      }),
    ).toEqual({
      patientName: null,
      documentType: [],
      priority: null,
      notes: null,
    });
  });

  it("requires all metadata fields except notes", () => {
    const metadata = parseClaimUploadMetadata({
      patientName: "Budi",
      documentType: "Inpatient Claim",
      priority: "High",
    });

    expect(
      validateClaimUploadInput({
        claimNumber: "CLM-2026-0001",
        reviewerId: "rev-1",
        metadata,
      }),
    ).toEqual([]);

    expect(
      validateClaimUploadInput({
        claimNumber: "",
        reviewerId: "",
        metadata: parseClaimUploadMetadata({}),
      }).map((error) => error.field),
    ).toEqual(["claimNumber", "patientName", "documentType", "priority", "reviewerId"]);
  });

  it("allows notes to be omitted", () => {
    const errors = validateClaimUploadInput({
      claimNumber: "CLM-2026-0001",
      reviewerId: "rev-1",
      metadata: parseClaimUploadMetadata({
        patientName: "Budi",
        documentType: "Outpatient Claim",
        priority: "Normal",
      }),
    });

    expect(errors).toEqual([]);
  });
});
