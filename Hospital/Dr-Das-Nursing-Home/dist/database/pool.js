"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDatabasePool = createDatabasePool;
exports.verifySecuritySchema = verifySecuritySchema;
const promise_1 = __importDefault(require("mysql2/promise"));
function required(name, environment) {
    const value = environment[name];
    if (!value?.trim())
        throw new Error(`${name} is required`);
    return value;
}
function createDatabasePool(environment = process.env) {
    const portText = environment.DB_PORT ?? "3306";
    if (!/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
        throw new Error("DB_PORT must be an integer from 1 to 65535");
    }
    return promise_1.default.createPool({
        host: required("DB_HOST", environment),
        port: Number(portText),
        database: required("DB_NAME", environment),
        user: required("DB_USER", environment),
        password: required("DB_PASSWORD", environment),
        timezone: "Z",
        supportBigNumbers: true,
        bigNumberStrings: true,
        waitForConnections: true,
        connectionLimit: 10,
    });
}
async function verifySecuritySchema(pool) {
    const [rows] = await pool.query("SELECT version FROM schema_migrations WHERE version IN (?, ?, ?)", ["0001_core_schema.sql", "0002_security_foundation.sql", "0003_appointment_engine.sql"]);
    if (rows.length !== 3)
        throw new Error("Apply all migrations before starting the server");
}
