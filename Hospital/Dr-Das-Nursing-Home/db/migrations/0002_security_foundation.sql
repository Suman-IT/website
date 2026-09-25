-- Staff sessions, shared login throttling and doctor account ownership.
CREATE TABLE staff_sessions (
  token_hash BINARY(32) NOT NULL,
  hospital_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at_utc DATETIME(6) NOT NULL,
  revoked_at_utc DATETIME(6) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_staff_sessions_user (hospital_id, user_id, expires_at_utc),
  KEY ix_staff_sessions_expiry (expires_at_utc),
  CONSTRAINT fk_staff_sessions_user FOREIGN KEY (hospital_id, user_id) REFERENCES users (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_staff_sessions_expiry CHECK (expires_at_utc > created_at_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE login_attempts (
  subject_hash BINARY(32) NOT NULL,
  window_started_at_utc DATETIME(6) NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL,
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (subject_hash, window_started_at_utc),
  KEY ix_login_attempts_updated (updated_at_utc),
  CONSTRAINT ck_login_attempts_positive CHECK (attempts > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE doctor_user_links (
  hospital_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (hospital_id, doctor_id),
  UNIQUE KEY uq_doctor_user_links_user (hospital_id, user_id),
  CONSTRAINT fk_doctor_user_links_doctor FOREIGN KEY (hospital_id, doctor_id) REFERENCES doctors (hospital_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_doctor_user_links_user FOREIGN KEY (hospital_id, user_id) REFERENCES users (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, description) VALUES
  ('hospital.manage', 'Manage hospital configuration'),
  ('department.read', 'Read departments'),
  ('department.manage', 'Manage departments'),
  ('appointment.read', 'Read hospital appointments'),
  ('appointment.read.own', 'Read linked doctor appointments'),
  ('appointment.create', 'Create appointments'),
  ('appointment.update', 'Update appointments'),
  ('appointment.cancel', 'Cancel appointments'),
  ('patient.read', 'Read patients'),
  ('patient.create', 'Create patients'),
  ('patient.update', 'Update patients'),
  ('doctor.read', 'Read doctors'),
  ('doctor.manage', 'Manage doctors'),
  ('schedule.read', 'Read schedules'),
  ('schedule.manage', 'Manage schedules'),
  ('user.manage', 'Manage staff access'),
  ('audit.read', 'Read hospital audit events');
