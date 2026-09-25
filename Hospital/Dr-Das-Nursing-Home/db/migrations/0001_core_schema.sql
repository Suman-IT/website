-- MySQL 8.4 / InnoDB. Apply once through src/database/migrate.ts.
-- DDL can commit independently. Do not rerun this file after partial failure.

CREATE TABLE organizations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE hospitals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospitals_org_id (organization_id, id),
  CONSTRAINT fk_hospitals_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  CONSTRAINT ck_hospitals_name CHECK (CHAR_LENGTH(TRIM(display_name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_hospital_id (hospital_id, id),
  UNIQUE KEY uq_users_hospital_email (hospital_id, email),
  CONSTRAINT fk_users_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT,
  CONSTRAINT ck_users_email CHECK (CHAR_LENGTH(TRIM(email)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL,
  label VARCHAR(100) NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_hospital_id (hospital_id, id),
  UNIQUE KEY uq_roles_hospital_code (hospital_id, code),
  CONSTRAINT fk_roles_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permissions (
  code VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_roles (
  hospital_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (hospital_id, user_id, role_id),
  KEY ix_user_roles_role (hospital_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (hospital_id, user_id) REFERENCES users (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (hospital_id, role_id) REFERENCES roles (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
  hospital_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  permission_code VARCHAR(100) NOT NULL,
  PRIMARY KEY (hospital_id, role_id, permission_code),
  KEY ix_role_permissions_permission (permission_code),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (hospital_id, role_id) REFERENCES roles (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_code) REFERENCES permissions (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_departments_hospital_id (hospital_id, id),
  UNIQUE KEY uq_departments_hospital_slug (hospital_id, slug),
  CONSTRAINT fk_departments_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE doctors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_doctors_hospital_id (hospital_id, id),
  UNIQUE KEY uq_doctors_hospital_slug (hospital_id, slug),
  KEY ix_doctors_hospital_status (hospital_id, is_active, is_published),
  CONSTRAINT fk_doctors_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE doctor_departments (
  hospital_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (hospital_id, doctor_id, department_id),
  KEY ix_doctor_departments_department (hospital_id, department_id),
  CONSTRAINT fk_doctor_departments_doctor FOREIGN KEY (hospital_id, doctor_id) REFERENCES doctors (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_doctor_departments_department FOREIGN KEY (hospital_id, department_id) REFERENCES departments (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE doctor_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  start_local TIME NOT NULL,
  end_local TIME NOT NULL,
  booking_mode ENUM('SERIAL', 'EXCLUSIVE') NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL,
  slot_minutes SMALLINT UNSIGNED NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_schedules_hospital_id (hospital_id, id),
  UNIQUE KEY uq_schedules_hospital_id_doctor (hospital_id, id, doctor_id),
  KEY ix_schedules_doctor_day (hospital_id, doctor_id, day_of_week, is_active),
  CONSTRAINT fk_schedules_doctor FOREIGN KEY (hospital_id, doctor_id) REFERENCES doctors (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_schedules_day CHECK (day_of_week <= 6),
  CONSTRAINT ck_schedules_time CHECK (start_local < end_local),
  CONSTRAINT ck_schedules_capacity CHECK (capacity > 0 AND slot_minutes > 0),
  CONSTRAINT ck_schedules_dates CHECK (valid_until IS NULL OR valid_until >= valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE schedule_overrides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  schedule_id BIGINT UNSIGNED NOT NULL,
  service_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL,
  start_local TIME NULL,
  end_local TIME NULL,
  capacity SMALLINT UNSIGNED NULL,
  slot_minutes SMALLINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_overrides_schedule_date (hospital_id, schedule_id, service_date),
  CONSTRAINT fk_overrides_schedule FOREIGN KEY (hospital_id, schedule_id) REFERENCES doctor_schedules (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_overrides_time CHECK (start_local IS NULL OR end_local IS NULL OR start_local < end_local),
  CONSTRAINT ck_overrides_capacity CHECK ((capacity IS NULL OR capacity > 0) AND (slot_minutes IS NULL OR slot_minutes > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE patients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  mobile_normalized VARCHAR(16) NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_patients_hospital_id (hospital_id, id),
  KEY ix_patients_mobile (hospital_id, mobile_normalized),
  KEY ix_patients_name (hospital_id, full_name),
  CONSTRAINT fk_patients_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT,
  CONSTRAINT ck_patients_name CHECK (CHAR_LENGTH(TRIM(full_name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE appointment_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  schedule_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  service_date DATE NOT NULL,
  starts_at_utc DATETIME(6) NOT NULL,
  ends_at_utc DATETIME(6) NOT NULL,
  booking_mode ENUM('SERIAL', 'EXCLUSIVE') NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL,
  reserved_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  next_serial INT UNSIGNED NOT NULL DEFAULT 1,
  slot_minutes SMALLINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_hospital_id (hospital_id, id),
  UNIQUE KEY uq_sessions_hospital_id_doctor (hospital_id, id, doctor_id),
  UNIQUE KEY uq_sessions_schedule_date (hospital_id, schedule_id, service_date),
  KEY ix_sessions_doctor_date (hospital_id, doctor_id, service_date),
  CONSTRAINT fk_sessions_schedule FOREIGN KEY (hospital_id, schedule_id, doctor_id) REFERENCES doctor_schedules (hospital_id, id, doctor_id) ON DELETE RESTRICT,
  CONSTRAINT ck_sessions_time CHECK (starts_at_utc < ends_at_utc),
  CONSTRAINT ck_sessions_capacity CHECK (capacity > 0 AND reserved_count <= capacity AND next_serial > 0 AND slot_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  public_reference CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  booking_source ENUM('ONLINE', 'PHONE', 'WALK_IN', 'ADMIN') NOT NULL,
  status ENUM('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'BOOKED',
  serial_number INT UNSIGNED NOT NULL,
  slot_start_at_utc DATETIME(6) NULL,
  occupied_slot_at_utc DATETIME(6) GENERATED ALWAYS AS (CASE WHEN status = 'CANCELLED' THEN NULL ELSE slot_start_at_utc END) STORED,
  estimated_start_at_utc DATETIME(6) NULL,
  idempotency_key_hash BINARY(32) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_appointments_public_reference (public_reference),
  UNIQUE KEY uq_appointments_session_serial (hospital_id, session_id, serial_number),
  UNIQUE KEY uq_appointments_occupied_slot (hospital_id, session_id, occupied_slot_at_utc),
  UNIQUE KEY uq_appointments_idempotency (hospital_id, booking_source, idempotency_key_hash),
  KEY ix_appointments_session_status (hospital_id, session_id, status),
  KEY ix_appointments_doctor_created (hospital_id, doctor_id, created_at_utc),
  KEY ix_appointments_patient (hospital_id, patient_id),
  KEY ix_appointments_creator (hospital_id, created_by_user_id),
  CONSTRAINT fk_appointments_session FOREIGN KEY (hospital_id, session_id, doctor_id) REFERENCES appointment_sessions (hospital_id, id, doctor_id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_patient FOREIGN KEY (hospital_id, patient_id) REFERENCES patients (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_creator FOREIGN KEY (hospital_id, created_by_user_id) REFERENCES users (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_appointments_serial CHECK (serial_number > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(100) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  occurred_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_audit_hospital_time (hospital_id, occurred_at_utc),
  KEY ix_audit_entity (hospital_id, entity_type, entity_id),
  KEY ix_audit_actor (hospital_id, actor_user_id, occurred_at_utc),
  CONSTRAINT fk_audit_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT,
  CONSTRAINT fk_audit_actor FOREIGN KEY (hospital_id, actor_user_id) REFERENCES users (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
