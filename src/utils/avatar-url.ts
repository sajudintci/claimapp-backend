import { env } from "@/config/env";
import { joinStorageKey } from "@/storage/storage-ref";

/** Public URL for stored avatar files. */
export function buildAvatarUrl(avatarFileName: string | null | undefined): string | null {
  if (!avatarFileName) return null;
  if (env.STORAGE_DRIVER === "s3" && env.S3_PUBLIC_BASE_URL) {
    const key = joinStorageKey(env.S3_KEY_PREFIX, env.S3_AVATAR_PREFIX, avatarFileName);
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  return `/api/public/avatars/${avatarFileName}`;
}
