import type { Request } from "express";
import { errorLogger, logger } from "@/infrastructure/logger/winston";
import { serializeError } from "@/infrastructure/logger/structured-log";
import { clientIp } from "@/utils/audit-request";

type ErrorLogContext = Record<string, unknown>;

function requestFields(req?: Request): ErrorLogContext {
  if (!req) return {};
  return {
    requestId: req.requestId,
    userId: req.auth?.sub,
    organizationId: req.auth?.org,
    method: req.method,
    path: req.originalUrl,
    ip: clientIp(req),
  };
}

/** Record an error to structured app + error log streams. */
export function logError(
  message: string,
  err: unknown,
  context: ErrorLogContext = {},
  req?: Request,
): void {
  const payload = {
    ...requestFields(req),
    ...context,
    error: serializeError(err),
  };

  logger.error(message, payload);
  errorLogger.error(message, payload);
}

export function registerProcessErrorHandlers(): void {
  process.on("uncaughtException", (err) => {
    logError("Uncaught exception", err, { fatal: true });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logError("Unhandled promise rejection", reason, { fatal: false });
  });
}
