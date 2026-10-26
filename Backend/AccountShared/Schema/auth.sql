CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
  username VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  normalized_username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  password_hash VARCHAR(512) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_auth_email(email), UNIQUE KEY uq_auth_username(normalized_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  access_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  refresh_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_name VARCHAR(80) NULL,
  created_at DATETIME(6) NOT NULL, access_expires_at DATETIME(6) NOT NULL,
  refresh_expires_at DATETIME(6) NOT NULL, absolute_expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  UNIQUE KEY uq_auth_access(access_hash), UNIQUE KEY uq_auth_refresh(refresh_hash),
  KEY ix_auth_sessions_user(user_id, revoked_at),
  CONSTRAINT fk_auth_session_user FOREIGN KEY(user_id) REFERENCES auth_credentials(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_refresh_history (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_auth_refresh_session FOREIGN KEY(session_id) REFERENCES auth_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_login_limits (
  bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attempts INT NOT NULL, expires_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
