import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { HttpError } from "../../http/input.js";
import type { Principal } from "../../security/security.service.js";
import { recordAudit } from "../../security/security.service.js";

export interface ScheduleInput {
  doctorId: string;
  dayOfWeek: number;
  startLocal: string;
  endLocal: string;
  bookingMode: "SERIAL" | "EXCLUSIVE";
  capacity: number;
  slotMinutes: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
}

export interface OverrideInput {
  isAvailable: boolean;
  startLocal: string | null;
  endLocal: string | null;
  capacity: number | null;
  slotMinutes: number | null;
}

interface Schedule extends ScheduleInput { id: string; }
interface EffectiveSession {
  scheduleId: string;
  startLocal: string;
  endLocal: string;
  bookingMode: "SERIAL" | "EXCLUSIVE";
  capacity: number;
  slotMinutes: number;
  isOverride: boolean;
}

const SCHEDULE_COLUMNS = `s.id, s.doctor_id, s.day_of_week, s.start_local, s.end_local,
  s.booking_mode, s.capacity, s.slot_minutes, DATE_FORMAT(s.valid_from, '%Y-%m-%d') AS valid_from,
  DATE_FORMAT(s.valid_until, '%Y-%m-%d') AS valid_until, s.is_active`;

function scheduleFrom(row: RowDataPacket): Schedule {
  return {
    id: String(row.id), doctorId: String(row.doctor_id), dayOfWeek: Number(row.day_of_week),
    startLocal: String(row.start_local), endLocal: String(row.end_local),
    bookingMode: String(row.booking_mode) as ScheduleInput["bookingMode"],
    capacity: Number(row.capacity), slotMinutes: Number(row.slot_minutes),
    validFrom: String(row.valid_from), validUntil: row.valid_until === null ? null : String(row.valid_until),
    isActive: Boolean(row.is_active),
  };
}

function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function validateWindow(input: Pick<ScheduleInput, "startLocal" | "endLocal" | "bookingMode" | "capacity" | "slotMinutes">): void {
  const duration = minuteOfDay(input.endLocal) - minuteOfDay(input.startLocal);
  if (duration <= 0) throw new HttpError(400, "Schedule end must be after start");
  if (!Number.isInteger(input.capacity) || input.capacity < 1 ||
      !Number.isInteger(input.slotMinutes) || input.slotMinutes < 1 || input.slotMinutes > duration) {
    throw new HttpError(400, "Capacity or consultation duration is invalid for this sitting");
  }
  if (input.bookingMode === "EXCLUSIVE" && input.capacity > Math.floor(duration / input.slotMinutes)) {
    throw new HttpError(400, "Exclusive capacity exceeds available slots");
  }
}

