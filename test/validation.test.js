const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUrl, validateToken, ValidationError } = require('../src/validation');

test('normalizeUrl prefixes https when the scheme is missing', () => {
  assert.equal(normalizeUrl('example.com/demo'), 'https://example.com/demo');
});

test('normalizeUrl rejects unsupported protocols', () => {
  assert.throws(() => normalizeUrl('javascript:alert(1)'), ValidationError);
});

test('validateToken accepts url-safe session tokens', () => {
  assert.equal(validateToken('Wj0ZfWgOYYMt1qVgLr-123_4'), 'Wj0ZfWgOYYMt1qVgLr-123_4');
});