import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { env } from "@/config/env";
import { logger } from "@/infrastructure/logger/winston";
import { errorHandler, notFoundHandler } from "@/infrastructure/http/error-handler";
import { attachApiResponse } from "@/infrastructure/http/api-response";
import { rateLimiter } from "@/infrastructure/security/rate-limit";
import { apiRouter } from "@/routes";

export const createApp = () => {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(attachApiResponse);
  app.use(rateLimiter);
  app.use(
    morgan("combined", {
      stream: { write: (message) => logger.info(message.trim()) }
    })
  );

  app.get("/health", (_req, res) => res.success({ status: "ok" }));
  app.use(
    "/api/public/avatars",
    express.static(path.join(env.STORAGE_PATH, "avatars"), {
      maxAge: "7d",
    }),
  );
  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
