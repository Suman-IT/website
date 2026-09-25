"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HospitalService = void 0;
const input_js_1 = require("../../http/input.js");
const security_service_js_1 = require("../../security/security.service.js");
function identity(row) {
    return { id: String(row.id), displayName: String(row.display_name), timezone: String(row.timezone) };
}
class HospitalService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async getActiveHospital() {
        const [rows] = await this.pool.execute("SELECT id, display_name, timezone FROM hospitals WHERE is_active = TRUE LIMIT 2");
        if (rows.length !== 1)
            throw new input_js_1.HttpError(503, "Hospital is not configured");
        return identity(rows[0]);
    }
    async getForStaff(hospitalId) {
        const [rows] = await this.pool.execute("SELECT id, display_name, timezone FROM hospitals WHERE id = ? AND is_active = TRUE LIMIT 1", [hospitalId]);
        if (!rows[0])
            throw new input_js_1.HttpError(404, "Hospital not found");
        return identity(rows[0]);
    }
    async updateDisplayName(principal, displayName) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute("SELECT id, timezone FROM hospitals WHERE id = ? AND is_active = TRUE FOR UPDATE", [principal.hospitalId]);
            if (!rows[0])
                throw new input_js_1.HttpError(404, "Hospital not found");
            await connection.execute("UPDATE hospitals SET display_name = ? WHERE id = ?", [displayName, principal.hospitalId]);
            await (0, security_service_js_1.recordAudit)(connection, {
                hospitalId: principal.hospitalId, actorUserId: principal.userId,
                actionCode: "hospital.update", entityType: "hospital", entityId: principal.hospitalId,
            });
            await connection.commit();
            return { id: principal.hospitalId, displayName, timezone: String(rows[0].timezone) };
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
exports.HospitalService = HospitalService;
