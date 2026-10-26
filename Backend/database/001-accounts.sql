-- Run using a database administrator. No existing database is dropped or reset.
CREATE DATABASE IF NOT EXISTS betweenly_accounts CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
-- Create a dedicated runtime user separately and grant only this new database.
-- Apply AccountShared/Schema/auth.sql and users.sql, or enable
-- Accounts__InitializeSchema=true for the initial boot with CREATE privileges.
