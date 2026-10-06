import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ImageStorage } from "@/lib/data/repository";
import { RepositoryError } from "@/lib/data/repository";
import { getStorageEnv } from "@/lib/env";

const globalForS3 = globalThis as typeof globalThis & { __victoryS3?: S3Client };

function client(): S3Client {
  if (!globalForS3.__victoryS3) {
    const env = getStorageEnv();
    globalForS3.__victoryS3 = new S3Client({
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
      // Neon Object Storage only supports path-style addressing.
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }
  return globalForS3.__victoryS3;
}

const bucket = () => {
  const env = getStorageEnv();
  return env.S3_BUCKET_NAME ?? env.STORAGE_BUCKET ?? "booking-assets";
};

/** Private bucket on Neon Object Storage (any S3-compatible endpoint works). */
export function createS3ImageStorage(): ImageStorage {
  return {
    async upload(key, bytes, contentType) {
      try {
        await client().send(
          new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType, CacheControl: "private, max-age=31536000, immutable" }),
        );
      } catch (error) {
        console.error(`[storage] upload failed for ${key}: ${error instanceof Error ? error.name : "unknown error"}`);
        throw new RepositoryError("unknown", "The image could not be uploaded.");
      }
    },
    async remove(key) {
      try {
        await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
      } catch (error) {
        console.error(`[storage] delete failed for ${key}: ${error instanceof Error ? error.name : "unknown error"}`);
      }
    },
  };
}

/** Short-lived read URL for a private object. Generated server-side only. */
export function signedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: expiresInSeconds });
}

