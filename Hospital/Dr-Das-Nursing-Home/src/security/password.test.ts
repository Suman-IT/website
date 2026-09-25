import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("password hashes verify without storing the password", async () => {
  const password = "local test password with length";
  const hash = await hashPassword(password);
  assert.ok(!hash.includes(password));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("different password", hash), false);
});

test("short bootstrap passwords are rejected", async () => {
  await assert.rejects(hashPassword("too short"), /12 to 1024/);
});
