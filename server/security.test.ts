import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import {
  decryptCredentials,
  encryptCredentials,
  hashPassword,
  verifyPassword,
} from "./security.js";

test("password hashes verify without storing the password", async () => {
  const stored = await hashPassword("CorrectHorse7Battery");
  assert.notEqual(stored, "CorrectHorse7Battery");
  assert.equal(await verifyPassword("CorrectHorse7Battery", stored), true);
  assert.equal(await verifyPassword("incorrect", stored), false);
});

test("gateway credentials round-trip through authenticated encryption", () => {
  config.encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptCredentials({
    keyId: "rzp_test_example",
    keySecret: "never-plain-text",
  });
  assert.equal(encrypted.includes("never-plain-text"), false);
  assert.deepEqual(decryptCredentials(encrypted), {
    keyId: "rzp_test_example",
    keySecret: "never-plain-text",
  });
});
