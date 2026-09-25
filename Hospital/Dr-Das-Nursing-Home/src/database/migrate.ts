import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for migrations`);
  return value;
}

async function migrate(): Promise<void> {
  const portText = process.env.DB_PORT ?? "3306";
  if (!/^[0-9]+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error("DB_PORT must be an integer from 1 to 65535");
  }
  const migrationDirectory = resolve(process.cwd(), "db/migrations");
  const files = readdirSync(migrationDirectory)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  if (files.length === 0) throw new Error("No versioned SQL migrations found");

  const connection = await mysql.createConnection({
    host: required("DB_HOST"),
    port: Number(portText),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    multipleStatements: true, // Trusted, version-controlled migration files only.
    timezone: "Z",
  });

  let locked = false;
  try {
    await connection.query("SET time_zone = '+00:00'");
    const [lockRows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK('skdora_schema_migrations', 30) AS acquired",
    );
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire migration lock");
    locked = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(128) NOT NULL PRIMARY KEY,
        checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        applied_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [history] = await connection.query<RowDataPacket[]>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    const applied = new Map(history.map((row) => [String(row.version), String(row.checksum)]));
    for (const version of applied.keys()) {
      if (!files.includes(version)) throw new Error(`Applied migration file is missing: ${version}`);
    }

    const migrations = files.map(file => {
      const sql = readFileSync(resolve(migrationDirectory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      return { file, sql, checksum };
    });
    // Validate the whole history before executing any pending DDL.
    let pendingSeen = false;
    for (const { file, checksum } of migrations) {
      const previousChecksum = applied.get(file);
      if (previousChecksum !== undefined) {
        if (pendingSeen) throw new Error(`Migration history is out of order at ${file}`);
        if (previousChecksum !== checksum) throw new Error(`Applied migration was changed: ${file}`);
        continue;
      }
      pendingSeen = true;
    }
    for (const { file, sql, checksum } of migrations) {
      if (applied.has(file)) continue;
      console.info(`Applying ${file}`);
      await connection.query(sql);
      await connection.execute(
        "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
        [file, checksum],
      );
      console.info(`Applied ${file}`);
    }
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('skdora_schema_migrations')");
    await connection.end();
  }
}

migrate().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
