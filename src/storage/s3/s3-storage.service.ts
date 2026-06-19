import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { env } from "@/config/env";
import { StorageService, StorageObjectRef } from "@/storage/storage.interface";
import { joinStorageKey, toS3StorageRef } from "@/storage/storage-ref";
import { createId } from "@/utils/id";

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  throw new Error("S3 object body is not a readable stream");
}

export class S3StorageService implements StorageService {
  readonly driver = "s3" as const;

  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  private uploadKey(prefix: string, fileName: string): string {
    return joinStorageKey(env.S3_KEY_PREFIX, prefix, fileName);
  }

  private avatarKey(fileName: string): string {
    return this.uploadKey(env.S3_AVATAR_PREFIX, fileName);
  }

  async saveUpload(file: Express.Multer.File): Promise<StorageObjectRef> {
    const ext = file.originalname.includes(".")
      ? file.originalname.slice(file.originalname.lastIndexOf("."))
      : "";
    const fileName = `${createId()}${ext}`;
    const key = this.uploadKey(env.S3_UPLOAD_PREFIX, fileName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return { path: toS3StorageRef(key), fileName };
  }

  async saveAvatar(file: Express.Multer.File): Promise<StorageObjectRef> {
    const ext = file.originalname.includes(".")
      ? file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase()
      : ".jpg";
    const fileName = `${createId()}${ext}`;
    const key = this.avatarKey(fileName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return { path: toS3StorageRef(key), fileName };
  }

  async deleteAvatarFile(fileName: string): Promise<void> {
    if (!fileName || fileName.includes("..") || fileName.includes("/")) return;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: this.avatarKey(fileName),
      }),
    );
  }

  async moveToProcessed(storageRef: string): Promise<string> {
    const sourceKey = storageRef.startsWith("s3:")
      ? storageRef.slice(3)
      : storageRef;
    const fileName = sourceKey.split("/").pop() ?? createId();
    const destinationKey = this.uploadKey(env.S3_PROCESSED_PREFIX, fileName);

    await this.client.send(
      new CopyObjectCommand({
        Bucket: env.S3_BUCKET,
        CopySource: `${env.S3_BUCKET}/${sourceKey}`,
        Key: destinationKey,
      }),
    );

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: sourceKey,
      }),
    );

    return toS3StorageRef(destinationKey);
  }

  async readBuffer(storageRef: string): Promise<Buffer> {
    const key = storageRef.startsWith("s3:") ? storageRef.slice(3) : storageRef;
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
    );

    return streamToBuffer(toReadable(response.Body));
  }

  async openReadStream(storageRef: string): Promise<{ stream: Readable; contentType?: string }> {
    const key = storageRef.startsWith("s3:") ? storageRef.slice(3) : storageRef;
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      }),
    );

    return {
      stream: toReadable(response.Body),
      contentType: response.ContentType,
    };
  }

  async resolveAvatarStream(fileName: string): Promise<{ stream: Readable; contentType: string }> {
    const { stream, contentType } = await this.openReadStream(toS3StorageRef(this.avatarKey(fileName)));
    return {
      stream,
      contentType: contentType ?? "image/jpeg",
    };
  }
}
