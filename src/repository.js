const crypto = require('crypto');
const mysql = require('mysql2/promise');

function generateToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function parsePayloadJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function mapSession(row) {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    displaySocketId: row.displaySocketId,
    targetUrl: row.targetUrl,
    payloadType: row.payloadType,
    payloadJson: parsePayloadJson(row.payloadJson),
    status: row.status,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    deliveredAt: row.deliveredAt ? new Date(row.deliveredAt) : null,
    createdAt: row.createdAt ? new Date(row.createdAt) : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null
  };
}

function mapShareItem(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    sessionToken: row.sessionToken,
    shareType: row.shareType,
    status: row.status,
    payloadJson: parsePayloadJson(row.payloadJson),
    objectKey: row.objectKey,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSize: row.fileSize === null || row.fileSize === undefined ? null : Number(row.fileSize),
    availableUntil: row.availableUntil ? new Date(row.availableUntil) : null,
    firstDownloadedAt: row.firstDownloadedAt ? new Date(row.firstDownloadedAt) : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    createdAt: row.createdAt ? new Date(row.createdAt) : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null
  };
}

function serializePayload(payloadJson) {
  return payloadJson ? JSON.stringify(payloadJson) : null;
}

function createSessionRepository(databaseConfig) {
  const sessionTableIdentifier = mysql.escapeId(databaseConfig.tableName);
  const shareTableIdentifier = mysql.escapeId(databaseConfig.shareTableName || 'share_items');
  const pool = mysql.createPool({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    database: databaseConfig.name,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  async function initialize() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${sessionTableIdentifier} (
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
        INDEX idx_token (token),
        INDEX idx_display_socket_id (display_socket_id),
        INDEX idx_status (status),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${shareTableIdentifier} (
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
        INDEX idx_session_token (session_token),
        INDEX idx_share_status (status),
        INDEX idx_share_available_until (available_until),
        INDEX idx_share_object_key (object_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async function ping() {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      return { ok: true, database: 'up' };
    } catch (error) {
      return { ok: false, database: 'down', error };
    }
  }

  async function createSession({ displaySocketId, ttlMinutes }) {
    const expiresAt = new Date(Date.now() + (ttlMinutes * 60 * 1000));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = generateToken();

      try {
        await pool.execute(
          `
            INSERT INTO ${sessionTableIdentifier} (
              token,
              display_socket_id,
              payload_type,
              status,
              expires_at
            ) VALUES (?, ?, 'link', 'pending', ?)
          `,
          [token, displaySocketId, expiresAt]
        );

        return { token, expiresAt };
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to generate a unique session token.');
  }

  async function getSessionByToken(token) {
    const [rows] = await pool.execute(
      `
        SELECT
          token,
          display_socket_id AS displaySocketId,
          target_url AS targetUrl,
          payload_type AS payloadType,
          payload_json AS payloadJson,
          status,
          expires_at AS expiresAt,
          delivered_at AS deliveredAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ${sessionTableIdentifier}
        WHERE token = ?
        LIMIT 1
      `,
      [token]
    );

    return mapSession(rows[0]);
  }

  async function saveSessionDelivery(token, { targetUrl = null, payloadType = 'link', payloadJson = null }) {
    await pool.execute(
      `
        UPDATE ${sessionTableIdentifier}
        SET
          target_url = ?,
          payload_type = ?,
          payload_json = ?,
          status = 'delivered',
          delivered_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `,
      [targetUrl, payloadType, serializePayload(payloadJson), token]
    );

    return getSessionByToken(token);
  }

  async function invalidateSession(token) {
    await pool.execute(
      `
        UPDATE ${sessionTableIdentifier}
        SET
          display_socket_id = NULL,
          status = 'invalidated'
        WHERE token = ?
      `,
      [token]
    );
  }

  async function markDisplayDisconnected(token) {
    await pool.execute(
      `
        UPDATE ${sessionTableIdentifier}
        SET
          display_socket_id = NULL,
          status = CASE WHEN status = 'delivered' THEN status ELSE 'display_offline' END
        WHERE token = ?
      `,
      [token]
    );
  }

  async function markExpired(token) {
    await pool.execute(
      `
        UPDATE ${sessionTableIdentifier}
        SET status = 'expired'
        WHERE token = ?
      `,
      [token]
    );
  }

  async function createShareItem({
    sessionToken,
    shareType,
    status = 'delivered',
    payloadJson = null,
    objectKey = null,
    originalFilename = null,
    contentType = null,
    fileSize = null,
    availableUntil = null
  }) {
    const [result] = await pool.execute(
      `
        INSERT INTO ${shareTableIdentifier} (
          session_token,
          share_type,
          status,
          payload_json,
          object_key,
          original_filename,
          content_type,
          file_size,
          available_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sessionToken,
        shareType,
        status,
        serializePayload(payloadJson),
        objectKey,
        originalFilename,
        contentType,
        fileSize,
        availableUntil
      ]
    );

    return getShareItemById(result.insertId);
  }

  async function getShareItemById(shareId) {
    const [rows] = await pool.execute(
      `
        SELECT
          id,
          session_token AS sessionToken,
          share_type AS shareType,
          status,
          payload_json AS payloadJson,
          object_key AS objectKey,
          original_filename AS originalFilename,
          content_type AS contentType,
          file_size AS fileSize,
          available_until AS availableUntil,
          first_downloaded_at AS firstDownloadedAt,
          deleted_at AS deletedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ${shareTableIdentifier}
        WHERE id = ?
        LIMIT 1
      `,
      [shareId]
    );

    return mapShareItem(rows[0]);
  }

  async function listSharesBySessionToken(sessionToken, limit = 20) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    const [rows] = await pool.execute(
      `
        SELECT
          id,
          session_token AS sessionToken,
          share_type AS shareType,
          status,
          payload_json AS payloadJson,
          object_key AS objectKey,
          original_filename AS originalFilename,
          content_type AS contentType,
          file_size AS fileSize,
          available_until AS availableUntil,
          first_downloaded_at AS firstDownloadedAt,
          deleted_at AS deletedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ${shareTableIdentifier}
        WHERE session_token = ?
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `,
      [sessionToken]
    );

    return rows.map(mapShareItem);
  }

  async function markShareDelivered(shareId, payloadJson = null) {
    await pool.execute(
      `
        UPDATE ${shareTableIdentifier}
        SET
          status = 'delivered',
          payload_json = COALESCE(?, payload_json)
        WHERE id = ?
      `,
      [serializePayload(payloadJson), shareId]
    );

    return getShareItemById(shareId);
  }

  async function markShareDownloaded(shareId) {
    await pool.execute(
      `
        UPDATE ${shareTableIdentifier}
        SET first_downloaded_at = COALESCE(first_downloaded_at, CURRENT_TIMESTAMP)
        WHERE id = ?
      `,
      [shareId]
    );

    return getShareItemById(shareId);
  }

  async function markShareExpired(shareId) {
    await pool.execute(
      `
        UPDATE ${shareTableIdentifier}
        SET status = 'expired'
        WHERE id = ?
      `,
      [shareId]
    );

    return getShareItemById(shareId);
  }

  async function markShareDeleted(shareId) {
    await pool.execute(
      `
        UPDATE ${shareTableIdentifier}
        SET
          status = 'deleted',
          deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
        WHERE id = ?
      `,
      [shareId]
    );

    return getShareItemById(shareId);
  }

  async function expireReadyShareItems() {
    const [result] = await pool.execute(
      `
        UPDATE ${shareTableIdentifier}
        SET status = 'expired'
        WHERE available_until IS NOT NULL
          AND available_until <= CURRENT_TIMESTAMP
          AND status IN ('pending_upload', 'delivered')
      `
    );

    return result.affectedRows || 0;
  }

  async function findExpiredFileSharesForDeletion(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const [rows] = await pool.execute(
      `
        SELECT
          id,
          session_token AS sessionToken,
          share_type AS shareType,
          status,
          payload_json AS payloadJson,
          object_key AS objectKey,
          original_filename AS originalFilename,
          content_type AS contentType,
          file_size AS fileSize,
          available_until AS availableUntil,
          first_downloaded_at AS firstDownloadedAt,
          deleted_at AS deletedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ${shareTableIdentifier}
        WHERE share_type = 'file'
          AND object_key IS NOT NULL
          AND deleted_at IS NULL
          AND status = 'expired'
        ORDER BY available_until ASC
        LIMIT ${safeLimit}
      `
    );

    return rows.map(mapShareItem);
  }

  async function cleanupExpiredSessions() {
    const [result] = await pool.execute(
      `
        DELETE FROM ${sessionTableIdentifier}
        WHERE expires_at IS NOT NULL AND expires_at < (CURRENT_TIMESTAMP - INTERVAL 1 DAY)
      `
    );

    return result.affectedRows || 0;
  }

  async function close() {
    await pool.end();
  }

  return {
    cleanupExpiredSessions,
    close,
    createSession,
    createShareItem,
    expireReadyShareItems,
    findExpiredFileSharesForDeletion,
    getSessionByToken,
    getShareItemById,
    initialize,
    invalidateSession,
    listSharesBySessionToken,
    markDisplayDisconnected,
    markExpired,
    markShareDeleted,
    markShareDelivered,
    markShareDownloaded,
    markShareExpired,
    ping,
    saveSessionDelivery
  };
}

module.exports = {
  createSessionRepository
};