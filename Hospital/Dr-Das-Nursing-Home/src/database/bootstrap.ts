import { readFileSync } from "node:fs";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { loadConfiguration } from "../config/config.js";
import { hashPassword } from "../security/password.js";
import { createDatabasePool, verifySecuritySchema } from "./pool.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required for bootstrap`);
  return value;
}

async function seedDemoCatalog(connection: PoolConnection, hospitalId: number): Promise<void> {
  const departments: Array<[string, string]> = [
    ["Gynaecology", "gynaecology"], ["Paediatrics", "paediatrics"], ["Dermatology", "dermatology"],
    ["Neurology & Neurosurgery", "neurology-neurosurgery"],
    ["General & Laparoscopic Surgery", "general-laparoscopic-surgery"],
    ["Diagnostics & Laboratory", "diagnostics-laboratory"],
  ];
  for (const [name, slug] of departments) {
    await connection.execute("INSERT IGNORE INTO departments (hospital_id, name, slug, is_published) VALUES (?, ?, ?, TRUE)", [hospitalId, name, slug]);
  }
  const doctors: Array<[string, string, string, string]> = [
    ["Dr. Sudip Chandra Saha", "dr-sudip-chandra-saha", "Gynaecologist", "MBBS, DGO, MD (Cal.)"],
    ["Dr. Chandan Shamsul", "dr-chandan-shamsul", "Gynaecologist", "MBBS (Cal.), DNB (Pondicherry), MNAMS"],
    ["Dr. Anuradha Malik", "dr-anuradha-malik", "Gynaecologist", "MBBS (Gold Medalist), MS (Obst. & Gynae.), FMAS, Diploma in Laparoscopy (Germany)"],
    ["Dr. Sanjay Kumar Patra", "dr-sanjay-kumar-patra", "Gynaecologist", "MBBS (Cal.), MS (Obst. & Gynae.)"],
    ["Dr. Sudip Bhattacharya", "dr-sudip-bhattacharya", "Gynaecologist", "MBBS (Cal.), DNB, DGO"],
    ["Dr. Shweta Ghosh", "dr-shweta-ghosh", "Gynaecologist", "MBBS, MS (Obst. & Gynae.)"],
    ["Dr. Sudipa Mondal", "dr-sudipa-mondal", "Gynaecologist", "MBBS, MS (Obst. & Gynae.)"],
    ["Dr. Chinmoy Haldar", "dr-chinmoy-haldar", "Dermatologist", "MBBS, MD (Derma) (Cal.)"],
    ["Dr. Tathagata Dutta", "dr-tathagata-dutta", "Neurologist / Neurosurgeon", "MBBS, DNB (General Surgery), MRCS Glasgow (United Kingdom)"],
    ["Dr. Pronendu Pal", "dr-pronendu-pal", "General & Laparoscopic Surgeon", "MBBS, MS (General Surgery), FMAS"],
  ];
  for (const [displayName, slug, specialty, qualifications] of doctors) {
    await connection.execute(`INSERT IGNORE INTO doctors (hospital_id, display_name, slug, specialty, qualifications, is_active, is_published) VALUES (?, ?, ?, ?, ?, TRUE, TRUE)`, [hospitalId, displayName, slug, specialty, qualifications]);
  }
  const links: Record<string, string[]> = {
    gynaecology: ["dr-sudip-chandra-saha", "dr-chandan-shamsul", "dr-anuradha-malik", "dr-sanjay-kumar-patra", "dr-sudip-bhattacharya", "dr-shweta-ghosh", "dr-sudipa-mondal"],
    dermatology: ["dr-chinmoy-haldar"], "neurology-neurosurgery": ["dr-tathagata-dutta"], "general-laparoscopic-surgery": ["dr-pronendu-pal"],
  };
  for (const [departmentSlug, doctorSlugs] of Object.entries(links)) {
    const [departmentRows] = await connection.execute<RowDataPacket[]>("SELECT id FROM departments WHERE hospital_id = ? AND slug = ?", [hospitalId, departmentSlug]);
    for (const doctorSlug of doctorSlugs) {
      const [doctorRows] = await connection.execute<RowDataPacket[]>("SELECT id FROM doctors WHERE hospital_id = ? AND slug = ?", [hospitalId, doctorSlug]);
      if (departmentRows[0] && doctorRows[0]) await connection.execute("INSERT IGNORE INTO doctor_departments (hospital_id, doctor_id, department_id) VALUES (?, ?, ?)", [hospitalId, doctorRows[0].id, departmentRows[0].id]);
    }
  }
  const diagnostics: Array<[string, string, string, string]> = [["ECG", "ecg", "Cardiology diagnostics", "Electrocardiogram test."], ["USG / Ultrasound", "usg-ultrasound", "Imaging", "Ultrasonography services."], ["CT Scan", "ct-scan", "Imaging", "Computed tomography imaging."], ["MRI", "mri", "Imaging", "Magnetic resonance imaging."], ["Blood Tests", "blood-tests", "Laboratory", "Routine and diagnostic blood investigations."]];
  for (const [name, slug, category, description] of diagnostics) await connection.execute(`INSERT IGNORE INTO diagnostic_services (hospital_id, name, slug, category, description, price_note, is_published) VALUES (?, ?, ?, ?, ?, 'Contact the centre', TRUE)`, [hospitalId, name, slug, category, description]);
}

