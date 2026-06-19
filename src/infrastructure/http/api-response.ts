import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { env } from "@/config/env";

type ApiErrorPayload = {
  type?: string;
  details?: unknown;
};

type ApiMeta = {
  timestamp: string;
  requestId: string;
  version: string;
  pagination?: {
    page: number;
    limit: number;
    totalRows: number;
    totalPages: number;
  };
};

type SuccessOptions = {
  status?: number;
  code?: string;
  message?: string;
  pagination?: ApiMeta["pagination"];
};

type FailOptions = {
  status?: number;
  code?: string;
  message: string;
  error?: ApiErrorPayload | null;
};

function buildMeta(req: Request, pagination?: ApiMeta["pagination"]): ApiMeta {
  return {
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    version: env.API_VERSION,
    ...(pagination ? { pagination } : {}),
  };
}

function defaultSuccess(status: number) {
  if (status === 201) return { code: "DATA_CREATED", message: "Data created successfully" };
  if (status === 204) return { code: "NO_CONTENT", message: "No content" };
  return { code: "DATA_RETRIEVED", message: "Data retrieved successfully" };
}

function defaultErrorCode(status: number) {
  if (status === 400) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  return "INTERNAL_SERVER_ERROR";
}

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }

  interface Response {
    success: (data: unknown, options?: SuccessOptions) => Response;
    fail: (options: FailOptions) => Response;
  }
}

export const attachApiResponse = (req: Request, res: Response, next: NextFunction) => {
  req.requestId = req.headers["x-request-id"]?.toString() || randomUUID();
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (
      body &&
      typeof body === "object" &&
      "success" in (body as Record<string, unknown>) &&
      "meta" in (body as Record<string, unknown>)
    ) {
      return originalJson(body);
    }

    const status = res.statusCode || 200;
    if (status >= 400) {
      return originalJson({
        success: false,
        code: defaultErrorCode(status),
        message: "Request failed",
        data: null,
        error: body ?? null,
        meta: buildMeta(req),
      });
    }

    return originalJson({
      success: true,
      code: defaultSuccess(status).code,
      message: defaultSuccess(status).message,
      data: body,
      error: null,
      meta: buildMeta(req),
    });
  }) as Response["json"];

  res.success = (data: unknown, options: SuccessOptions = {}) => {
    const status = options.status ?? 200;
    const defaults = defaultSuccess(status);
    return res.status(status).json({
      success: true,
      code: options.code ?? defaults.code,
      message: options.message ?? defaults.message,
      data,
      error: null,
      meta: buildMeta(req, options.pagination),
    });
  };

  res.fail = (options: FailOptions) => {
    const status = options.status ?? 400;
    return res.status(status).json({
      success: false,
      code: options.code ?? defaultErrorCode(status),
      message: options.message,
      data: null,
      error: options.error ?? null,
      meta: buildMeta(req),
    });
  };

  next();
};
