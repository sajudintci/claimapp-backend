import dotenv from "dotenv";
import { z } from "zod";

// In Docker/Coolify, set runtime env vars — .env is not copied into the image.
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
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
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  ENABLE_LLM_POST_PROCESS: z.string().default("false"),
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
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
