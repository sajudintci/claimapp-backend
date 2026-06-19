import { NextFunction, Request, Response } from "express";
import { accessLogger } from "@/infrastructure/logger/winston";
import { clientIp } from "@/utils/audit-request";

export const requestLogMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    if (req.originalUrl === "/health") return;

    accessLogger.info("HTTP request", {
      requestId: req.requestId,
      userId: req.auth?.sub,
      organizationId: req.auth?.org,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
  });

  next();
};
