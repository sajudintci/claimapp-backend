import { env } from "@/config/env";

export type LogType = "app" | "error" | "audit" | "access";

export type StructuredLogFields = {
  logType?: LogType;
  requestId?: string;
  userId?: string;
  organizationId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  [key: string]: unknown;
};

export function baseLogFields(logType: LogType): Record<string, unknown> {
  return {
    logType,
    service: env.LOG_SERVICE_NAME,
    environment: env.NODE_ENV,
  };
}

export function mergeLogMeta(
  logType: LogType,
  meta: StructuredLogFields = {},
): Record<string, unknown> {
  return {
    ...baseLogFields(logType),
    ...meta,
  };
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: "code" in err ? (err as { code?: unknown }).code : undefined,
    };
  }
  return { message: String(err) };
}
