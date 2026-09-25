import { bodyObject, dateField, HttpError, idField, optionalField, textField, timeField } from "../../http/input.js";
import { patientInput, type PatientInput } from "../patients/patients.service.js";

export const sources = ["ONLINE", "PHONE", "WALK_IN", "ADMIN"] as const;
export type Source = typeof sources[number];
export interface BookingInput {
  doctorId: string; scheduleId: string; date: string; source: Source;
  patientId: string | null; patient: PatientInput | null;
  slotLocal: string | null; overrideReason: string | null; repeatReason: string | null;
}
export function bookingInput(raw: unknown, reschedule = false): BookingInput {
  const body = bodyObject(raw, ["doctorId", "scheduleId", "date", "source", "slotLocal", "overrideReason", "repeatReason",
    ...(reschedule ? [] : ["patientId", "patient"])], ["doctorId", "scheduleId", "date", "source"]);
  if (!sources.includes(body.source as Source)) throw new HttpError(400, "Invalid booking source");
  if (!reschedule && ((body.patientId !== undefined) === (body.patient !== undefined))) throw new HttpError(400, "Provide patientId or patient");
  return { doctorId: idField(body.doctorId), scheduleId: idField(body.scheduleId), date: dateField(body.date),
    source: body.source as Source, patientId: optionalField(body.patientId, idField),
    patient: body.patient === undefined ? null : patientInput(body.patient),
    slotLocal: optionalField(body.slotLocal, value => timeField(value, "slotLocal")),
    overrideReason: optionalField(body.overrideReason, value => textField(value, "overrideReason", 250)),
    repeatReason: optionalField(body.repeatReason, value => textField(value, "repeatReason", 250)) };
}

// Find all possible instants for a local minute. Reject ambiguous/nonexistent
// DST times instead of silently choosing a different appointment time.
export function localInstant(date: string, time: string, timezone: string): Date {
  const target = `${date}T${time.slice(0, 5)}`;
  const naive = Date.parse(`${target}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const local = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = naive + hours * 3600000;
    offsets.add(Date.parse(`${local(sample)}:00Z`) - sample);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(value => local(value) === target);
  if (candidates.length !== 1) throw new HttpError(409, "Sitting time is ambiguous or nonexistent in hospital timezone");
  return new Date(candidates[0]!);
}

export const transitions: Readonly<Record<string, readonly string[]>> = {
  BOOKED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["WAITING", "CANCELLED"],
  WAITING: ["IN_CONSULTATION", "CANCELLED"],
  IN_CONSULTATION: ["COMPLETED"], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
export function assertTransition(from: string, to: string) {
  if (!transitions[from]?.includes(to)) throw new HttpError(409, "Invalid appointment state transition");
}
