import { NextFunction, Request, Response } from "express";
import { requestContextStorage } from "@/infrastructure/logger/request-context";

export const requestContextMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  requestContextStorage.run(
    {
      requestId: req.requestId,
      userId: req.auth?.sub,
      organizationId: req.auth?.org,
      method: req.method,
      path: req.originalUrl,
    },
    next,
  );
};
