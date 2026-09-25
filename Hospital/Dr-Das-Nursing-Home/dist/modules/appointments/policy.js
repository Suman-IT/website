"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitions = exports.sources = void 0;
exports.bookingInput = bookingInput;
exports.localInstant = localInstant;
exports.assertTransition = assertTransition;
const input_js_1 = require("../../http/input.js");
const patients_service_js_1 = require("../patients/patients.service.js");
exports.sources = ["ONLINE", "PHONE", "WALK_IN", "ADMIN"];
function bookingInput(raw, reschedule = false) {
    const body = (0, input_js_1.bodyObject)(raw, ["doctorId", "scheduleId", "date", "source", "slotLocal", "overrideReason", "repeatReason",
        ...(reschedule ? [] : ["patientId", "patient"])], ["doctorId", "scheduleId", "date", "source"]);
    if (!exports.sources.includes(body.source))
        throw new input_js_1.HttpError(400, "Invalid booking source");
    if (!reschedule && ((body.patientId !== undefined) === (body.patient !== undefined)))
        throw new input_js_1.HttpError(400, "Provide patientId or patient");
    return { doctorId: (0, input_js_1.idField)(body.doctorId), scheduleId: (0, input_js_1.idField)(body.scheduleId), date: (0, input_js_1.dateField)(body.date),
        source: body.source, patientId: (0, input_js_1.optionalField)(body.patientId, input_js_1.idField),
        patient: body.patient === undefined ? null : (0, patients_service_js_1.patientInput)(body.patient),
        slotLocal: (0, input_js_1.optionalField)(body.slotLocal, value => (0, input_js_1.timeField)(value, "slotLocal")),
        overrideReason: (0, input_js_1.optionalField)(body.overrideReason, value => (0, input_js_1.textField)(value, "overrideReason", 250)),
        repeatReason: (0, input_js_1.optionalField)(body.repeatReason, value => (0, input_js_1.textField)(value, "repeatReason", 250)) };
}
// Find all possible instants for a local minute. Reject ambiguous/nonexistent
// DST times instead of silently choosing a different appointment time.
function localInstant(date, time, timezone) {
    const target = `${date}T${time.slice(0, 5)}`;
    const naive = Date.parse(`${target}:00Z`);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const local = (instant) => {
        const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    };
    const offsets = new Set();
    for (const hours of [-36, -12, 0, 12, 36]) {
        const sample = naive + hours * 3600000;
        offsets.add(Date.parse(`${local(sample)}:00Z`) - sample);
    }
    const candidates = [...offsets].map(offset => naive - offset).filter(value => local(value) === target);
    if (candidates.length !== 1)
        throw new input_js_1.HttpError(409, "Sitting time is ambiguous or nonexistent in hospital timezone");
    return new Date(candidates[0]);
}
exports.transitions = {
    BOOKED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
    CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
    CHECKED_IN: ["WAITING", "CANCELLED"],
    WAITING: ["IN_CONSULTATION", "CANCELLED"],
    IN_CONSULTATION: ["COMPLETED"], COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
function assertTransition(from, to) {
    if (!exports.transitions[from]?.includes(to))
        throw new input_js_1.HttpError(409, "Invalid appointment state transition");
}
