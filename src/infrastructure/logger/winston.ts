import fs from "fs";
import path from "path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { env } from "@/config/env";
import { CentralizedLogTransport } from "@/infrastructure/logger/centralized-transport";
import { contextFromStore } from "@/infrastructure/logger/request-context";
import { baseLogFields } from "@/infrastructure/logger/structured-log";

const logDir = path.resolve(env.LOG_DIR);
fs.mkdirSync(logDir, { recursive: true });

function attachContext(info: winston.Logform.TransformableInfo): winston.Logform.TransformableInfo {
  const ctx = contextFromStore();
  return { ...ctx, ...info };
}

const structuredJsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format(attachContext)(),
  winston.format.json(),
);

function createRotateTransport(
  filename: string,
  maxFiles: string,
  level?: string,
): DailyRotateFile {
  return new DailyRotateFile({
    filename: path.join(logDir, filename),
    datePattern: "YYYY-MM-DD",
    maxSize: env.LOG_MAX_FILE_SIZE,
    maxFiles,
    level,
    format: structuredJsonFormat,
  });
}

function createCentralizedTransport(level?: string): CentralizedLogTransport {
  return new CentralizedLogTransport({ level });
}

const consoleFormat =
  env.LOG_STRUCTURED_CONSOLE || env.NODE_ENV === "production"
    ? structuredJsonFormat
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf((info) => {
          const { timestamp, level, message, ...rest } = info;
          const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
          return `${timestamp} ${level}: ${message}${extra}`;
        }),
      );

const sharedTransports: winston.transport[] = [
  new winston.transports.Console({ format: consoleFormat }),
  createRotateTransport("app-%DATE%.json.log", env.LOG_RETENTION_DAYS),
];

if (env.LOG_CENTRAL_ENABLED) {
  sharedTransports.push(createCentralizedTransport());
}

/** Application / worker logs */
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: baseLogFields("app"),
  format: structuredJsonFormat,
  transports: [...sharedTransports],
});

/** Dedicated error stream (also written via logger.error) */
export const errorLogger = winston.createLogger({
  level: "error",
  defaultMeta: baseLogFields("error"),
  format: structuredJsonFormat,
  transports: [
    createRotateTransport("error-%DATE%.json.log", env.LOG_ERROR_RETENTION_DAYS, "error"),
    ...(env.LOG_CENTRAL_ENABLED ? [createCentralizedTransport("error")] : []),
  ],
});

/** Audit trail file copy (DB remains source of truth for queries) */
export const auditLogger = winston.createLogger({
  level: "info",
  defaultMeta: baseLogFields("audit"),
  format: structuredJsonFormat,
  transports: [
    createRotateTransport("audit-%DATE%.json.log", env.LOG_AUDIT_RETENTION_DAYS),
    ...(env.LOG_CENTRAL_ENABLED ? [createCentralizedTransport("info")] : []),
  ],
});

/** HTTP access logs */
export const accessLogger = winston.createLogger({
  level: "info",
  defaultMeta: baseLogFields("access"),
  format: structuredJsonFormat,
  transports: [
    createRotateTransport("access-%DATE%.json.log", env.LOG_RETENTION_DAYS),
    ...(env.LOG_CENTRAL_ENABLED ? [createCentralizedTransport("info")] : []),
  ],
});
