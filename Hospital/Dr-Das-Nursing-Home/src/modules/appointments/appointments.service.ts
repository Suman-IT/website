import { randomBytes } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { hash, hospitalTransaction, idempotent, requireGrant } from "../../database/operation.js";
import { bodyObject, HttpError, idField, intField, textField } from "../../http/input.js";
import { recordAudit, SecurityService, type Principal } from "../../security/security.service.js";
import { HospitalService } from "../hospital/hospital.service.js";
import { insertPatient, patientRow } from "../patients/patients.service.js";
import { ScheduleService } from "../schedules/schedules.service.js";
import { assertTransition, bookingInput, localInstant, type BookingInput } from "./policy.js";

export class AppointmentService {
  private readonly schedules: ScheduleService;
  constructor(private readonly pool: Pool, private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date()) { this.schedules = new ScheduleService(pool); }
  private checkEnabled() { if (!this.enabled) throw new HttpError(404, "Appointments are disabled"); }

  private async audit(connection: PoolConnection, principal: Principal, id: string, action: string) {
    await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
      actionCode: action, entityType: "appointment", entityId: id });
  }
  private async event(connection: PoolConnection, principal: Principal, id: string, type: string) {
    await connection.execute("INSERT INTO appointment_events (hospital_id,appointment_id,event_type) VALUES (?,?,?)",
      [principal.hospitalId, id, type]);
  }
  private async lockedAppointment(connection: PoolConnection, principal: Principal, id: string) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM appointments WHERE hospital_id=? AND id=? FOR UPDATE", [principal.hospitalId, id]);
    if (!rows[0]) throw new HttpError(404, "Appointment not found");
    return rows[0];
  }

  private async allocate(connection: PoolConnection, principal: Principal, hospital: RowDataPacket,
    input: BookingInput, rescheduledFrom: string | null = null): Promise<string> {
    const hospitalId = principal.hospitalId;
    if (input.source === "ONLINE" && (input.overrideReason || input.repeatReason)) throw new HttpError(403, "Online overrides are not allowed");
    if (input.overrideReason) await requireGrant(connection, principal, "appointment.overbook");
    if (input.repeatReason) await requireGrant(connection, principal, "appointment.repeat");
    const effective = await this.schedules.resolveForBooking(connection, hospitalId, input.doctorId,
      input.scheduleId, input.date, input.source === "ONLINE");
    const start = localInstant(input.date, effective.startLocal, String(hospital.timezone));
    const end = localInstant(input.date, effective.endLocal, String(hospital.timezone));
    const now = this.now();
    const cutoff = Number(hospital.booking_cutoff_minutes) * 60000;
    if (now.getTime() >= end.getTime() - cutoff) throw new HttpError(409, "Booking cutoff has passed");
    if (effective.bookingMode === "EXCLUSIVE" && input.overrideReason) throw new HttpError(409, "Exclusive sittings cannot be overbooked");
    if (effective.bookingMode === "SERIAL" && input.slotLocal) throw new HttpError(400, "Serial sittings do not accept a slot");
    const slot = effective.bookingMode === "EXCLUSIVE"
      ? (input.slotLocal ? localInstant(input.date, input.slotLocal, String(hospital.timezone)) : null) : null;
    if (effective.bookingMode === "EXCLUSIVE" && (!slot || slot < start ||
      slot.getTime() + effective.slotMinutes * 60000 > end.getTime() ||
      (slot.getTime() - start.getTime()) % (effective.slotMinutes * 60000) !== 0)) {
      throw new HttpError(400, "Choose a valid slot in this sitting");
    }
    if (slot && now.getTime() >= slot.getTime() - cutoff) throw new HttpError(409, "Slot booking cutoff has passed");
    // Doctor lock already held: it also coordinates first-session creation with schedule edits.
    let [sessions] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM appointment_sessions WHERE hospital_id=? AND schedule_id=? AND service_date=? FOR UPDATE",
      [hospitalId, input.scheduleId, input.date]);
    if (!sessions[0]) {
      await connection.execute(
        `INSERT INTO appointment_sessions (hospital_id,schedule_id,doctor_id,service_date,starts_at_utc,ends_at_utc,booking_mode,capacity,slot_minutes)
         VALUES (?,?,?,?,?,?,?,?,?)`, [hospitalId, input.scheduleId, input.doctorId, input.date, start, end,
          effective.bookingMode, effective.capacity, effective.slotMinutes]);
      [sessions] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM appointment_sessions WHERE hospital_id=? AND schedule_id=? AND service_date=? FOR UPDATE",
        [hospitalId, input.scheduleId, input.date]);
    }
    const session = sessions[0]!;
    const overbooked = Number(session.reserved_count) >= Number(session.capacity);
    if (overbooked && !input.overrideReason) throw new HttpError(409, "Sitting is full");
    if (Number(session.reserved_count) >= 65535 || Number(session.next_serial) >= 4294967295) throw new HttpError(409, "Sitting allocation limit reached");
    let patientId = input.patientId;
    if (input.patient) {
      if (principal.userId !== null) await requireGrant(connection, principal, "patient.create");
      patientId = await insertPatient(connection, principal, input.patient);
    } else {
      await requireGrant(connection, principal, "patient.read");
      if (!patientId) throw new HttpError(400, "Patient is required");
      await patientRow(connection, hospitalId, patientId);
    }
    const [duplicates] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id FROM appointments a JOIN appointment_sessions s ON s.hospital_id=a.hospital_id AND s.id=a.session_id
       WHERE a.hospital_id=? AND a.patient_id=? AND a.doctor_id=? AND s.service_date=? AND a.status<>'CANCELLED' LIMIT 1 FOR UPDATE`,
      [hospitalId, patientId, input.doctorId, input.date]);
    if (duplicates[0] && !input.repeatReason) throw new HttpError(409, "Patient already has an appointment with this doctor on this date");
    if (slot) {
      const [occupied] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM appointments WHERE hospital_id=? AND session_id=? AND occupied_slot_at_utc=? LIMIT 1 FOR UPDATE",
        [hospitalId, String(session.id), slot]);
      if (occupied[0]) throw new HttpError(409, "Slot is occupied");
    }
    const serial = Number(session.next_serial);
    const estimate = slot ?? new Date(Math.max(now.getTime(), start.getTime() + (serial - 1) * effective.slotMinutes * 60000));
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO appointments (hospital_id,session_id,doctor_id,patient_id,public_reference,booking_source,
       serial_number,slot_start_at_utc,estimated_start_at_utc,created_by_user_id,is_overbooked,override_reason,repeat_reason,rescheduled_from_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [hospitalId, String(session.id), input.doctorId, patientId, randomBytes(13).toString("hex"), input.source,
        serial, slot, estimate, principal.userId, overbooked, input.overrideReason, input.repeatReason, rescheduledFrom]);
    await connection.execute(
      "UPDATE appointment_sessions SET reserved_count=reserved_count+1,overbook_count=overbook_count+?,next_serial=next_serial+1 WHERE hospital_id=? AND id=?",
      [overbooked ? 1 : 0, hospitalId, String(session.id)]);
    const id = String(result.insertId);
    await this.audit(connection, principal, id, "appointment.create");
    if (overbooked) await this.audit(connection, principal, id, "appointment.overbook");
    if (duplicates[0]) await this.audit(connection, principal, id, "appointment.repeat");
    await this.event(connection, principal, id, "AppointmentCreated");
    return id;
  }

  async create(principal: Principal, raw: unknown, key: string) {
    this.checkEnabled(); const input = bookingInput(raw);
    const id = await hospitalTransaction(this.pool, principal, "appointment.create", (connection, hospital) =>
      idempotent(connection, principal, "appointment.create", key, input,
        () => this.allocate(connection, principal, hospital, input)));
    return this.confirmation(principal.hospitalId, id);
  }

  async createReception(principal: Principal, raw: unknown, source: "PHONE" | "WALK_IN", key: string) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Expected an object");
    return this.create(principal, { ...(raw as Record<string, unknown>), source }, key);
  }

  async listQueue(principal: Principal, filters: {
    date: string; doctorId: string | null; status: string | null; search: string | null;
  }) {
    this.checkEnabled();
    return hospitalTransaction(this.pool, principal, "appointment.read", async connection => {
      const values: Array<string | number> = [principal.hospitalId, filters.date];
      const conditions = ["a.hospital_id=?", "s.service_date=?"];
      if (filters.doctorId) { conditions.push("a.doctor_id=?"); values.push(filters.doctorId); }
      if (filters.status) { conditions.push("a.status=?"); values.push(filters.status); }
      if (filters.search) {
        conditions.push("(a.id=? OR p.full_name LIKE ? OR p.mobile_normalized=?)");
        values.push(filters.search, `%${filters.search}%`, filters.search);
      }
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT a.id,a.public_reference,a.doctor_id,d.display_name AS doctor_name,a.patient_id,
         p.full_name AS patient_name,p.mobile_normalized,a.status,a.booking_source,a.serial_number,
         a.estimated_start_at_utc,a.slot_start_at_utc,DATE_FORMAT(s.service_date,'%Y-%m-%d') AS service_date
         FROM appointments a JOIN appointment_sessions s ON s.hospital_id=a.hospital_id AND s.id=a.session_id
         JOIN doctors d ON d.hospital_id=a.hospital_id AND d.id=a.doctor_id
         JOIN patients p ON p.hospital_id=a.hospital_id AND p.id=a.patient_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY COALESCE(a.slot_start_at_utc,a.estimated_start_at_utc),a.serial_number,a.id`, values);
      return rows.map(row => ({
        id: String(row.id), reference: String(row.public_reference), date: String(row.service_date),
        doctorId: String(row.doctor_id), doctorName: String(row.doctor_name), patientId: String(row.patient_id),
        patientName: String(row.patient_name), mobile: row.mobile_normalized as string | null,
        status: String(row.status), source: String(row.booking_source), serialNumber: Number(row.serial_number),
        estimatedStartAt: row.estimated_start_at_utc as Date | null, slotStartAt: row.slot_start_at_utc as Date | null,
        timeIsEstimate: row.slot_start_at_utc === null,
      }));
    });
  }

  async createPublic(hospitalId: string, raw: unknown, key: string) {
    this.checkEnabled();
    const input = bookingInput(raw);
    if (input.source !== "ONLINE" || !input.patient || input.patientId || input.overrideReason || input.repeatReason) {
      throw new HttpError(400, "Public bookings require new patient details and an online source");
    }
    const normalizedKey = textField(key, "Idempotency-Key", 128);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalizedKey)) throw new HttpError(400, "Invalid Idempotency-Key");
    const requestHash = hash(JSON.stringify(input));
    const connection = await this.pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'");
      await connection.beginTransaction();
      const [hospitals] = await connection.execute<RowDataPacket[]>(
        "SELECT id, timezone, booking_cutoff_minutes FROM hospitals WHERE id=? AND is_active=TRUE FOR UPDATE", [hospitalId]);
      if (!hospitals[0]) throw new HttpError(404, "Hospital not found");
      const keyHash = hash(normalizedKey);
      const [requests] = await connection.execute<RowDataPacket[]>(
        "SELECT request_hash,appointment_id FROM public_booking_requests WHERE hospital_id=? AND idempotency_key_hash=? FOR UPDATE",
        [hospitalId, keyHash]);
      if (requests[0]) {
        if (!requestHash.equals(requests[0].request_hash as Buffer)) throw new HttpError(409, "Idempotency key was used for a different request");
        await connection.commit();
        return this.confirmation(hospitalId, String(requests[0].appointment_id));
      }
      const id = await this.allocate(connection, { userId: null, hospitalId, displayName: "Public website" }, hospitals[0], input);
      await connection.execute(
        "INSERT INTO public_booking_requests (hospital_id,idempotency_key_hash,request_hash,appointment_id) VALUES (?,?,?,?)",
        [hospitalId, keyHash, requestHash, id]);
      await connection.commit();
      return this.confirmation(hospitalId, id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }

  private async cancelLocked(connection: PoolConnection, principal: Principal, appointment: RowDataPacket, reason: string) {
    const id = String(appointment.id);
    assertTransition(String(appointment.status), "CANCELLED");
    await connection.execute(
      "UPDATE appointments SET status='CANCELLED',cancelled_by_user_id=?,cancelled_at_utc=UTC_TIMESTAMP(6),cancellation_reason=? WHERE hospital_id=? AND id=?",
      [principal.userId, reason, principal.hospitalId, id]);
    const [result] = await connection.execute<ResultSetHeader>(
      "UPDATE appointment_sessions SET reserved_count=reserved_count-1,overbook_count=overbook_count-? WHERE hospital_id=? AND id=? AND reserved_count>0",
      [appointment.is_overbooked ? 1 : 0, principal.hospitalId, String(appointment.session_id)]);
    if (result.affectedRows !== 1) throw new Error("Capacity integrity failure");
    await this.audit(connection, principal, id, "appointment.cancel");
    await this.event(connection, principal, id, "AppointmentCancelled");
  }

  async cancel(principal: Principal, id: string, raw: unknown, key: string) {
    this.checkEnabled(); idField(id);
    const body = bodyObject(raw, ["reason"], ["reason"]);
    const reason = textField(body.reason, "reason", 250);
    await hospitalTransaction(this.pool, principal, "appointment.cancel", connection =>
      idempotent(connection, principal, "appointment.cancel", key, { id, reason }, async () => {
        const appointment = await this.lockedAppointment(connection, principal, id);
        await this.cancelLocked(connection, principal, appointment, reason);
        return id;
      }));
    return this.confirmation(principal.hospitalId, id);
  }

  async reschedule(principal: Principal, id: string, raw: unknown, key: string) {
    this.checkEnabled(); idField(id);
    const body = bodyObject(raw, ["booking", "reason"], ["booking", "reason"]);
    const input = bookingInput(body.booking, true);
    const reason = textField(body.reason, "reason", 250);
    const newId = await hospitalTransaction(this.pool, principal, "appointment.update", async (connection, hospital) => {
      await requireGrant(connection, principal, "appointment.create");
      await requireGrant(connection, principal, "appointment.cancel");
      return idempotent(connection, principal, "appointment.reschedule", key, { id, input, reason }, async () => {
        const old = await this.lockedAppointment(connection, principal, id);
        if (!["BOOKED", "CONFIRMED"].includes(String(old.status))) throw new HttpError(409, "Only booked or confirmed appointments can be rescheduled");
        // Release and allocate are invisible until commit; any failure rolls both back.
        await this.cancelLocked(connection, principal, old, reason);
        const newId = await this.allocate(connection, principal, hospital,
          { ...input, patientId: String(old.patient_id) }, id);
        await this.audit(connection, principal, newId, "appointment.reschedule");
        await this.event(connection, principal, newId, "AppointmentRescheduled");
        return newId;
      });
    });
    return this.confirmation(principal.hospitalId, newId);
  }

  async transition(principal: Principal, id: string, raw: unknown, key: string) {
    this.checkEnabled(); idField(id);
    const body = bodyObject(raw, ["status"], ["status"]);
    const status = textField(body.status, "status", 32);
    if (status === "CANCELLED") throw new HttpError(400, "Use cancellation with a reason");
    const permission = status === "CHECKED_IN" ? "appointment.check_in"
      : status === "WAITING" ? "appointment.queue" : "appointment.status";
    await hospitalTransaction(this.pool, principal, "appointment.update", connection =>
      idempotent(connection, principal, "appointment.transition", key, { id, status }, async () => {
        await requireGrant(connection, principal, permission);
        const appointment = await this.lockedAppointment(connection, principal, id);
        assertTransition(String(appointment.status), status);
        const [sessions] = await connection.execute<RowDataPacket[]>(
          "SELECT starts_at_utc,ends_at_utc FROM appointment_sessions WHERE hospital_id=? AND id=? FOR UPDATE",
          [principal.hospitalId, String(appointment.session_id)]);
        const session = sessions[0]!;
        if (status === "NO_SHOW" && this.now() < new Date(session.ends_at_utc)) throw new HttpError(409, "No-show is allowed after the sitting ends");
        if (["IN_CONSULTATION", "COMPLETED"].includes(status) &&
          this.now() < new Date(session.starts_at_utc)) throw new HttpError(409, "Sitting has not started");
        await connection.execute("UPDATE appointments SET status=? WHERE hospital_id=? AND id=?", [status, principal.hospitalId, id]);
        await this.audit(connection, principal, id, `appointment.status.${status.toLowerCase()}`);
        await this.event(connection, principal, id, "AppointmentStatusChanged");
        return id;
      }));
    return this.confirmation(principal.hospitalId, id);
  }

  async get(principal: Principal, id: string) {
    this.checkEnabled(); idField(id);
    if (!await new SecurityService(this.pool).canReadAppointment(principal, id)) throw new HttpError(404, "Appointment not found");
    return this.confirmation(principal.hospitalId, id);
  }
  private async confirmation(hospitalId: string, id: string) {
    const hospital = await new HospitalService(this.pool).getForStaff(hospitalId);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT a.id,a.public_reference,a.patient_id,a.doctor_id,a.status,a.booking_source,a.serial_number,
       a.estimated_start_at_utc,a.slot_start_at_utc,a.is_overbooked,a.rescheduled_from_id,
       DATE_FORMAT(s.service_date,'%Y-%m-%d') AS service_date
       FROM appointments a JOIN appointment_sessions s ON s.hospital_id=a.hospital_id AND s.id=a.session_id
       WHERE a.hospital_id=? AND a.id=?`, [hospitalId, id]);
    if (!rows[0]) throw new HttpError(404, "Appointment not found");
    const row = rows[0];
    return { id: String(row.id), reference: String(row.public_reference), hospitalDisplayName: hospital.displayName,
      timezone: hospital.timezone, patientId: String(row.patient_id), doctorId: String(row.doctor_id), date: String(row.service_date),
      status: String(row.status), source: String(row.booking_source), serialNumber: Number(row.serial_number),
      estimatedStartAt: row.estimated_start_at_utc as Date | null, slotStartAt: row.slot_start_at_utc as Date | null,
      timeIsEstimate: row.slot_start_at_utc === null, isOverbooked: Boolean(row.is_overbooked),
      rescheduledFromId: row.rescheduled_from_id === null ? null : String(row.rescheduled_from_id) };
  }

  async setCutoff(principal: Principal, raw: unknown) {
    this.checkEnabled();
    const body = bodyObject(raw, ["cutoffMinutes"], ["cutoffMinutes"]);
    const minutes = intField(body.cutoffMinutes, "cutoffMinutes", 0, 10080);
    return hospitalTransaction(this.pool, principal, "hospital.manage", async connection => {
      await connection.execute("UPDATE hospitals SET booking_cutoff_minutes=? WHERE id=?", [minutes, principal.hospitalId]);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "hospital.booking_policy.update", entityType: "hospital", entityId: principal.hospitalId });
      return { cutoffMinutes: minutes };
    });
  }
}
