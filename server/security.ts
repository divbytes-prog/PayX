import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { config, ConfigurationError } from "./config.js";

const scrypt = promisify(nodeScrypt);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltText, "base64url"),
    expected.length,
  )) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueToken(prefix = "") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function credentialKey() {
  if (!config.encryptionKey) {
    throw new ConfigurationError(
      "CREDENTIAL_ENCRYPTION_KEY is required to store gateway credentials",
    );
  }
  const key = Buffer.from(config.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new ConfigurationError(
      "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64",
    );
  }
  return key;
}

export function encryptCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCredentials<T extends Record<string, unknown>>(
  value: string,
): T {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText)
    throw new Error("Invalid credential envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
