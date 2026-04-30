const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createConfig,
  normalizeBasePath,
  resolvePublicOrigin,
  withBasePath
} = require('../src/config');

test('normalizeBasePath strips extra slashes', () => {
  assert.equal(normalizeBasePath('///sent-url///'), '/sent-url');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath(''), '');
});

test('withBasePath composes application routes', () => {
  const config = createConfig({ BASE_PATH: '/portfolio' });
  assert.equal(withBasePath(config, '/'), '/portfolio/');
  assert.equal(withBasePath(config, '/connect'), '/portfolio/connect');
});

test('resolvePublicOrigin prefers the configured public base URL', () => {
  const config = createConfig({ PUBLIC_BASE_URL: 'https://demo.example.com' });
  const requestLike = {
    headers: {
      host: 'localhost:8080'
    }
  };

  assert.equal(resolvePublicOrigin(config, requestLike), 'https://demo.example.com');
});

test('createConfig disables file storage by default and exposes retention defaults', () => {
  const config = createConfig({});

  assert.equal(config.storage.enabled, false);
  assert.equal(config.storage.defaultRetentionMinutes, 60);
  assert.equal(config.database.shareTableName, 'share_items');
  assert.ok(config.storage.retentionOptions.includes(60));
});

test('createConfig enables R2 storage when credentials are present', () => {
  const config = createConfig({
    FILE_STORAGE_DRIVER: 'r2',
    R2_ACCOUNT_ID: 'account-id',
    R2_BUCKET_NAME: 'sendline-temp',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key'
  });

  assert.equal(config.storage.enabled, true);
  assert.equal(config.storage.driver, 'r2');
});