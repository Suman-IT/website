"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash = void 0;
exports.hospitalTransaction = hospitalTransaction;
exports.requireGrant = requireGrant;
exports.idempotent = idempotent;
const node_crypto_1 = require("node:crypto");
const input_js_1 = require("../http/input.js");
const hash = (value) => (0, node_crypto_1.createHash)("sha256").update(value).digest();
exports.hash = hash;
// A conservative per-hospital allocation lock suits a single-clinic deployment.
// All booking mutations and patient writes use this same transaction boundary.
async function hospitalTransaction(pool, principal, permission, work) {
    for (let attempt = 0;; attempt++) {
        const connection = await pool.getConnection();
        try {
            await connection.query("SET time_zone = '+00:00'");
            await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
            await connection.beginTransaction();
            const [hospitals] = await connection.execute("SELECT id, timezone, booking_cutoff_minutes FROM hospitals WHERE id = ? AND is_active = TRUE FOR UPDATE", [principal.hospitalId]);
            if (!hospitals[0])
                throw new input_js_1.HttpError(404, "Hospital not found");
            await requireGrant(connection, principal, permission);
            const result = await work(connection, hospitals[0]);
            await connection.commit();
            return result;
        }
        catch (error) {
            await connection.rollback();
            const code = error.code;
            if (attempt < 2 && (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT"))
                continue;
            if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
                throw new input_js_1.HttpError(503, "Booking is busy; retry with the same idempotency key");
            }
            throw error;
        }
        finally {
            connection.release();
        }
    }
}
async function requireGrant(connection, principal, permission) {
    const [rows] = await connection.execute(`SELECT u.id FROM users u JOIN user_roles ur ON ur.hospital_id=u.hospital_id AND ur.user_id=u.id
     JOIN role_permissions rp ON rp.hospital_id=ur.hospital_id AND rp.role_id=ur.role_id
     WHERE u.hospital_id=? AND u.id=? AND u.is_active=TRUE AND rp.permission_code=? LIMIT 1`, [principal.hospitalId, principal.userId, permission]);
    if (!rows[0])
        throw new input_js_1.HttpError(403, "Forbidden");
}
async function idempotent(connection, principal, operation, key, payload, work) {
    const normalized = (0, input_js_1.textField)(key, "Idempotency-Key", 128);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized))
        throw new input_js_1.HttpError(400, "Invalid Idempotency-Key");
    const keyHash = (0, exports.hash)(normalized);
    const requestHash = (0, exports.hash)(JSON.stringify(payload));
    const [rows] = await connection.execute("SELECT request_hash,result_id FROM operation_requests WHERE hospital_id=? AND actor_user_id=? AND operation=? AND key_hash=? FOR UPDATE", [principal.hospitalId, principal.userId, operation, keyHash]);
    if (rows[0]) {
        if (!requestHash.equals(rows[0].request_hash))
            throw new input_js_1.HttpError(409, "Idempotency key was used for a different request");
        return String(rows[0].result_id);
    }
    const id = await work();
    await connection.execute("INSERT INTO operation_requests (hospital_id,actor_user_id,operation,key_hash,request_hash,result_id) VALUES (?,?,?,?,?,?)", [principal.hospitalId, principal.userId, operation, keyHash, requestHash, id]);
    return id;
}
