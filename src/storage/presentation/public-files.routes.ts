import { Router } from "express";
import { getStorageService } from "@/storage/storage.factory";

const router = Router();

router.get("/avatars/:fileName", async (req, res, next) => {
  try {
    const fileName = req.params.fileName;
    if (!fileName || fileName.includes("..") || fileName.includes("/")) {
      return res.status(400).json({ message: "Invalid avatar file name" });
    }

    const storage = getStorageService();
    const { stream, contentType } = await storage.resolveAvatarStream(fileName);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (err) {
    return next(err);
  }
});

router.get("/logos/:fileName", async (req, res, next) => {
  try {
    const fileName = req.params.fileName;
    if (!fileName || fileName.includes("..") || fileName.includes("/")) {
      return res.status(400).json({ message: "Invalid logo file name" });
    }

    const storage = getStorageService();
    const { stream, contentType } = await storage.resolveLogoStream(fileName);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    stream.on("error", next);
    return stream.pipe(res);
  } catch (err) {
    return next(err);
  }
});

export const publicFilesRoutes = router;
