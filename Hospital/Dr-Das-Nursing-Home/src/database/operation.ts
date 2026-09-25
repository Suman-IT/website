import { createHash } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { HttpError, textField } from "../http/input.js";
import type { Principal } from "../security/security.service.js";

export const hash = (value: string): Buffer => createHash("sha256").update(value).digest();

// A conservative per-hospital allocation lock suits a single-clinic deployment.
// All booking mutations and patient writes use this same transaction boundary.
export async function hospitalTransaction<T>(pool: Pool, principal: Principal,
  permission: string, work: (connection: PoolConnection, hospital: RowDataPacket) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const connection = await pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'");
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      const [hospitals] = await connection.execute<RowDataPacket[]>(
        "SELECT id, timezone, booking_cutoff_minutes FROM hospitals WHERE id = ? AND is_active = TRUE FOR UPDATE",
        [principal.hospitalId]);
      if (!hospitals[0]) throw new HttpError(404, "Hospital not found");
      await requireGrant(connection, principal, permission);
      const result = await work(connection, hospitals[0]);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      const code = (error as { code?: string }).code;
      if (attempt < 2 && (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT")) continue;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new HttpError(503, "Booking is busy; retry with the same idempotency key");
      }
      throw error;
    } finally { connection.release(); }
  }
}

export async function requireGrant(connection: PoolConnection, principal: Principal, permission: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.hospital_id=u.hospital_id AND ur.user_id=u.id
     JOIN role_permissions rp ON rp.hospital_id=ur.hospital_id AND rp.role_id=ur.role_id
     WHERE u.hospital_id=? AND u.id=? AND u.is_active=TRUE AND rp.permission_code=? LIMIT 1`,
    [principal.hospitalId, principal.userId, permission]);
  if (!rows[0]) throw new HttpError(403, "Forbidden");
}

export async function idempotent(connection: PoolConnection, principal: Principal,
  operation: string, key: string, payload: unknown, work: () => Promise<string>): Promise<string> {
  const normalized = textField(key, "Idempotency-Key", 128);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) throw new HttpError(400, "Invalid Idempotency-Key");
  const keyHash = hash(normalized);
  const requestHash = hash(JSON.stringify(payload));
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT request_hash,result_id FROM operation_requests WHERE hospital_id=? AND actor_user_id=? AND operation=? AND key_hash=? FOR UPDATE",
    [principal.hospitalId, principal.userId, operation, keyHash]);
  if (rows[0]) {
    if (!requestHash.equals(rows[0].request_hash as Buffer)) throw new HttpError(409, "Idempotency key was used for a different request");
    return String(rows[0].result_id);
  }
  const id = await work();
  await connection.execute(
    "INSERT INTO operation_requests (hospital_id,actor_user_id,operation,key_hash,request_hash,result_id) VALUES (?,?,?,?,?,?)",
    [principal.hospitalId, principal.userId, operation, keyHash, requestHash, id]);
  return id;
}
