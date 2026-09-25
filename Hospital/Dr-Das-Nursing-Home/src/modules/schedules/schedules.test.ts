import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveForDate, type ScheduleInput } from "./schedules.service.js";

const mondayRule: ScheduleInput & { id: string } = {
  id: "1", doctorId: "2", dayOfWeek: 1, startLocal: "09:00:00", endLocal: "12:00:00",
  bookingMode: "SERIAL", capacity: 20, slotMinutes: 10,
  validFrom: "2026-01-01", validUntil: null, isActive: true,
};

test("a date override wins over the recurring weekday and can add a special sitting", () => {
  assert.equal(resolveForDate(mondayRule, null, "2026-09-29"), null);
  assert.deepEqual(resolveForDate(mondayRule, {
    isAvailable: true, startLocal: "14:00:00", endLocal: "16:00:00",
    capacity: 8, slotMinutes: null,
  }, "2026-09-29"), {
    scheduleId: "1", startLocal: "14:00:00", endLocal: "16:00:00",
    bookingMode: "SERIAL", capacity: 8, slotMinutes: 10, isOverride: true,
  });
});

test("leave override hides a normal weekly sitting", () => {
  assert.ok(resolveForDate(mondayRule, null, "2026-09-28"));
  assert.equal(resolveForDate(mondayRule, {
    isAvailable: false, startLocal: null, endLocal: null, capacity: null, slotMinutes: null,
  }, "2026-09-28"), null);
});

test("exclusive capacity cannot exceed the number of whole slots", () => {
  assert.throws(() => resolveForDate({ ...mondayRule, bookingMode: "EXCLUSIVE", capacity: 20,
    startLocal: "09:00:00", endLocal: "10:00:00" }, null, "2026-09-28"),
  /Exclusive capacity exceeds available slots/);
});
