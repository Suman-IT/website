"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DepartmentService = void 0;
const input_js_1 = require("../../http/input.js");
const security_service_js_1 = require("../../security/security.service.js");
function view(row) {
    return { id: String(row.id), name: String(row.name), slug: String(row.slug),
        isPublished: Boolean(row.is_published) };
}
class DepartmentService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async listPublic(hospitalId) {
        const [rows] = await this.pool.execute(`SELECT name, slug FROM departments
       WHERE hospital_id = ? AND is_published = TRUE ORDER BY name, slug`, [hospitalId]);
        return rows.map((row) => ({ name: String(row.name), slug: String(row.slug) }));
    }
    async list(hospitalId) {
        const [rows] = await this.pool.execute(`SELECT id, name, slug, is_published FROM departments
       WHERE hospital_id = ?
       ORDER BY name, id`, [hospitalId]);
        return rows.map(view);
    }
    async create(principal, input) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.execute(`INSERT INTO departments (hospital_id, name, slug, is_published)
         VALUES (?, ?, ?, ?)`, [principal.hospitalId, input.name, input.slug, input.isPublished]);
            const id = String(result.insertId);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "department.create", entityType: "department", entityId: id });
            await connection.commit();
            return { id, ...input };
        }
        catch (error) {
            await connection.rollback();
            if ((0, input_js_1.isDuplicateKey)(error))
                throw new input_js_1.HttpError(409, "Department slug already exists");
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
            const [rows] = await connection.execute("SELECT id FROM departments WHERE hospital_id = ? AND id = ? FOR UPDATE", [principal.hospitalId, id]);
            if (!rows[0])
                throw new input_js_1.HttpError(404, "Department not found");
            const fields = [];
            const values = [];
            if (patch.name !== undefined) {
                fields.push("name = ?");
                values.push(patch.name);
            }
            if (patch.slug !== undefined) {
                fields.push("slug = ?");
                values.push(patch.slug);
            }
            if (patch.isPublished !== undefined) {
                fields.push("is_published = ?");
                values.push(patch.isPublished);
            }
            if (!fields.length)
                throw new input_js_1.HttpError(400, "No changes supplied");
            await connection.execute(`UPDATE departments SET ${fields.join(", ")} WHERE hospital_id = ? AND id = ?`, [...values, principal.hospitalId, id]);
            await (0, security_service_js_1.recordAudit)(connection, { hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "department.update", entityType: "department", entityId: id });
            const [updated] = await connection.execute("SELECT id, name, slug, is_published FROM departments WHERE hospital_id = ? AND id = ?", [principal.hospitalId, id]);
            await connection.commit();
            return view(updated[0]);
        }
        catch (error) {
            await connection.rollback();
            if ((0, input_js_1.isDuplicateKey)(error))
                throw new input_js_1.HttpError(409, "Department slug already exists");
            throw error;
        }
        finally {
            connection.release();
        }
    }
}
exports.DepartmentService = DepartmentService;
