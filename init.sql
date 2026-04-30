CREATE DATABASE IF NOT EXISTS qrcode_relay;

USE qrcode_relay;

CREATE TABLE IF NOT EXISTS relay_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  display_socket_id VARCHAR(128) DEFAULT NULL,
  target_url TEXT DEFAULT NULL,
  payload_type VARCHAR(32) NOT NULL DEFAULT 'link',
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

CREATE TABLE IF NOT EXISTS share_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_token VARCHAR(64) NOT NULL,
  share_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'delivered',
  payload_json LONGTEXT DEFAULT NULL,
  object_key VARCHAR(512) DEFAULT NULL,
  original_filename VARCHAR(255) DEFAULT NULL,
  content_type VARCHAR(255) DEFAULT NULL,
  file_size BIGINT UNSIGNED DEFAULT NULL,
  available_until TIMESTAMP NULL DEFAULT NULL,
  first_downloaded_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_share_items_session_token (session_token),
  INDEX idx_share_items_status (status),
  INDEX idx_share_items_available_until (available_until),
  INDEX idx_share_items_object_key (object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
