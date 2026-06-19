import dotenv from "dotenv";
import { z } from "zod";

// In Docker/Coolify, set runtime env vars — .env is not copied into the image.
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  /** Public REST API version segment (e.g. routes mount at /api/v1). */
  API_VERSION: z.string().regex(/^v\d+$/).default("v1"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(10),
  JWT_REFRESH_SECRET: z.string().min(10),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
  /** Full URL (recommended for managed Redis). Overrides HOST/PORT/PASSWORD when set. */
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),
  STORAGE_PATH: z.string().default("./storage"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("s3"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("ap-southeast-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  S3_KEY_PREFIX: z.string().default("claimora"),
  S3_UPLOAD_PREFIX: z.string().default("uploads"),
  S3_AVATAR_PREFIX: z.string().default("avatars"),
  S3_PROCESSED_PREFIX: z.string().default("processed"),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  ENABLE_LLM_POST_PROCESS: z.string().default("false"),
  /** When true, fill missing medical_summary/diagnosis from structured line items & labs (LLM + fallback). */
  ENABLE_CLINICAL_FIELD_SYNTHESIS: z.string().default("true"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_OCR_MAX_CHARS: z.coerce.number().default(24000),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().default(120000),
  LLM_MAX_RETRIES: z.coerce.number().default(2),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(16384),
  BILLING_MISMATCH_TOLERANCE_PERCENT: z.coerce.number().default(2),
  OCR_MIN_TEXT_CHARS: z.coerce.number().default(80),
  PDF_OCR_MAX_PAGES: z.coerce.number().default(12),
  OCR_LANGUAGES: z.string().default("eng+ind"),
  OCR_LOG_PREVIEW_CHARS: z.coerce.number().default(3000),
  LOG_OCR_TO_FILE: z.string().default("true"),
  ABBYY_BASE_URL: z.string().default("https://vantage-au.abbyy.com"),
  ABBYY_CLIENT_ID: z.string().default(""),
  ABBYY_CLIENT_SECRET: z.string().default(""),
  ABBYY_SKILL_ID: z.string().default(""),
  ABBYY_SKILL_NAME: z.string().default("ocr"),
  ABBYY_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  ABBYY_TRANSACTION_TIMEOUT_MS: z.coerce.number().default(300000),
  OCR_CREDITS_MONTHLY_QUOTA: z.coerce.number().default(16000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().default(25),
  OUTBOX_MAX_PUBLISH_ATTEMPTS: z.coerce.number().default(10),
  DISTRIBUTED_LOCK_KEY_PREFIX: z.string().default("claimora:lock"),
  DISTRIBUTED_LOCK_TTL_MS: z.coerce.number().default(30000),
  CIRCUIT_BREAKER_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().default(60000),
  CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD: z.coerce.number().default(2),
  BULKHEAD_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  BULKHEAD_ABBYY_MAX_CONCURRENT: z.coerce.number().default(3),
  BULKHEAD_ABBYY_MAX_WAITING: z.coerce.number().default(10),
  BULKHEAD_ABBYY_ACQUIRE_TIMEOUT_MS: z.coerce.number().default(120000),
  BULKHEAD_OPENAI_MAX_CONCURRENT: z.coerce.number().default(5),
  BULKHEAD_OPENAI_MAX_WAITING: z.coerce.number().default(20),
  BULKHEAD_OPENAI_ACQUIRE_TIMEOUT_MS: z.coerce.number().default(120000),
  BULKHEAD_EXTRACTION_WORKER_CONCURRENCY: z.coerce.number().default(2),
  LOG_DIR: z.string().default("./storage/logs"),
  LOG_SERVICE_NAME: z.string().default("claimora-backend"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  LOG_STRUCTURED_CONSOLE: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  LOG_MAX_FILE_SIZE: z.string().default("20m"),
  LOG_RETENTION_DAYS: z.string().default("14d"),
  LOG_ERROR_RETENTION_DAYS: z.string().default("90d"),
  LOG_AUDIT_RETENTION_DAYS: z.string().default("365d"),
  LOG_CENTRAL_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  LOG_CENTRAL_URL: z.string().optional(),
  LOG_CENTRAL_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.STORAGE_DRIVER === "s3" && !parsed.data.S3_BUCKET) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment: S3_BUCKET is required when STORAGE_DRIVER=s3");
  process.exit(1);
}

export const env = parsed.data;
