import { describe, expect, it } from "vitest";
import {
  hasUploadMetadata,
  parseClaimUploadMetadata,
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

  it("detects when metadata has at least one value", () => {
    expect(
      hasUploadMetadata({
        patientName: null,
        documentType: ["Outpatient Claim"],
        priority: null,
        notes: null,
      }),
    ).toBe(true);
  });
});
