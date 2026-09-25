CREATE USER IF NOT EXISTS 'recovery'@'%' IDENTIFIED BY 'recovery-source';
GRANT ALL PRIVILEGES ON recovery_source.* TO 'recovery'@'%';
CREATE TABLE recovery_source.recovery_sentinel (
  id INT NOT NULL PRIMARY KEY,
  marker VARCHAR(100) NOT NULL,
  created_at_utc DATETIME(6) NOT NULL
);
INSERT INTO recovery_source.recovery_sentinel VALUES (1, 'isolated-recovery-drill', UTC_TIMESTAMP(6));
