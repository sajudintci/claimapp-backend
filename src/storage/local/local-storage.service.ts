import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { env } from "@/config/env";
import { StorageObjectRef, StorageService } from "@/storage/storage.interface";
import { createId } from "@/utils/id";

export class LocalStorageService implements StorageService {
  readonly driver = "local" as const;

  async saveUpload(file: Express.Multer.File): Promise<StorageObjectRef> {
    await fsPromises.mkdir(path.join(env.STORAGE_PATH, "uploads"), { recursive: true });
    const ext = path.extname(file.originalname);
    const fileName = `${createId()}${ext}`;
    const finalPath = path.join(env.STORAGE_PATH, "uploads", fileName);
    await fsPromises.writeFile(finalPath, file.buffer);
    return { path: finalPath, fileName };
  }

  async saveAvatar(file: Express.Multer.File): Promise<StorageObjectRef> {
    await fsPromises.mkdir(path.join(env.STORAGE_PATH, "avatars"), { recursive: true });
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const fileName = `${createId()}${ext}`;
    const finalPath = path.join(env.STORAGE_PATH, "avatars", fileName);
    await fsPromises.writeFile(finalPath, file.buffer);
    return { path: finalPath, fileName };
  }

  async deleteAvatarFile(fileName: string): Promise<void> {
    if (!fileName || fileName.includes("..") || fileName.includes("/")) return;
    const target = path.join(env.STORAGE_PATH, "avatars", fileName);
    try {
      await fsPromises.unlink(target);
    } catch {
      // ignore missing file
    }
  }

  async moveToProcessed(storageRef: string): Promise<string> {
    await fsPromises.mkdir(path.join(env.STORAGE_PATH, "processed"), { recursive: true });
    const target = path.join(env.STORAGE_PATH, "processed", path.basename(storageRef));
    await fsPromises.rename(storageRef, target);
    return target;
  }

  async readBuffer(storageRef: string): Promise<Buffer> {
    const resolved = path.isAbsolute(storageRef) ? storageRef : path.resolve(storageRef);
    return fsPromises.readFile(resolved);
  }

  async openReadStream(storageRef: string): Promise<{ stream: Readable; contentType?: string }> {
    const resolved = path.isAbsolute(storageRef) ? storageRef : path.resolve(storageRef);
    return { stream: fs.createReadStream(resolved) };
  }

  async resolveAvatarStream(fileName: string): Promise<{ stream: Readable; contentType: string }> {
    const target = path.join(env.STORAGE_PATH, "avatars", fileName);
    const ext = path.extname(fileName).toLowerCase();
    const contentType =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { stream: fs.createReadStream(target), contentType };
  }
}
