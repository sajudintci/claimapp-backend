import { NextFunction, Request, Response } from "express";
import { logger } from "@/infrastructure/logger/winston";

export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(404, "Route not found"));
};

export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.fail({
      status: err.status,
      message: err.message,
      error: { type: "AppError", details: err.details },
    });
  }

  logger.error("Unhandled error", { err });
  return res.fail({
    status: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error",
    error: { type: "InternalServerError" },
  });
};
