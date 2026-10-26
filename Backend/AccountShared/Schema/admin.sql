CREATE TABLE IF NOT EXISTS auth_administrators (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT fk_administrator_user FOREIGN KEY(user_id) REFERENCES auth_credentials(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_user_bans (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL, expires_at DATETIME(6) NULL,
  CONSTRAINT fk_user_ban_user FOREIGN KEY(user_id) REFERENCES auth_credentials(user_id),
  CONSTRAINT fk_user_ban_actor FOREIGN KEY(actor_user_id) REFERENCES auth_credentials(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS auth_admin_audit (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(32) CHARACTER SET ascii NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY ix_admin_audit_actor(actor_user_id,created_at),
  KEY ix_admin_audit_target(target_user_id,created_at),
  CONSTRAINT fk_admin_audit_actor FOREIGN KEY(actor_user_id) REFERENCES auth_credentials(user_id),
  CONSTRAINT fk_admin_audit_target FOREIGN KEY(target_user_id) REFERENCES auth_credentials(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
