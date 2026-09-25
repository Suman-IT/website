"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatientService = void 0;
exports.normalizeMobile = normalizeMobile;
exports.patientInput = patientInput;
exports.insertPatient = insertPatient;
exports.patientRow = patientRow;
const operation_js_1 = require("../../database/operation.js");
const input_js_1 = require("../../http/input.js");
const security_service_js_1 = require("../../security/security.service.js");
function normalizeMobile(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value !== "string")
        throw new input_js_1.HttpError(400, "Invalid mobile");
    const normalized = value.replace(/[ ()-]/g, "");
    // Do not guess country codes or merge people by a shared contact number.
    if (!/^\+[1-9]\d{7,14}$/.test(normalized))
        throw new input_js_1.HttpError(400, "Mobile must include its country code, e.g. +91");
    return normalized;
}
function patientInput(raw) {
    const body = (0, input_js_1.bodyObject)(raw, ["fullName", "mobile"], ["fullName"]);
    return { fullName: (0, input_js_1.textField)(body.fullName, "fullName"), mobile: normalizeMobile(body.mobile) };
}
async function insertPatient(connection, principal, input) {
    const [result] = await connection.execute("INSERT INTO patients (hospital_id,full_name,mobile_normalized) VALUES (?,?,?)", [principal.hospitalId, input.fullName, input.mobile]);
    const id = String(result.insertId);
    await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
        actionCode: "patient.create", entityType: "patient", entityId: id });
    return id;
}
async function patientRow(connection, hospitalId, id) {
    const [rows] = await connection.execute("SELECT id,full_name,mobile_normalized FROM patients WHERE hospital_id=? AND id=? FOR UPDATE", [hospitalId, id]);
    if (!rows[0])
        throw new input_js_1.HttpError(404, "Patient not found");
    return { id: String(rows[0].id), fullName: String(rows[0].full_name), mobile: rows[0].mobile_normalized };
}
class PatientService {
    pool;
    enabled;
    constructor(pool, enabled) {
        this.pool = pool;
        this.enabled = enabled;
    }
    checkEnabled() { if (!this.enabled)
        throw new input_js_1.HttpError(404, "Patients are disabled"); }
    async create(principal, raw, key) {
        this.checkEnabled();
        const input = patientInput(raw);
        return (0, operation_js_1.hospitalTransaction)(this.pool, principal, "patient.create", async (connection) => {
            const id = await (0, operation_js_1.idempotent)(connection, principal, "patient.create", key, input, () => insertPatient(connection, principal, input));
            return patientRow(connection, principal.hospitalId, id);
        });
    }
    async update(principal, id, raw) {
        this.checkEnabled();
        (0, input_js_1.idField)(id);
        const input = patientInput(raw);
        return (0, operation_js_1.hospitalTransaction)(this.pool, principal, "patient.update", async (connection) => {
            await patientRow(connection, principal.hospitalId, id);
            await connection.execute("UPDATE patients SET full_name=?,mobile_normalized=? WHERE hospital_id=? AND id=?", [input.fullName, input.mobile, principal.hospitalId, id]);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "patient.update", entityType: "patient", entityId: id });
            return patientRow(connection, principal.hospitalId, id);
        });
    }
    async get(principal, id) {
        this.checkEnabled();
        (0, input_js_1.idField)(id);
        return (0, operation_js_1.hospitalTransaction)(this.pool, principal, "patient.read", async (connection) => {
            const patient = await patientRow(connection, principal.hospitalId, id);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "patient.read", entityType: "patient", entityId: id });
            return patient;
        });
    }
    async search(principal, raw) {
        this.checkEnabled();
        const body = (0, input_js_1.bodyObject)(raw, ["mobile", "name"]);
        if ((body.mobile !== undefined) === (body.name !== undefined))
            throw new input_js_1.HttpError(400, "Provide mobile or name");
        const mobile = body.mobile === undefined ? null : normalizeMobile(body.mobile);
        const name = body.name === undefined ? null : (0, input_js_1.textField)(body.name, "name");
        if (!mobile && (!name || name.length < 2))
            throw new input_js_1.HttpError(400, "Search is too short");
        return (0, operation_js_1.hospitalTransaction)(this.pool, principal, "patient.read", async (connection) => {
            const [rows] = await connection.execute(`SELECT id,full_name,mobile_normalized FROM patients WHERE hospital_id=? AND ${mobile ? "mobile_normalized=?" : "LEFT(full_name,CHAR_LENGTH(?))=?"} ORDER BY id LIMIT 50`, mobile ? [principal.hospitalId, mobile] : [principal.hospitalId, name, name]);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "patient.search", entityType: "patient", entityId: null });
            return rows.map(row => ({ id: String(row.id), fullName: String(row.full_name), mobile: row.mobile_normalized }));
        });
    }
}
exports.PatientService = PatientService;
