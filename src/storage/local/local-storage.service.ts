import fs from "fs/promises";
import path from "path";
import { env } from "@/config/env";
import { StorageService } from "@/storage/storage.interface";
import { createId } from "@/utils/id";

export class LocalStorageService implements StorageService {
  async saveUpload(file: Express.Multer.File) {
    await fs.mkdir(path.join(env.STORAGE_PATH, "uploads"), { recursive: true });
    const ext = path.extname(file.originalname);
    const fileName = `${createId()}${ext}`;
    const finalPath = path.join(env.STORAGE_PATH, "uploads", fileName);
    await fs.writeFile(finalPath, file.buffer);
    return { path: finalPath, fileName };
  }

  async saveAvatar(file: Express.Multer.File) {
    await fs.mkdir(path.join(env.STORAGE_PATH, "avatars"), { recursive: true });
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const fileName = `${createId()}${ext}`;
    const finalPath = path.join(env.STORAGE_PATH, "avatars", fileName);
    await fs.writeFile(finalPath, file.buffer);
    return { path: finalPath, fileName };
  }

  async deleteAvatarFile(fileName: string) {
    if (!fileName || fileName.includes("..") || fileName.includes("/")) return;
    const target = path.join(env.STORAGE_PATH, "avatars", fileName);
    try {
      await fs.unlink(target);
    } catch {
      // ignore missing file
    }
  }

  async moveToProcessed(currentPath: string) {
    await fs.mkdir(path.join(env.STORAGE_PATH, "processed"), { recursive: true });
    const target = path.join(env.STORAGE_PATH, "processed", path.basename(currentPath));
    await fs.rename(currentPath, target);
    return target;
  }
}
