CREATE TABLE IF NOT EXISTS user_profiles (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  normalized_username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(64) NOT NULL, bio VARCHAR(500) NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY uq_user_username(normalized_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
