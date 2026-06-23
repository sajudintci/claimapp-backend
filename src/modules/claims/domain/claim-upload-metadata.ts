export type ClaimUploadMetadata = {
  patientName: string | null;
  documentType: string[];
  priority: string | null;
  notes: string | null;
};

const VALID_DOCUMENT_TYPES = new Set(["Inpatient Claim", "Outpatient Claim"]);

export function parseClaimUploadMetadata(body: Record<string, unknown>): ClaimUploadMetadata {
  return {
    patientName: readOptionalString(body.patientName),
    documentType: readDocumentTypes(body.documentType),
    priority: readOptionalString(body.priority),
    notes: readOptionalString(body.notes),
  };
}

const VALID_PRIORITIES = new Set(["Normal", "High", "Urgent"]);

export type ClaimUploadMetadataValidationError = {
  field: string;
  message: string;
};

export function validateClaimUploadInput(input: {
  claimNumber?: unknown;
  reviewerId?: unknown;
  metadata: ClaimUploadMetadata;
}): ClaimUploadMetadataValidationError[] {
  const errors: ClaimUploadMetadataValidationError[] = [];

  const claimNumber = typeof input.claimNumber === "string" ? input.claimNumber.trim() : "";
  if (!claimNumber) {
    errors.push({ field: "claimNumber", message: "Claim reference is required" });
  }

  if (!input.metadata.patientName) {
    errors.push({ field: "patientName", message: "Patient name is required" });
  }

  if (input.metadata.documentType.length === 0) {
    errors.push({ field: "documentType", message: "Document type is required" });
  }

  if (!input.metadata.priority || !VALID_PRIORITIES.has(input.metadata.priority)) {
    errors.push({ field: "priority", message: "Priority is required" });
  }

  const reviewerId = typeof input.reviewerId === "string" ? input.reviewerId.trim() : "";
  if (!reviewerId) {
    errors.push({ field: "reviewerId", message: "Reviewer assignment is required" });
  }

  return errors;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDocumentTypes(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : value != null ? [value] : [];
  const normalized = rawValues
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(normalized)).filter((entry) => VALID_DOCUMENT_TYPES.has(entry));
}
