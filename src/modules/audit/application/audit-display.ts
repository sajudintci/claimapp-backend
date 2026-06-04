export function normalizeAuditChanges(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function auditPayloadWithoutResult(
  data: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!data) return {};
  const { result: _result, ...rest } = data;
  return rest;
}
