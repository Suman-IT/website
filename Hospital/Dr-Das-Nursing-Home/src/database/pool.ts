import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

function required(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

export function createDatabasePool(environment: NodeJS.ProcessEnv = process.env): Pool {
  const portText = environment.DB_PORT ?? "3306";
  if (!/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error("DB_PORT must be an integer from 1 to 65535");
  }
  return mysql.createPool({
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

export async function verifySecuritySchema(pool: Pool): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT version FROM schema_migrations WHERE version IN (?, ?, ?)",
    ["0001_core_schema.sql", "0002_security_foundation.sql", "0003_appointment_engine.sql"],
  );
  if (rows.length !== 3) throw new Error("Apply all migrations before starting the server");
}
