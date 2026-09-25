import { readFileSync } from "node:fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { loadConfiguration } from "../config/config.js";
import { hashPassword } from "../security/password.js";
import { createDatabasePool, verifySecuritySchema } from "./pool.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for bootstrap`);
  return value;
}

async function bootstrap(): Promise<void> {
  const configuration = loadConfiguration();
  const email = required("BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase();
  const adminName = required("BOOTSTRAP_ADMIN_NAME").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || adminName.length > 150) {
    throw new Error("Bootstrap admin email or display name is invalid");
  }
  const password = readFileSync(required("BOOTSTRAP_PASSWORD_FILE"), "utf8").replace(/\r?\n$/, "");
  const passwordHash = await hashPassword(password);
  const pool = createDatabasePool();
  try {
    await verifySecuritySchema(pool);
    const connection = await pool.getConnection();
    let locked = false;
    try {
      const [lockRows] = await connection.query<RowDataPacket[]>(
        "SELECT GET_LOCK('skdora_bootstrap', 30) AS acquired",
      );
      if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire bootstrap lock");
      locked = true;
      await connection.beginTransaction();
      const [existing] = await connection.query<RowDataPacket[]>("SELECT id FROM hospitals LIMIT 1");
      if (existing.length > 0) throw new Error("A hospital already exists; bootstrap is single-use");

      const [organization] = await connection.execute<ResultSetHeader>(
        "INSERT INTO organizations (name) VALUES (?)", [configuration.hospital.displayName],
      );
      const [hospital] = await connection.execute<ResultSetHeader>(
        "INSERT INTO hospitals (organization_id, display_name, timezone) VALUES (?, ?, ?)",
        [organization.insertId, configuration.hospital.displayName,
          configuration.features.operations.hospitalTimezone],
      );
      const [user] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (hospital_id, email, display_name, password_hash)
         VALUES (?, ?, ?, ?)`,
        [hospital.insertId, email, adminName, passwordHash],
      );
      const [role] = await connection.execute<ResultSetHeader>(
        "INSERT INTO roles (hospital_id, code, label) VALUES (?, 'admin', 'Administrator')",
        [hospital.insertId],
      );
      await connection.execute(
        "INSERT INTO user_roles (hospital_id, user_id, role_id) VALUES (?, ?, ?)",
        [hospital.insertId, user.insertId, role.insertId],
      );
      await connection.execute(
        `INSERT INTO role_permissions (hospital_id, role_id, permission_code)
         SELECT ?, ?, code FROM permissions`,
        [hospital.insertId, role.insertId],
      );
      await connection.execute(
        `INSERT INTO audit_events
           (hospital_id, actor_user_id, action_code, entity_type, entity_id)
         VALUES (?, ?, 'security.bootstrap', 'hospital', ?)`,
        [hospital.insertId, user.insertId, hospital.insertId],
      );
      await connection.commit();
      console.info("Initial hospital and administrator created");
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (locked) await connection.query("SELECT RELEASE_LOCK('skdora_bootstrap')");
      connection.release();
    }
  } finally {
    await pool.end();
  }
}

bootstrap().catch((error: unknown) => {
  console.error("Bootstrap failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
