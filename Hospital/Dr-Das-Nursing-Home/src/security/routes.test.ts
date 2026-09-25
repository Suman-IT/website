import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Pool } from "mysql2/promise";
import { createApp } from "../app.js";
import { parseConfiguration } from "../config/config.js";

const parsed = parseConfiguration(
  readFileSync("FEATURES.yaml", "utf8"),
  readFileSync("HOSPITAL_CONFIG.yaml", "utf8"),
);
const configuration = { ...parsed, port: 3000, nodeEnv: "test", appOrigin: "http://localhost:3000" };

test("public identity works while staff routes fail closed without a session", async () => {
  const pool = {
    async execute(sql: string) {
      if (sql.includes("FROM hospitals WHERE is_active")) {
        return [[{ id: "1", display_name: parsed.hospital.displayName, timezone: "Asia/Kolkata" }]];
      }
      return [[]];
    },
  } as unknown as Pool;
  const app = createApp(configuration, pool);
  const server = app.listen(0);
  try {
    if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const publicResponse = await fetch(`${base}/api/public/hospital`);
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(await publicResponse.json(), { displayName: parsed.hospital.displayName });

    const staffResponse = await fetch(`${base}/api/staff/auth/me`);
    assert.equal(staffResponse.status, 401);
    assert.equal(staffResponse.headers.get("cache-control"), "no-store");

    const adminResponse = await fetch(`${base}/api/staff/admin/hospital`);
    assert.equal(adminResponse.status, 401);

    const crossOrigin = await fetch(`${base}/api/staff/auth/login`, {
      method: "POST", headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.invalid", password: "irrelevant" }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    server.close();
  }
});
