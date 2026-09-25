import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTransition, bookingInput, localInstant } from "./policy.js";
import { normalizeMobile } from "../patients/patients.service.js";

test("local appointment times use hospital timezone, including date rollover", () => {
  assert.equal(localInstant("2030-01-07", "00:15:00", "Asia/Kolkata").toISOString(), "2030-01-06T18:45:00.000Z");
  assert.equal(localInstant("2030-07-07", "12:00:00", "America/New_York").toISOString(), "2030-07-07T16:00:00.000Z");
});
test("DST gaps and repeated local times fail explicitly", () => {
  assert.throws(() => localInstant("2026-03-08", "02:30:00", "America/New_York"), /nonexistent/);
  assert.throws(() => localInstant("2026-11-01", "01:30:00", "America/New_York"), /ambiguous/);
});
test("mobile is normalized without inventing country codes or identity", () => {
  assert.equal(normalizeMobile("+91 (98765) 43210"), "+919876543210");
  assert.equal(normalizeMobile(null), null);
  assert.throws(() => normalizeMobile("9876543210"));
});
test("terminal states cannot reopen and consultation cannot be cancelled", () => {
  assertTransition("WAITING", "IN_CONSULTATION");
  for (const status of ["CANCELLED", "NO_SHOW", "COMPLETED"]) assert.throws(() => assertTransition(status, "BOOKED"));
  assert.throws(() => assertTransition("IN_CONSULTATION", "CANCELLED"));
});
test("booking validates identity, calendar dates, sources and unknown fields", () => {
  const base = { doctorId: "1", scheduleId: "1", date: "2030-01-07", source: "PHONE", patientId: "1" };
  assert.equal(bookingInput(base).patientId, "1");
  assert.throws(() => bookingInput({ ...base, date: "2030-02-30" }));
  assert.throws(() => bookingInput({ ...base, patient: { fullName: "Test" } }));
  assert.throws(() => bookingInput({ ...base, source: "OTHER" }));
  assert.throws(() => bookingInput({ ...base, hospitalId: "2" }));
});
