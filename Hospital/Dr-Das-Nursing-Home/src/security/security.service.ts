import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { verifyPassword } from "./password.js";

export interface Principal {
  readonly userId: string | null;
  readonly hospitalId: string;
  readonly displayName: string;
}

type AuditWriter = Pool | PoolConnection;

export async function recordAudit(writer: AuditWriter, event: {
  hospitalId: string;
  actorUserId: string | null;
  actionCode: string;
  entityType: string;
  entityId: string | null;
}): Promise<void> {
  await writer.execute(
    `INSERT INTO audit_events
       (hospital_id, actor_user_id, action_code, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?)`,
    [event.hospitalId, event.actorUserId, event.actionCode, event.entityType, event.entityId],
  );
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class SecurityService {
  constructor(private readonly pool: Pool) {}

  async allowLoginAttempt(remoteAddress: string, email: string): Promise<boolean> {
    const windowStart = new Date(Math.floor(Date.now() / 900_000) * 900_000);
    const subjects = [
      { hash: digest(`ip:${remoteAddress}`), limit: 20 },
      { hash: digest(`email:${email}`), limit: 5 },
    ];
    let allowed = true;
    for (const subject of subjects) {
      await this.pool.execute(
        `INSERT INTO login_attempts (subject_hash, window_started_at_utc, attempts)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE attempts = LEAST(attempts + 1, 21)`,
        [subject.hash, windowStart],
      );
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT attempts FROM login_attempts
         WHERE subject_hash = ? AND window_started_at_utc = ?`,
        [subject.hash, windowStart],
      );
      if (Number(rows[0]?.attempts) > subject.limit) allowed = false;
    }
    return allowed;
  }

  async login(email: string, password: string): Promise<string | null> {
    const [users] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.hospital_id, u.password_hash
       FROM users u JOIN hospitals h ON h.id = u.hospital_id
       WHERE u.email = ? AND u.is_active = TRUE AND h.is_active = TRUE
       LIMIT 2`,
      [email],
    );
    const user = users.length === 1 ? users[0] : undefined;
    if (!await verifyPassword(password, user ? String(user.password_hash) : undefined)) return null;
    if (!user) return null;

    const token = randomBytes(32).toString("base64url");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO staff_sessions
           (token_hash, hospital_id, user_id, expires_at_utc)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 8 HOUR))`,
        [digest(token), String(user.hospital_id), String(user.id)],
      );
      await recordAudit(connection, {
        hospitalId: String(user.hospital_id), actorUserId: String(user.id),
        actionCode: "auth.login", entityType: "user", entityId: String(user.id),
      });
      await connection.commit();
      return token;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async principalForToken(token: string): Promise<Principal | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT u.id AS user_id, u.hospital_id, u.display_name
       FROM staff_sessions s
       JOIN users u ON u.id = s.user_id AND u.hospital_id = s.hospital_id
       JOIN hospitals h ON h.id = u.hospital_id
       WHERE s.token_hash = ? AND s.revoked_at_utc IS NULL
         AND s.expires_at_utc > UTC_TIMESTAMP(6)
         AND u.is_active = TRUE AND h.is_active = TRUE
       LIMIT 1`,
      [digest(token)],
    );
    const row = rows[0];
    return row ? {
      userId: String(row.user_id),
      hospitalId: String(row.hospital_id),
      displayName: String(row.display_name),
    } : null;
  }

  async logout(token: string, principal: Principal): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE staff_sessions SET revoked_at_utc = UTC_TIMESTAMP(6)
         WHERE token_hash = ? AND hospital_id = ? AND user_id = ? AND revoked_at_utc IS NULL`,
        [digest(token), principal.hospitalId, principal.userId],
      );
      await recordAudit(connection, {
        hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "auth.logout", entityType: "user", entityId: principal.userId,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async hasPermission(principal: Principal, permission: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM user_roles ur
       JOIN role_permissions rp ON rp.hospital_id = ur.hospital_id AND rp.role_id = ur.role_id
       WHERE ur.hospital_id = ? AND ur.user_id = ? AND rp.permission_code = ? LIMIT 1`,
      [principal.hospitalId, principal.userId, permission],
    );
    return rows.length > 0;
  }

  async canReadAppointment(principal: Principal, appointmentId: string): Promise<boolean> {
    if (!/^\d+$/.test(appointmentId)) return false;
    if (await this.hasPermission(principal, "appointment.read")) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        "SELECT 1 FROM appointments WHERE hospital_id = ? AND id = ? LIMIT 1",
        [principal.hospitalId, appointmentId],
      );
      return rows.length > 0;
    }
    if (!await this.hasPermission(principal, "appointment.read.own")) return false;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM appointments a
       JOIN doctor_user_links d ON d.hospital_id = a.hospital_id AND d.doctor_id = a.doctor_id
       WHERE a.hospital_id = ? AND a.id = ? AND d.user_id = ? LIMIT 1`,
      [principal.hospitalId, appointmentId, principal.userId],
    );
    return rows.length > 0;
  }

  async findAuditEvent(principal: Principal, eventId: string): Promise<{
    actionCode: string; entityType: string; occurredAtUtc: Date;
  } | null> {
    if (!/^\d+$/.test(eventId)) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT action_code, entity_type, occurred_at_utc
       FROM audit_events WHERE hospital_id = ? AND id = ? LIMIT 1`,
      [principal.hospitalId, eventId],
    );
    const row = rows[0];
    return row ? {
      actionCode: String(row.action_code),
      entityType: String(row.entity_type),
      occurredAtUtc: row.occurred_at_utc as Date,
    } : null;
  }
}
