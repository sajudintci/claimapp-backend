export const FIELD_FLAGS_META_KEY = "_fieldFlags";

/** 0 = neutral, 1 = question, 2 = verified, 3 = rejected — UI-only annotations. */
export type FieldFlagStatus = 0 | 1 | 2 | 3;

export type ClaimFieldFlagsMeta = {
  flags: Record<string, FieldFlagStatus>;
  updatedAt?: string;
};

function isValidFieldFlagStatus(value: unknown): value is FieldFlagStatus {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function parseClaimFieldFlags(
  payload: Record<string, unknown> | null | undefined,
): ClaimFieldFlagsMeta {
  if (!payload) return { flags: {} };

  const raw = payload[FIELD_FLAGS_META_KEY];
  if (raw && typeof raw === "object") {
    const meta = raw as ClaimFieldFlagsMeta;
    const flags: Record<string, FieldFlagStatus> = {};
    if (meta.flags && typeof meta.flags === "object") {
      for (const [key, status] of Object.entries(meta.flags)) {
        if (isValidFieldFlagStatus(status)) {
          flags[key] = status;
        }
      }
    }
    return {
      flags,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : undefined,
    };
  }

  return migrateLegacyFieldFlags(payload);
}

function migrateLegacyFieldFlags(payload: Record<string, unknown>): ClaimFieldFlagsMeta {
  const review = payload._review;
  if (!review || typeof review !== "object") return { flags: {} };

  const meta = review as {
    fieldCheckStatus?: Record<string, unknown>;
    reviewedFieldKeys?: unknown;
  };

  const flags: Record<string, FieldFlagStatus> = {};
  if (meta.fieldCheckStatus && typeof meta.fieldCheckStatus === "object") {
    for (const [key, status] of Object.entries(meta.fieldCheckStatus)) {
      if (isValidFieldFlagStatus(status)) {
        flags[key] = status;
      }
    }
  }

  if (Array.isArray(meta.reviewedFieldKeys)) {
    for (const key of meta.reviewedFieldKeys) {
      if (typeof key === "string" && flags[key] === undefined) {
        flags[key] = 2;
      }
    }
  }

  return { flags };
}

export function countFlaggedFields(meta: ClaimFieldFlagsMeta): number {
  return Object.values(meta.flags).filter((status) => status !== 0).length;
}

export function stripFieldFlags(payload: Record<string, unknown>): Record<string, unknown> {
  const { [FIELD_FLAGS_META_KEY]: _flags, ...rest } = payload;
  return rest;
}
