import type { Pool, RowDataPacket } from "mysql2/promise";
import { HttpError } from "../../http/input.js";
import type { Principal } from "../../security/security.service.js";
import { recordAudit } from "../../security/security.service.js";

export interface HospitalIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly timezone: string;
}

function identity(row: RowDataPacket): HospitalIdentity {
  return { id: String(row.id), displayName: String(row.display_name), timezone: String(row.timezone) };
}

export class HospitalService {
  constructor(private readonly pool: Pool) {}

  async getActiveHospital(): Promise<HospitalIdentity> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT id, display_name, timezone FROM hospitals WHERE is_active = TRUE LIMIT 2",
    );
    if (rows.length !== 1) throw new HttpError(503, "Hospital is not configured");
    return identity(rows[0]!);
  }

  async getForStaff(hospitalId: string): Promise<HospitalIdentity> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT id, display_name, timezone FROM hospitals WHERE id = ? AND is_active = TRUE LIMIT 1",
      [hospitalId],
    );
    if (!rows[0]) throw new HttpError(404, "Hospital not found");
    return identity(rows[0]);
  }

  async updateDisplayName(principal: Principal, displayName: string): Promise<HospitalIdentity> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id, timezone FROM hospitals WHERE id = ? AND is_active = TRUE FOR UPDATE",
        [principal.hospitalId],
      );
      if (!rows[0]) throw new HttpError(404, "Hospital not found");
      await connection.execute(
        "UPDATE hospitals SET display_name = ? WHERE id = ?",
        [displayName, principal.hospitalId],
      );
      await recordAudit(connection, {
        hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "hospital.update", entityType: "hospital", entityId: principal.hospitalId,
      });
      await connection.commit();
      return { id: principal.hospitalId, displayName, timezone: String(rows[0].timezone) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
