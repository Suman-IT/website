import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { hospitalTransaction, idempotent } from "../../database/operation.js";
import { bodyObject, HttpError, idField, textField } from "../../http/input.js";
import { recordAudit, type Principal } from "../../security/security.service.js";

export interface PatientInput { fullName: string; mobile: string | null }
export function normalizeMobile(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "Invalid mobile");
  const normalized = value.replace(/[ ()-]/g, "");
  // Do not guess country codes or merge people by a shared contact number.
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new HttpError(400, "Mobile must include its country code, e.g. +91");
  return normalized;
}
export function patientInput(raw: unknown): PatientInput {
  const body = bodyObject(raw, ["fullName", "mobile"], ["fullName"]);
  return { fullName: textField(body.fullName, "fullName"), mobile: normalizeMobile(body.mobile) };
}
export async function insertPatient(connection: PoolConnection, principal: Principal, input: PatientInput): Promise<string> {
  const [result] = await connection.execute<ResultSetHeader>(
    "INSERT INTO patients (hospital_id,full_name,mobile_normalized) VALUES (?,?,?)",
    [principal.hospitalId, input.fullName, input.mobile]);
  const id = String(result.insertId);
  await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
    actionCode: "patient.create", entityType: "patient", entityId: id });
  return id;
}
export async function patientRow(connection: PoolConnection, hospitalId: string, id: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT id,full_name,mobile_normalized FROM patients WHERE hospital_id=? AND id=? FOR UPDATE", [hospitalId, id]);
  if (!rows[0]) throw new HttpError(404, "Patient not found");
  return { id: String(rows[0].id), fullName: String(rows[0].full_name), mobile: rows[0].mobile_normalized as string | null };
}

export class PatientService {
  constructor(private readonly pool: Pool, private readonly enabled: boolean) {}
  private checkEnabled() { if (!this.enabled) throw new HttpError(404, "Patients are disabled"); }
  async create(principal: Principal, raw: unknown, key: string) {
    this.checkEnabled();
    const input = patientInput(raw);
    return hospitalTransaction(this.pool, principal, "patient.create", async (connection) => {
      const id = await idempotent(connection, principal, "patient.create", key, input,
        () => insertPatient(connection, principal, input));
      return patientRow(connection, principal.hospitalId, id);
    });
  }
  async update(principal: Principal, id: string, raw: unknown) {
    this.checkEnabled(); idField(id);
    const input = patientInput(raw);
    return hospitalTransaction(this.pool, principal, "patient.update", async (connection) => {
      await patientRow(connection, principal.hospitalId, id);
      await connection.execute("UPDATE patients SET full_name=?,mobile_normalized=? WHERE hospital_id=? AND id=?",
        [input.fullName, input.mobile, principal.hospitalId, id]);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "patient.update", entityType: "patient", entityId: id });
      return patientRow(connection, principal.hospitalId, id);
    });
  }
  async get(principal: Principal, id: string) {
    this.checkEnabled(); idField(id);
    return hospitalTransaction(this.pool, principal, "patient.read", async (connection) => {
      const patient = await patientRow(connection, principal.hospitalId, id);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "patient.read", entityType: "patient", entityId: id });
      return patient;
    });
  }
  async search(principal: Principal, raw: unknown) {
    this.checkEnabled();
    const body = bodyObject(raw, ["mobile", "name" ]);
    if ((body.mobile !== undefined) === (body.name !== undefined)) throw new HttpError(400, "Provide mobile or name");
    const mobile = body.mobile === undefined ? null : normalizeMobile(body.mobile);
    const name = body.name === undefined ? null : textField(body.name, "name");
    if (!mobile && (!name || name.length < 2)) throw new HttpError(400, "Search is too short");
    return hospitalTransaction(this.pool, principal, "patient.read", async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id,full_name,mobile_normalized FROM patients WHERE hospital_id=? AND ${mobile ? "mobile_normalized=?" : "LEFT(full_name,CHAR_LENGTH(?))=?"} ORDER BY id LIMIT 50`,
        mobile ? [principal.hospitalId, mobile] : [principal.hospitalId, name, name]);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "patient.search", entityType: "patient", entityId: null });
      return rows.map(row => ({ id: String(row.id), fullName: String(row.full_name), mobile: row.mobile_normalized as string | null }));
    });
  }
}
