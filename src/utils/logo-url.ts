import { env } from "@/config/env";
import { joinStorageKey } from "@/storage/storage-ref";

/** Public URL for stored organization logo files. */
export function buildOrganizationLogoUrl(logoFileName: string | null | undefined): string | null {
  if (!logoFileName) return null;
  if (env.STORAGE_DRIVER === "s3" && env.S3_PUBLIC_BASE_URL) {
    const key = joinStorageKey(env.S3_KEY_PREFIX, env.S3_LOGO_PREFIX, logoFileName);
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  return `/api/public/logos/${logoFileName}`;
}
