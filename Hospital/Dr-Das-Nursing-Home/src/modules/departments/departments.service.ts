import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { HttpError, isDuplicateKey } from "../../http/input.js";
import type { Principal } from "../../security/security.service.js";
import { recordAudit } from "../../security/security.service.js";

export interface DepartmentInput {
  name: string;
  slug: string;
  isPublished: boolean;
}

function view(row: RowDataPacket) {
  return { id: String(row.id), name: String(row.name), slug: String(row.slug),
    isPublished: Boolean(row.is_published) };
}

export class DepartmentService {
  constructor(private readonly pool: Pool) {}

  async listPublic(hospitalId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT name, slug FROM departments
       WHERE hospital_id = ? AND is_published = TRUE ORDER BY name, slug`,
      [hospitalId],
    );
    return rows.map((row) => ({ name: String(row.name), slug: String(row.slug) }));
  }

  async list(hospitalId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name, slug, is_published FROM departments
       WHERE hospital_id = ?
       ORDER BY name, id`,
      [hospitalId],
    );
    return rows.map(view);
  }

  async create(principal: Principal, input: DepartmentInput) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO departments (hospital_id, name, slug, is_published)
         VALUES (?, ?, ?, ?)`,
        [principal.hospitalId, input.name, input.slug, input.isPublished],
      );
      const id = String(result.insertId);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "department.create", entityType: "department", entityId: id });
      await connection.commit();
      return { id, ...input };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKey(error)) throw new HttpError(409, "Department slug already exists");
      throw error;
    } finally { connection.release(); }
  }

  async update(principal: Principal, id: string, patch: Partial<DepartmentInput>) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM departments WHERE hospital_id = ? AND id = ? FOR UPDATE",
        [principal.hospitalId, id],
      );
      if (!rows[0]) throw new HttpError(404, "Department not found");
      const fields: string[] = [];
      const values: Array<string | boolean> = [];
      if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
      if (patch.slug !== undefined) { fields.push("slug = ?"); values.push(patch.slug); }
      if (patch.isPublished !== undefined) { fields.push("is_published = ?"); values.push(patch.isPublished); }
      if (!fields.length) throw new HttpError(400, "No changes supplied");
      await connection.execute(
        `UPDATE departments SET ${fields.join(", ")} WHERE hospital_id = ? AND id = ?`,
        [...values, principal.hospitalId, id],
      );
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "department.update", entityType: "department", entityId: id });
      const [updated] = await connection.execute<RowDataPacket[]>(
        "SELECT id, name, slug, is_published FROM departments WHERE hospital_id = ? AND id = ?",
        [principal.hospitalId, id],
      );
      await connection.commit();
      return view(updated[0]!);
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKey(error)) throw new HttpError(409, "Department slug already exists");
      throw error;
    } finally { connection.release(); }
  }
}
