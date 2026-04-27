CREATE DATABASE IF NOT EXISTS qrcode_relay;

USE qrcode_relay;

CREATE TABLE IF NOT EXISTS relay_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  display_socket_id VARCHAR(128) DEFAULT NULL,
  target_url TEXT DEFAULT NULL,
  payload_type VARCHAR(32) NOT NULL DEFAULT 'url',
  payload_json LONGTEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NULL DEFAULT NULL,
  delivered_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_relay_sessions_token (token),
  INDEX idx_relay_sessions_socket_id (display_socket_id),
  INDEX idx_relay_sessions_status (status),
  INDEX idx_relay_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
