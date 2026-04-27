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