import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "@/config/env";
import { errorHandler, notFoundHandler } from "@/infrastructure/http/error-handler";
import { attachApiResponse } from "@/infrastructure/http/api-response";
import { rateLimiter } from "@/infrastructure/security/rate-limit";
import {
  abbyyCircuitBreaker,
  openaiCircuitBreaker,
} from "@/infrastructure/resilience/circuit-breakers";
import { getBulkheadStats } from "@/infrastructure/resilience/bulkheads";
import { requestContextMiddleware } from "@/middlewares/request-context.middleware";
import { requestLogMiddleware } from "@/middlewares/request-log.middleware";
import { publicFilesRoutes } from "@/storage/presentation/public-files.routes";
import { apiRouter } from "@/routes";

export const createApp = () => {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cors());
  // app.options('*', cors());
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(attachApiResponse);
  app.use(requestContextMiddleware);
  app.use(requestLogMiddleware);
  app.use(rateLimiter);

  app.get("/health", (_req, res) =>
    res.success({
      status: "ok",
      circuitBreakers: {
        abbyy: abbyyCircuitBreaker.getState(),
        openai: openaiCircuitBreaker.getState(),
      },
      bulkheads: getBulkheadStats(),
    }),
  );
  app.use(
    "/api/public",
    publicFilesRoutes,
  );

  const versionedApiPath = `/api/${env.API_VERSION}`;
  app.use(versionedApiPath, apiRouter);
  // Backward-compatible alias until clients migrate to /api/v1
  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
