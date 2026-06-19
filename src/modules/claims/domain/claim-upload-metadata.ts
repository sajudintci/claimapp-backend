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

export function hasUploadMetadata(metadata: ClaimUploadMetadata): boolean {
  return Boolean(
    metadata.patientName ||
      metadata.documentType.length > 0 ||
      metadata.priority ||
      metadata.notes,
  );
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
