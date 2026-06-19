import { isS3StorageRef } from "@/storage/storage-ref";
import { LocalStorageService } from "@/storage/local/local-storage.service";
import { S3StorageService } from "@/storage/s3/s3-storage.service";
import type { StorageService } from "@/storage/storage.interface";
import { env } from "@/config/env";

let storageService: StorageService | null = null;
let localStorageService: LocalStorageService | null = null;
let s3StorageService: S3StorageService | null = null;

function getLocalStorageService(): LocalStorageService {
  if (!localStorageService) localStorageService = new LocalStorageService();
  return localStorageService;
}

function getS3StorageService(): S3StorageService {
  if (!s3StorageService) s3StorageService = new S3StorageService();
  return s3StorageService;
}

export function getStorageService(): StorageService {
  if (!storageService) {
    storageService = env.STORAGE_DRIVER === "s3" ? getS3StorageService() : getLocalStorageService();
  }
  return storageService;
}

/** Read object using ref prefix (supports legacy local paths during S3 migration). */
export async function readStorageRef(storageRef: string): Promise<Buffer> {
  if (isS3StorageRef(storageRef)) {
    return getS3StorageService().readBuffer(storageRef);
  }
  return getLocalStorageService().readBuffer(storageRef);
}

export async function openStorageRefStream(storageRef: string) {
  if (isS3StorageRef(storageRef)) {
    return getS3StorageService().openReadStream(storageRef);
  }
  return getLocalStorageService().openReadStream(storageRef);
}

export function resetStorageServiceForTests(): void {
  storageService = null;
  localStorageService = null;
  s3StorageService = null;
}
