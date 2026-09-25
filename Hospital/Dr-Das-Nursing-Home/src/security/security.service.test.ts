import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "mysql2/promise";
import { SecurityService, type Principal } from "./security.service.js";

test("appointment access requires hospital scope and a permission", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    async execute(sql: string, values: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("FROM user_roles")) return [[{ permission: 1 }]];
      if (sql.includes("FROM appointments WHERE")) {
        return [values[0] === "1" && values[1] === "42" ? [{ found: 1 }] : []];
      }
      return [[]];
    },
  } as unknown as Pool;
  const security = new SecurityService(pool);
  const first: Principal = { userId: "7", hospitalId: "1", displayName: "Staff" };
  const second: Principal = { userId: "8", hospitalId: "2", displayName: "Other" };

  assert.equal(await security.canReadAppointment(first, "42"), true);
  assert.equal(await security.canReadAppointment(second, "42"), false);
  assert.equal(await security.canReadAppointment(first, "invalid"), false);
  assert.ok(calls.some((call) => call.sql.includes("hospital_id = ? AND id = ?") &&
    call.values[0] === "2" && call.values[1] === "42"));
});
