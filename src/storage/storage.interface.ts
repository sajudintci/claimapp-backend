export interface StorageService {
  saveUpload(file: Express.Multer.File): Promise<{ path: string; fileName: string }>;
  saveAvatar(file: Express.Multer.File): Promise<{ path: string; fileName: string }>;
  deleteAvatarFile(fileName: string): Promise<void>;
  moveToProcessed(path: string): Promise<string>;
}
