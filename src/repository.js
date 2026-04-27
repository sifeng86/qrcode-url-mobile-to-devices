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

function createSessionRepository(databaseConfig) {
  const tableIdentifier = mysql.escapeId(databaseConfig.tableName);
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
      CREATE TABLE IF NOT EXISTS ${tableIdentifier} (
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
        INDEX idx_token (token),
        INDEX idx_display_socket_id (display_socket_id),
        INDEX idx_status (status),
        INDEX idx_expires_at (expires_at)
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
            INSERT INTO ${tableIdentifier} (
              token,
              display_socket_id,
              payload_type,
              status,
              expires_at
            ) VALUES (?, ?, 'url', 'pending', ?)
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
        FROM ${tableIdentifier}
        WHERE token = ?
        LIMIT 1
      `,
      [token]
    );

    return mapSession(rows[0]);
  }

  async function invalidateSession(token) {
    await pool.execute(
      `
        UPDATE ${tableIdentifier}
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
        UPDATE ${tableIdentifier}
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
        UPDATE ${tableIdentifier}
        SET status = 'expired'
        WHERE token = ?
      `,
      [token]
    );
  }

  async function saveUrlDelivery(token, normalizedUrl) {
    await pool.execute(
      `
        UPDATE ${tableIdentifier}
        SET
          target_url = ?,
          payload_type = 'url',
          payload_json = ?,
          status = 'delivered',
          delivered_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `,
      [normalizedUrl, JSON.stringify({ url: normalizedUrl }), token]
    );

    return getSessionByToken(token);
  }

  async function cleanupExpiredSessions() {
    const [result] = await pool.execute(
      `
        DELETE FROM ${tableIdentifier}
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
    getSessionByToken,
    initialize,
    invalidateSession,
    markDisplayDisconnected,
    markExpired,
    ping,
    saveUrlDelivery
  };
}

module.exports = {
  createSessionRepository
};