function weekdays(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function inRange(schedule: Schedule, date: string): boolean {
  return schedule.validFrom <= date && (schedule.validUntil === null || schedule.validUntil >= date);
}

export function resolveForDate(schedule: Schedule, override: OverrideInput | null,
  date: string): EffectiveSession | null {
  if (!schedule.isActive || !inRange(schedule, date)) return null;
  if (override?.isAvailable === false) return null;
  if (!override && schedule.dayOfWeek !== weekdays(date)) return null;
  const effective: EffectiveSession = {
    scheduleId: schedule.id,
    startLocal: override?.startLocal ?? schedule.startLocal,
    endLocal: override?.endLocal ?? schedule.endLocal,
    bookingMode: schedule.bookingMode,
    capacity: override?.capacity ?? schedule.capacity,
    slotMinutes: override?.slotMinutes ?? schedule.slotMinutes,
    isOverride: override !== null,
  };
  validateWindow(effective);
  return effective;
}

function overrideFrom(row: RowDataPacket): OverrideInput | null {
  if (row.override_id === null || row.override_id === undefined) return null;
  return {
    isAvailable: Boolean(row.override_available),
    startLocal: row.override_start === null ? null : String(row.override_start),
    endLocal: row.override_end === null ? null : String(row.override_end),
    capacity: row.override_capacity === null ? null : Number(row.override_capacity),
    slotMinutes: row.override_slot_minutes === null ? null : Number(row.override_slot_minutes),
  };
}

function datesOverlap(a: Schedule, b: Schedule): boolean {
  return (a.validUntil === null || a.validUntil >= b.validFrom) &&
    (b.validUntil === null || b.validUntil >= a.validFrom);
}

function timesOverlap(a: { startLocal: string; endLocal: string },
  b: { startLocal: string; endLocal: string }): boolean {
  return a.startLocal < b.endLocal && b.startLocal < a.endLocal;
}

export class ScheduleService {
  constructor(private readonly pool: Pool) {}

  // The engine supplies its transaction; schedule administration uses the same
  // doctor lock, preventing allocation against a concurrently edited sitting.
  async resolveForBooking(connection: PoolConnection, hospitalId: string,
    doctorId: string, scheduleId: string, date: string, online: boolean) {
    await this.lockDoctor(connection, hospitalId, doctorId);
    const [doctors] = await connection.execute<RowDataPacket[]>(
      "SELECT is_active,is_published FROM doctors WHERE hospital_id=? AND id=? FOR UPDATE",
      [hospitalId, doctorId]);
    if (!doctors[0]?.is_active || (online && !doctors[0]?.is_published)) throw new HttpError(409, "Doctor is unavailable");
    const records = await this.datedSchedules(connection, hospitalId, doctorId, date, true);
    const record = records.find(item => item.schedule.id === scheduleId);
    const effective = record ? resolveForDate(record.schedule, record.override, date) : null;
    if (!effective) throw new HttpError(409, "Doctor has no available sitting on this date");
    return effective;
  }

  private async lockDoctor(connection: PoolConnection, hospitalId: string, doctorId: string): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM doctors WHERE hospital_id = ? AND id = ? FOR UPDATE",
      [hospitalId, doctorId],
    );
    if (!rows[0]) throw new HttpError(404, "Doctor not found");
  }

  private async getSchedule(connection: PoolConnection, hospitalId: string, id: string,
    lock = false): Promise<Schedule> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${SCHEDULE_COLUMNS} FROM doctor_schedules s WHERE s.hospital_id = ? AND s.id = ? ${lock ? "FOR UPDATE" : ""}`,
      [hospitalId, id],
    );
    if (!rows[0]) throw new HttpError(404, "Schedule not found");
    return scheduleFrom(rows[0]);
  }

  private async assertNoRecurringOverlap(connection: PoolConnection, hospitalId: string,
    candidate: Schedule): Promise<void> {
    if (!candidate.isActive) return;
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${SCHEDULE_COLUMNS} FROM doctor_schedules s
       WHERE s.hospital_id = ? AND s.doctor_id = ? AND s.is_active = TRUE
         AND s.day_of_week = ? AND s.id <> ? FOR UPDATE`,
      [hospitalId, candidate.doctorId, candidate.dayOfWeek, candidate.id],
    );
    for (const row of rows) {
      const existing = scheduleFrom(row);
      if (datesOverlap(candidate, existing) && timesOverlap(candidate, existing)) {
        throw new HttpError(409, "Recurring schedules overlap");
      }
    }
  }

  private async datedSchedules(connection: PoolConnection, hospitalId: string,
    doctorId: string, date: string, lock = false): Promise<Array<{ schedule: Schedule; override: OverrideInput | null }>> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${SCHEDULE_COLUMNS}, o.id AS override_id, o.is_available AS override_available,
         o.start_local AS override_start, o.end_local AS override_end,
         o.capacity AS override_capacity, o.slot_minutes AS override_slot_minutes
       FROM doctor_schedules s LEFT JOIN schedule_overrides o
         ON o.hospital_id = s.hospital_id AND o.schedule_id = s.id AND o.service_date = ?
       WHERE s.hospital_id = ? AND s.doctor_id = ? AND s.is_active = TRUE
         AND s.valid_from <= ? AND (s.valid_until IS NULL OR s.valid_until >= ?)
       ${lock ? "FOR UPDATE" : ""}`,
      [date, hospitalId, doctorId, date, date],
    );
    return rows.map((row) => ({ schedule: scheduleFrom(row), override: overrideFrom(row) }));
  }

  private async assertNoDatedOverlap(connection: PoolConnection, hospitalId: string,
    doctorId: string, date: string, replacement?: { scheduleId: string; value: OverrideInput | null }): Promise<void> {
    const records = await this.datedSchedules(connection, hospitalId, doctorId, date, true);
    const effective = records.map(({ schedule, override }) => resolveForDate(schedule,
      replacement?.scheduleId === schedule.id ? replacement.value : override, date))
      .filter((item): item is EffectiveSession => item !== null);
    for (let i = 0; i < effective.length; i++) {
      for (let j = i + 1; j < effective.length; j++) {
        if (timesOverlap(effective[i]!, effective[j]!)) throw new HttpError(409, "Date-specific sittings overlap");
      }
    }
  }

  private async assertOverrideDatesNoOverlap(connection: PoolConnection, hospitalId: string,
    doctorId: string, from: string, until: string | null): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(o.service_date, '%Y-%m-%d') AS service_date
       FROM schedule_overrides o JOIN doctor_schedules s
         ON s.hospital_id = o.hospital_id AND s.id = o.schedule_id
       WHERE o.hospital_id = ? AND s.doctor_id = ? AND o.service_date >= ?
         AND (? IS NULL OR o.service_date <= ?) FOR UPDATE`,
      [hospitalId, doctorId, from, until, until],
    );
    for (const date of new Set(rows.map((row) => String(row.service_date)))) {
      await this.assertNoDatedOverlap(connection, hospitalId, doctorId, date);
    }
  }

  async listForStaff(hospitalId: string, doctorId: string): Promise<Schedule[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${SCHEDULE_COLUMNS} FROM doctor_schedules s
       WHERE s.hospital_id = ? AND s.doctor_id = ? ORDER BY s.day_of_week, s.start_local, s.id`,
      [hospitalId, doctorId],
    );
    return rows.map(scheduleFrom);
  }

  async create(principal: Principal, input: ScheduleInput): Promise<Schedule> {
    validateWindow(input);
    if (input.validUntil !== null && input.validUntil < input.validFrom) throw new HttpError(400, "Invalid schedule dates");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.lockDoctor(connection, principal.hospitalId, input.doctorId);
      const candidate: Schedule = { id: "0", ...input };
      await this.assertNoRecurringOverlap(connection, principal.hospitalId, candidate);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO doctor_schedules
           (hospital_id, doctor_id, day_of_week, start_local, end_local, booking_mode,
            capacity, slot_minutes, valid_from, valid_until, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [principal.hospitalId, input.doctorId, input.dayOfWeek, input.startLocal,
          input.endLocal, input.bookingMode, input.capacity, input.slotMinutes,
          input.validFrom, input.validUntil, input.isActive],
      );
      const id = String(result.insertId);
      await this.assertOverrideDatesNoOverlap(connection, principal.hospitalId,
        input.doctorId, input.validFrom, input.validUntil);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "schedule.create", entityType: "schedule", entityId: id });
      await connection.commit();
      return { id, ...input };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async update(principal: Principal, id: string, patch: Partial<Omit<ScheduleInput, "doctorId">>): Promise<Schedule> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const initial = await this.getSchedule(connection, principal.hospitalId, id);
      await this.lockDoctor(connection, principal.hospitalId, initial.doctorId);
      const existing = await this.getSchedule(connection, principal.hospitalId, id, true);
      const candidate: Schedule = { ...existing, ...patch };
      validateWindow(candidate);
      if (candidate.validUntil !== null && candidate.validUntil < candidate.validFrom) throw new HttpError(400, "Invalid schedule dates");
      const structural = Object.keys(patch).some((key) => key !== "isActive");
      if (structural) {
        const [sessions] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM appointment_sessions WHERE hospital_id = ? AND schedule_id = ? LIMIT 1 FOR UPDATE",
          [principal.hospitalId, id],
        );
        if (sessions[0]) throw new HttpError(409, "A dated appointment session already uses this schedule");
        const [outOfRangeOverrides] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM schedule_overrides
           WHERE hospital_id = ? AND schedule_id = ?
             AND (service_date < ? OR (? IS NOT NULL AND service_date > ?)) LIMIT 1 FOR UPDATE`,
          [principal.hospitalId, id, candidate.validFrom, candidate.validUntil, candidate.validUntil],
        );
        if (outOfRangeOverrides[0]) throw new HttpError(409, "An override falls outside the new validity dates");
      }
      await this.assertNoRecurringOverlap(connection, principal.hospitalId, candidate);
      await connection.execute(
        `UPDATE doctor_schedules SET day_of_week = ?, start_local = ?, end_local = ?,
         booking_mode = ?, capacity = ?, slot_minutes = ?, valid_from = ?, valid_until = ?,
         is_active = ? WHERE hospital_id = ? AND id = ?`,
        [candidate.dayOfWeek, candidate.startLocal, candidate.endLocal, candidate.bookingMode,
          candidate.capacity, candidate.slotMinutes, candidate.validFrom, candidate.validUntil,
          candidate.isActive, principal.hospitalId, id],
      );
      await this.assertOverrideDatesNoOverlap(connection, principal.hospitalId,
        candidate.doctorId, candidate.validFrom, candidate.validUntil);
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "schedule.update", entityType: "schedule", entityId: id });
      await connection.commit();
      return candidate;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async upsertOverride(principal: Principal, scheduleId: string, date: string,
    input: OverrideInput): Promise<{ scheduleId: string; date: string; override: OverrideInput }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const initial = await this.getSchedule(connection, principal.hospitalId, scheduleId);
      await this.lockDoctor(connection, principal.hospitalId, initial.doctorId);
      const schedule = await this.getSchedule(connection, principal.hospitalId, scheduleId, true);
      if (!inRange(schedule, date)) throw new HttpError(400, "Override date is outside schedule validity");
      const [sessions] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM appointment_sessions WHERE hospital_id = ? AND schedule_id = ? AND service_date = ? LIMIT 1 FOR UPDATE",
        [principal.hospitalId, scheduleId, date],
      );
      if (sessions[0]) throw new HttpError(409, "A dated appointment session already uses this date");
      if (input.isAvailable) {
        const effective = resolveForDate(schedule, input, date);
        if (!effective) throw new HttpError(400, "Schedule is inactive");
      } else if (input.startLocal !== null || input.endLocal !== null || input.capacity !== null || input.slotMinutes !== null) {
        throw new HttpError(400, "Leave override cannot set sitting details");
      }
      await this.assertNoDatedOverlap(connection, principal.hospitalId, schedule.doctorId, date,
        { scheduleId, value: input });
      await connection.execute(
        `INSERT INTO schedule_overrides
           (hospital_id, schedule_id, service_date, is_available, start_local, end_local, capacity, slot_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_available = ?, start_local = ?,
           end_local = ?, capacity = ?, slot_minutes = ?`,
        [principal.hospitalId, scheduleId, date, input.isAvailable, input.startLocal,
          input.endLocal, input.capacity, input.slotMinutes, input.isAvailable,
          input.startLocal, input.endLocal, input.capacity, input.slotMinutes],
      );
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM schedule_overrides WHERE hospital_id = ? AND schedule_id = ? AND service_date = ?",
        [principal.hospitalId, scheduleId, date],
      );
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "schedule.override.upsert", entityType: "schedule_override", entityId: String(rows[0]!.id) });
      await connection.commit();
      return { scheduleId, date, override: input };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async deleteOverride(principal: Principal, scheduleId: string, date: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const initial = await this.getSchedule(connection, principal.hospitalId, scheduleId);
      await this.lockDoctor(connection, principal.hospitalId, initial.doctorId);
      const [sessions] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM appointment_sessions WHERE hospital_id = ? AND schedule_id = ? AND service_date = ? LIMIT 1 FOR UPDATE",
        [principal.hospitalId, scheduleId, date],
      );
      if (sessions[0]) throw new HttpError(409, "A dated appointment session already uses this date");
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM schedule_overrides WHERE hospital_id = ? AND schedule_id = ? AND service_date = ? FOR UPDATE",
        [principal.hospitalId, scheduleId, date],
      );
      if (!rows[0]) throw new HttpError(404, "Override not found");
      await this.assertNoDatedOverlap(connection, principal.hospitalId, initial.doctorId, date,
        { scheduleId, value: null });
      await connection.execute(
        "DELETE FROM schedule_overrides WHERE hospital_id = ? AND schedule_id = ? AND service_date = ?",
        [principal.hospitalId, scheduleId, date],
      );
      await recordAudit(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "schedule.override.delete", entityType: "schedule_override", entityId: String(rows[0].id) });
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async listOverrides(hospitalId: string, scheduleId: string, from: string, to: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT o.id, DATE_FORMAT(o.service_date, '%Y-%m-%d') AS service_date,
         o.is_available, o.start_local, o.end_local, o.capacity, o.slot_minutes
       FROM schedule_overrides o JOIN doctor_schedules s
         ON s.hospital_id = o.hospital_id AND s.id = o.schedule_id
       WHERE o.hospital_id = ? AND o.schedule_id = ? AND o.service_date BETWEEN ? AND ?
       ORDER BY o.service_date`,
      [hospitalId, scheduleId, from, to],
    );
    return rows.map((row) => ({ id: String(row.id), date: String(row.service_date),
      isAvailable: Boolean(row.is_available),
      startLocal: row.start_local === null ? null : String(row.start_local),
      endLocal: row.end_local === null ? null : String(row.end_local),
      capacity: row.capacity === null ? null : Number(row.capacity),
      slotMinutes: row.slot_minutes === null ? null : Number(row.slot_minutes) }));
  }

  async availability(hospitalId: string, doctorSlug: string, date: string) {
    const [doctor] = await this.pool.execute<RowDataPacket[]>(
      "SELECT id FROM doctors WHERE hospital_id = ? AND slug = ? AND is_active = TRUE AND is_published = TRUE LIMIT 1",
      [hospitalId, doctorSlug],
    );
    if (!doctor[0]) throw new HttpError(404, "Doctor not found");
    const doctorId = String(doctor[0].id);
    const connection = await this.pool.getConnection();
    try {
      const records = await this.datedSchedules(connection, hospitalId, doctorId, date);
      const sessions = records.map(({ schedule, override }) => resolveForDate(schedule, override, date))
        .filter((item): item is EffectiveSession => item !== null)
        .sort((a, b) => a.startLocal.localeCompare(b.startLocal));
      return { doctorSlug, date, sessions };
    } finally { connection.release(); }
  }
}
