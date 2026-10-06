// Creates the private image bucket on Neon Object Storage if it doesn't exist yet.
// Safe to re-run. Usage: npm run storage:setup
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

const env = process.env;
const missing = ["AWS_ENDPOINT_URL_S3", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].filter((key) => !env[key]?.trim());
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}

const bucket = env.S3_BUCKET_NAME || env.STORAGE_BUCKET || "booking-assets";
const s3 = new S3Client({
  endpoint: env.AWS_ENDPOINT_URL_S3,
  region: env.AWS_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY },
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket "${bucket}" already exists`);
} catch (error) {
  if (error?.$metadata?.httpStatusCode !== 404) {
    console.error(`could not check bucket: ${error?.name ?? "error"} (HTTP ${error?.$metadata?.httpStatusCode ?? "?"})`);
    process.exit(1);
  }
  // Neon buckets are private unless an admin switches them to public_read in the console.
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`bucket "${bucket}" created (private)`);
}
