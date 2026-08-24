import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/config";

/**
 * Encrypts OAuth tokens at rest when SOCIAL_TOKEN_ENC_KEY is set. If it is not,
 * tokens are stored as-is (the social_connections table is already service-role
 * only). Any stored value can always be read back regardless of the current key
 * state: encrypted values carry the "enc:v1:" prefix, plaintext does not.
 */
const PREFIX = "enc:v1:";

function keyBytes(): Buffer | null {
  const raw = getServerEnv().SOCIAL_TOKEN_ENC_KEY;
  if (!raw) return null;
  // Accept any key string; derive a stable 32-byte key from it.
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(plain: string): string {
  const key = keyBytes();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // plaintext
  const key = keyBytes();
  if (!key) throw new Error("SOCIAL_TOKEN_ENC_KEY is required to read an encrypted token");
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