async function bootstrap(): Promise<void> {
  const configuration = loadConfiguration();
  const email = required("BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase();
  const adminName = required("BOOTSTRAP_ADMIN_NAME").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || adminName.length > 150) {
    throw new Error("Bootstrap admin email or display name is invalid");
  }
  const password = readFileSync(required("BOOTSTRAP_PASSWORD_FILE"), "utf8").replace(/\r?\n$/, "");
  const passwordHash = await hashPassword(password);
  const pool = createDatabasePool();
  try {
    await verifySecuritySchema(pool);
    const connection = await pool.getConnection();
    let locked = false;
    try {
      const [lockRows] = await connection.query<RowDataPacket[]>(
        "SELECT GET_LOCK('skdora_bootstrap', 30) AS acquired",
      );
      if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire bootstrap lock");
      locked = true;
      await connection.beginTransaction();
      const [existing] = await connection.query<RowDataPacket[]>("SELECT id FROM hospitals LIMIT 1");
      if (existing.length > 0) throw new Error("A hospital already exists; bootstrap is single-use");

      const [organization] = await connection.execute<ResultSetHeader>(
        "INSERT INTO organizations (name) VALUES (?)", [configuration.hospital.displayName],
      );
      const [hospital] = await connection.execute<ResultSetHeader>(
        "INSERT INTO hospitals (organization_id, display_name, timezone) VALUES (?, ?, ?)",
        [organization.insertId, configuration.hospital.displayName,
          configuration.features.operations.hospitalTimezone],
      );
      const [user] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (hospital_id, email, display_name, password_hash)
         VALUES (?, ?, ?, ?)`,
        [hospital.insertId, email, adminName, passwordHash],
      );
      const [role] = await connection.execute<ResultSetHeader>(
        "INSERT INTO roles (hospital_id, code, label) VALUES (?, 'admin', 'Administrator')",
        [hospital.insertId],
      );
      await connection.execute(
        "INSERT INTO user_roles (hospital_id, user_id, role_id) VALUES (?, ?, ?)",
        [hospital.insertId, user.insertId, role.insertId],
      );
      await connection.execute(
        `INSERT INTO role_permissions (hospital_id, role_id, permission_code)
         SELECT ?, ?, code FROM permissions`,
        [hospital.insertId, role.insertId],
      );
      await connection.execute(
        `INSERT INTO audit_events
           (hospital_id, actor_user_id, action_code, entity_type, entity_id)
         VALUES (?, ?, 'security.bootstrap', 'hospital', ?)`,
        [hospital.insertId, user.insertId, hospital.insertId],
      );
      await seedDemoCatalog(connection, hospital.insertId);
      await connection.commit();
      console.info("Initial hospital and administrator created");
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (locked) await connection.query("SELECT RELEASE_LOCK('skdora_bootstrap')");
      connection.release();
    }
  } finally {
    await pool.end();
  }
}

bootstrap().catch((error: unknown) => {
  console.error("Bootstrap failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
