"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoctorService = void 0;
const input_js_1 = require("../../http/input.js");
const security_service_js_1 = require("../../security/security.service.js");
function view(row, departmentIds = []) {
    return { id: String(row.id), displayName: String(row.display_name), slug: String(row.slug),
        isActive: Boolean(row.is_active), isPublished: Boolean(row.is_published), departmentIds };
}
async function replaceDepartments(connection, hospitalId, doctorId, departmentIds) {
    if (departmentIds.length) {
        const placeholders = departmentIds.map(() => "?").join(",");
        const [rows] = await connection.execute(`SELECT id FROM departments WHERE hospital_id = ? AND id IN (${placeholders}) FOR UPDATE`, [hospitalId, ...departmentIds]);
        if (rows.length !== departmentIds.length)
            throw new input_js_1.HttpError(400, "A department does not belong to this hospital");
    }
    await connection.execute("DELETE FROM doctor_departments WHERE hospital_id = ? AND doctor_id = ?", [hospitalId, doctorId]);
    for (const departmentId of departmentIds) {
        await connection.execute("INSERT INTO doctor_departments (hospital_id, doctor_id, department_id) VALUES (?, ?, ?)", [hospitalId, doctorId, departmentId]);
    }
}
class DoctorService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async listPublic(hospitalId) {
        const [rows] = await this.pool.execute(`SELECT id, display_name, slug FROM doctors
       WHERE hospital_id = ? AND is_active = TRUE AND is_published = TRUE
       ORDER BY display_name, slug`, [hospitalId]);
        const [links] = await this.pool.execute(`SELECT dd.doctor_id, d.slug AS department_slug FROM doctor_departments dd
       JOIN departments d ON d.hospital_id = dd.hospital_id AND d.id = dd.department_id
       WHERE dd.hospital_id = ? AND d.is_published = TRUE`, [hospitalId]);
        const slugs = new Map();
        for (const link of links) {
            const id = String(link.doctor_id);
            const values = slugs.get(id) ?? [];
            values.push(String(link.department_slug));
            slugs.set(id, values);
        }
        return rows.map((row) => ({ id: String(row.id), displayName: String(row.display_name), slug: String(row.slug),
            departmentSlugs: slugs.get(String(row.id)) ?? [] }));
    }
    async list(hospitalId) {
        const [rows] = await this.pool.execute(`SELECT id, display_name, slug, is_active, is_published FROM doctors
       WHERE hospital_id = ?
       ORDER BY display_name, id`, [hospitalId]);
        const [links] = await this.pool.execute(`SELECT dd.doctor_id, dd.department_id FROM doctor_departments dd
       JOIN departments d ON d.hospital_id = dd.hospital_id AND d.id = dd.department_id
       WHERE dd.hospital_id = ?`, [hospitalId]);
        const byDoctor = new Map();
        for (const link of links) {
            const doctorId = String(link.doctor_id);
            const ids = byDoctor.get(doctorId) ?? [];
            ids.push(String(link.department_id));
            byDoctor.set(doctorId, ids);
        }
        return rows.map((row) => view(row, byDoctor.get(String(row.id)) ?? []));
    }
    async create(principal, input, departmentIds) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.execute(`INSERT INTO doctors (hospital_id, display_name, slug, is_active, is_published)
         VALUES (?, ?, ?, ?, ?)`, [principal.hospitalId, input.displayName, input.slug, input.isActive, input.isPublished]);
            const id = String(result.insertId);
            await replaceDepartments(connection, principal.hospitalId, id, departmentIds);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "doctor.create", entityType: "doctor", entityId: id });
            await connection.commit();
            return { id, ...input, departmentIds };
        }
        catch (error) {
            await connection.rollback();
            if ((0, input_js_1.isDuplicateKey)(error))
                throw new input_js_1.HttpError(409, "Doctor slug already exists");
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async update(principal, id, patch) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute("SELECT id FROM doctors WHERE hospital_id = ? AND id = ? FOR UPDATE", [principal.hospitalId, id]);
            if (!rows[0])
                throw new input_js_1.HttpError(404, "Doctor not found");
            const fields = [];
            const values = [];
            if (patch.displayName !== undefined) {
                fields.push("display_name = ?");
                values.push(patch.displayName);
            }
            if (patch.slug !== undefined) {
                fields.push("slug = ?");
                values.push(patch.slug);
            }
            if (patch.isActive !== undefined) {
                fields.push("is_active = ?");
                values.push(patch.isActive);
            }
            if (patch.isPublished !== undefined) {
                fields.push("is_published = ?");
                values.push(patch.isPublished);
            }
            if (!fields.length)
                throw new input_js_1.HttpError(400, "No changes supplied");
            await connection.execute(`UPDATE doctors SET ${fields.join(", ")} WHERE hospital_id = ? AND id = ?`, [...values, principal.hospitalId, id]);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "doctor.update", entityType: "doctor", entityId: id });
            const [updated] = await connection.execute("SELECT id, display_name, slug, is_active, is_published FROM doctors WHERE hospital_id = ? AND id = ?", [principal.hospitalId, id]);
            await connection.commit();
            return view(updated[0]);
        }
        catch (error) {
            await connection.rollback();
            if ((0, input_js_1.isDuplicateKey)(error))
                throw new input_js_1.HttpError(409, "Doctor slug already exists");
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async setDepartments(principal, id, departmentIds) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute("SELECT id FROM doctors WHERE hospital_id = ? AND id = ? FOR UPDATE", [principal.hospitalId, id]);
            if (!rows[0])
                throw new input_js_1.HttpError(404, "Doctor not found");
            await replaceDepartments(connection, principal.hospitalId, id, departmentIds);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "doctor.departments.update", entityType: "doctor", entityId: id });
            await connection.commit();
            return { id, departmentIds };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
}
exports.DoctorService = DoctorService;
