-- Public diagnostic and laboratory service catalogue.
CREATE TABLE diagnostic_services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Diagnostic services',
  description VARCHAR(500) NULL,
  price DECIMAL(10,2) NULL,
  price_note VARCHAR(120) NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_diagnostic_services_hospital_id (hospital_id, id),
  UNIQUE KEY uq_diagnostic_services_hospital_slug (hospital_id, slug),
  KEY ix_diagnostic_services_public (hospital_id, is_published, category, name),
  CONSTRAINT fk_diagnostic_services_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT,
  CONSTRAINT ck_diagnostic_services_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT ck_diagnostic_services_category CHECK (CHAR_LENGTH(TRIM(category)) > 0),
  CONSTRAINT ck_diagnostic_services_price CHECK (price IS NULL OR price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO permissions (code, description) VALUES
  ('diagnostic.read', 'Read diagnostic services'),
  ('diagnostic.manage', 'Manage diagnostic services');

INSERT INTO role_permissions (hospital_id, role_id, permission_code)
SELECT r.hospital_id, r.id, p.code
FROM roles r
JOIN permissions p ON p.code IN ('diagnostic.read', 'diagnostic.manage')
WHERE r.code = 'admin';
