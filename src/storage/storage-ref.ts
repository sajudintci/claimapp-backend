const S3_PREFIX = "s3:";

export function isS3StorageRef(storageRef: string): boolean {
  return storageRef.startsWith(S3_PREFIX);
}

export function toS3StorageRef(key: string): string {
  return `${S3_PREFIX}${key}`;
}

export function parseS3StorageKey(storageRef: string): string {
  if (!isS3StorageRef(storageRef)) {
    throw new Error(`Invalid S3 storage reference: ${storageRef}`);
  }
  return storageRef.slice(S3_PREFIX.length);
}

export function joinStorageKey(...segments: string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}
