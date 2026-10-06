import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit key derived from GOOGLE_TOKEN_ENCRYPTION_KEY (any string of 32+ characters). */
function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`victory-rooms:google-token:${secret}`).digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url. */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognized encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC-signed value for short-lived cookies (OAuth state). */
export function signValue(value: string, secret: string): string {
  const mac = createHmac("sha256", keyFrom(secret)).update(value).digest("base64url");
  return `${Buffer.from(value).toString("base64url")}.${mac}`;
}

export function verifySignedValue(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const [encoded, mac] = signed.split(".");
  if (!encoded || !mac) return null;
  const value = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(createHmac("sha256", keyFrom(secret)).update(value).digest("base64url"));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? value : null;
}
