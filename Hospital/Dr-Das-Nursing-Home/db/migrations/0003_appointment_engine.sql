-- Additive V1 booking history and retry ledger. Back up before applying DDL.
ALTER TABLE hospitals
  ADD COLUMN booking_cutoff_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_hospital_cutoff CHECK (booking_cutoff_minutes <= 10080);

ALTER TABLE appointment_sessions
  DROP CHECK ck_sessions_capacity,
  ADD COLUMN overbook_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_sessions_capacity CHECK
    (capacity > 0 AND reserved_count <= capacity + overbook_count
     AND overbook_count <= reserved_count AND next_serial > 0 AND slot_minutes > 0);

ALTER TABLE appointments
  ADD UNIQUE KEY uq_appointments_hospital_id (hospital_id, id);

ALTER TABLE appointments
  ADD COLUMN is_overbooked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN override_reason VARCHAR(250) NULL,
  ADD COLUMN repeat_reason VARCHAR(250) NULL,
  ADD COLUMN cancelled_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN cancelled_at_utc DATETIME(6) NULL,
  ADD COLUMN cancellation_reason VARCHAR(250) NULL,
  ADD COLUMN rescheduled_from_id BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY uq_appointments_rescheduled_from (hospital_id, rescheduled_from_id),
  ADD CONSTRAINT fk_appointments_canceller FOREIGN KEY (hospital_id, cancelled_by_user_id)
    REFERENCES users (hospital_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_appointments_rescheduled_from FOREIGN KEY (hospital_id, rescheduled_from_id)
    REFERENCES appointments (hospital_id, id) ON DELETE RESTRICT;

CREATE TABLE operation_requests (
  hospital_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  operation VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_hash BINARY(32) NOT NULL,
  request_hash BINARY(32) NOT NULL,
  result_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (hospital_id, actor_user_id, operation, key_hash),
  CONSTRAINT fk_requests_actor FOREIGN KEY (hospital_id, actor_user_id)
    REFERENCES users (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE public_booking_requests (
  hospital_id BIGINT UNSIGNED NOT NULL,
  idempotency_key_hash BINARY(32) NOT NULL,
  request_hash BINARY(32) NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (hospital_id, idempotency_key_hash),
  CONSTRAINT fk_public_booking_appointment FOREIGN KEY (hospital_id, appointment_id)
    REFERENCES appointments (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Durable application events contain identifiers only; no provider coupling or PHI.
CREATE TABLE appointment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  hospital_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  occurred_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_appointment_events_hospital (hospital_id, id),
  CONSTRAINT fk_events_appointment FOREIGN KEY (hospital_id, appointment_id)
    REFERENCES appointments (hospital_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, description) VALUES
  ('appointment.overbook', 'Exceed serial sitting capacity with a recorded reason'),
  ('appointment.repeat', 'Approve a repeat appointment with the same doctor and date');
-- Existing installations must grant these explicitly; bootstrap grants all to admin.
