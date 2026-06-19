import { NextFunction, Request, Response } from "express";
import { logError } from "@/infrastructure/logger/log-error";
import { logger } from "@/infrastructure/logger/winston";
import { serializeError } from "@/infrastructure/logger/structured-log";
import { clientIp } from "@/utils/audit-request";

export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function requestFields(req: Request) {
  return {
    requestId: req.requestId,
    userId: req.auth?.sub,
    organizationId: req.auth?.org,
    method: req.method,
    path: req.originalUrl,
    ip: clientIp(req),
  };
}

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(404, "Route not found"));
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    const fields = {
      ...requestFields(req),
      status: err.status,
      details: err.details,
      error: serializeError(err),
    };

    if (err.status >= 500) {
      logError("Application error", err, fields, req);
    } else {
      logger.warn("Client error", fields);
    }

    return res.fail({
      status: err.status,
      message: err.message,
      error: { type: "AppError", details: err.details },
    });
  }

  logError("Unhandled error", err, { ...requestFields(req), status: 500 }, req);
  return res.fail({
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    error: { type: "InternalServerError" },
  });
};
