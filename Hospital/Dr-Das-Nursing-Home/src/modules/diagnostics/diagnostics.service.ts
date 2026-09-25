import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { HttpError, isDuplicateKey } from "../../http/input.js";
import type { Principal } from "../../security/security.service.js";
import { recordAudit } from "../../security/security.service.js";

export interface DiagnosticInput {
  name: string;
  slug: string;
  category: string;
  description: string | null;
  price: number | null;
  priceNote: string | null;
  isPublished: boolean;
}

function view(row: RowDataPacket) {
  return {
    id: String(row.id), name: String(row.name), slug: String(row.slug),
    category: String(row.category), description: row.description === null ? null : String(row.description),
    price: row.price === null ? null : Number(row.price),
    priceNote: row.price_note === null ? null : String(row.price_note),
    isPublished: Boolean(row.is_published),
  };
}

const fields = "id, name, slug, category, description, price, price_note, is_published";

export class DiagnosticsService {
  constructor(private readonly pool: Pool) {}

  async listPublic(hospitalId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${fields} FROM diagnostic_services
       WHERE hospital_id = ? AND is_published = TRUE
       ORDER BY category, name`, [hospitalId]);
    return rows.map(view);
  }

  async list(hospitalId: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${fields} FROM diagnostic_services WHERE hospital_id = ? ORDER BY category, name`, [hospitalId]);
    return rows.map(view);
  }

  async create(principal: Principal, input: DiagnosticInput) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO diagnostic_services
          (hospital_id, name, slug, category, description, price, price_note, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [principal.hospitalId, input.name, input.slug, input.category, input.description,
          input.price, input.priceNote, input.isPublished]);
      const id = String(result.insertId);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "diagnostic.create", entityType: "diagnostic_service", entityId: id });
      await connection.commit();
      return { id, ...input };
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKey(error)) throw new HttpError(409, "Diagnostic service slug already exists");
      throw error;
    } finally { connection.release(); }
  }

  async update(principal: Principal, id: string, patch: Partial<DiagnosticInput>) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${fields} FROM diagnostic_services WHERE hospital_id = ? AND id = ? FOR UPDATE`,
        [principal.hospitalId, id]);
      if (!rows[0]) throw new HttpError(404, "Diagnostic service not found");
      const values: Array<string | number | boolean | null> = [];
      const updates: string[] = [];
      const map: Array<[keyof DiagnosticInput, string]> = [
        ["name", "name"], ["slug", "slug"], ["category", "category"],
        ["description", "description"], ["price", "price"], ["priceNote", "price_note"],
        ["isPublished", "is_published"],
      ];
      for (const [key, column] of map) {
        if (patch[key] !== undefined) { updates.push(`${column} = ?`); values.push(patch[key] as never); }
      }
      if (!updates.length) throw new HttpError(400, "No changes supplied");
      await connection.execute(
        `UPDATE diagnostic_services SET ${updates.join(", ")} WHERE hospital_id = ? AND id = ?`,
        [...values, principal.hospitalId, id]);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "diagnostic.update", entityType: "diagnostic_service", entityId: id });
      const [updated] = await connection.execute<RowDataPacket[]>(
        `SELECT ${fields} FROM diagnostic_services WHERE hospital_id = ? AND id = ?`,
        [principal.hospitalId, id]);
      await connection.commit();
      return view(updated[0]!);
    } catch (error) {
      await connection.rollback();
      if (isDuplicateKey(error)) throw new HttpError(409, "Diagnostic service slug already exists");
      throw error;
    } finally { connection.release(); }
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "DELETE FROM diagnostic_services WHERE hospital_id = ? AND id = ?", [principal.hospitalId, id]);
      if (result.affectedRows !== 1) throw new HttpError(404, "Diagnostic service not found");
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "diagnostic.delete", entityType: "diagnostic_service", entityId: id });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
}
