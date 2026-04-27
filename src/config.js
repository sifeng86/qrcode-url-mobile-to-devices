const path = require('path');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBasePath(input = '') {
  const trimmed = String(input || '').trim();

  if (!trimmed || trimmed === '/') {
    return '';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function normalizePublicBaseUrl(input = '') {
  return String(input || '').trim().replace(/\/+$/g, '');
}

function withBasePath(configOrBasePath, pathname = '/') {
  const basePath = typeof configOrBasePath === 'string'
    ? normalizeBasePath(configOrBasePath)
    : configOrBasePath.basePath;

  if (!pathname || pathname === '/') {
    return basePath ? `${basePath}/` : '/';
  }

  const cleanPath = `/${String(pathname).replace(/^\/+/, '')}`;
  return basePath ? `${basePath}${cleanPath}` : cleanPath;
}

function getHeaderValue(headers, key) {
  const rawValue = headers ? headers[key] : undefined;
  return Array.isArray(rawValue) ? rawValue[0] : rawValue;
}

function resolveRequestOrigin(requestLike = {}) {
  const headers = requestLike.headers || {};
  const forwardedProto = getHeaderValue(headers, 'x-forwarded-proto');
  const forwardedHost = getHeaderValue(headers, 'x-forwarded-host');
  const host = forwardedHost || getHeaderValue(headers, 'host') || 'localhost';
  const protocol = forwardedProto
    || requestLike.protocol
    || (requestLike.socket && requestLike.socket.encrypted ? 'https' : 'http');

  return `${protocol}://${host}`;
}

function resolvePublicOrigin(config, requestLike) {
  return config.publicBaseUrl || resolveRequestOrigin(requestLike);
}

function resolvePublicAppUrl(config, requestLike) {
  return `${resolvePublicOrigin(config, requestLike)}${config.basePath}`;
}

function createConfig(env = process.env) {
  const basePath = normalizeBasePath(env.BASE_PATH || '');
  const environment = env.NODE_ENV || 'development';

  return {
    environment,
    isProduction: environment === 'production',
    rootDir: path.resolve(__dirname, '..'),
    appPort: parsePositiveInteger(env.APP_PORT || env.PORT, 8080),
    basePath,
    publicBaseUrl: normalizePublicBaseUrl(env.PUBLIC_BASE_URL || ''),
    socketPath: withBasePath(basePath, '/socket.io'),
    sessionTtlMinutes: parsePositiveInteger(env.SESSION_TTL_MINUTES, 20),
    cleanupIntervalMs: parsePositiveInteger(env.CLEANUP_INTERVAL_MS, 300000),
    dbConnectRetries: parsePositiveInteger(env.DB_CONNECT_RETRIES, 20),
    dbConnectRetryMs: parsePositiveInteger(env.DB_CONNECT_RETRY_MS, 3000),
    database: {
      host: env.DB_HOST || 'db',
      port: parsePositiveInteger(env.DB_PORT, 3306),
      user: env.DB_USER || 'qrcode',
      password: env.DB_PASSWORD || 'qrcode_password',
      name: env.DB_NAME || 'qrcode_relay',
      tableName: env.DB_TABLE || 'relay_sessions'
    }
  };
}

module.exports = {
  createConfig,
  normalizeBasePath,
  normalizePublicBaseUrl,
  resolvePublicAppUrl,
  resolvePublicOrigin,
  resolveRequestOrigin,
  withBasePath
};