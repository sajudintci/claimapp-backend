import type { Readable } from "stream";

export type StorageObjectRef = {
  /** Opaque storage reference persisted in the database. */
  path: string;
  fileName: string;
};

export interface StorageService {
  readonly driver: "local" | "s3";
  saveUpload(file: Express.Multer.File): Promise<StorageObjectRef>;
  saveAvatar(file: Express.Multer.File): Promise<StorageObjectRef>;
  deleteAvatarFile(fileName: string): Promise<void>;
  moveToProcessed(storageRef: string): Promise<string>;
  readBuffer(storageRef: string): Promise<Buffer>;
  openReadStream(storageRef: string): Promise<{ stream: Readable; contentType?: string }>;
  resolveAvatarStream(fileName: string): Promise<{ stream: Readable; contentType: string }>;
}
