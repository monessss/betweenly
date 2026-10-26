CREATE TABLE IF NOT EXISTS auth_email_challenges (
  challenge_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
  purpose VARCHAR(16) CHARACTER SET ascii NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  delivery_state VARCHAR(16) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(6) NOT NULL, expires_at DATETIME(6) NOT NULL,
  resend_after DATETIME(6) NOT NULL, consumed_at DATETIME(6) NULL,
  UNIQUE KEY uq_email_challenge_scope(email,purpose),
  KEY ix_email_challenge_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_verified_emails (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
  verified_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_verified_email_user FOREIGN KEY(user_id) REFERENCES auth_credentials(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
