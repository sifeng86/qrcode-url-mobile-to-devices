const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeNoteText,
  normalizeShareType,
  normalizeUrl,
  validateFileMetadata,
  validateRetentionMinutes,
  validateToken,
  ValidationError
} = require('../src/validation');

test('normalizeUrl prefixes https when the scheme is missing', () => {
  assert.equal(normalizeUrl('example.com/demo'), 'https://example.com/demo');
});

test('normalizeUrl rejects unsupported protocols', () => {
  assert.throws(() => normalizeUrl('javascript:alert(1)'), ValidationError);
});

test('normalizeShareType accepts supported share types', () => {
  assert.equal(normalizeShareType('file'), 'file');
  assert.equal(normalizeShareType('note'), 'note');
});

test('normalizeNoteText requires non-empty content', () => {
  assert.throws(() => normalizeNoteText('   '), ValidationError);
  assert.equal(normalizeNoteText('Projector input is HDMI 2'), 'Projector input is HDMI 2');
});

test('validateRetentionMinutes uses defaults and enforces range', () => {
  const storageConfig = {
    defaultRetentionMinutes: 60,
    minRetentionMinutes: 5,
    maxRetentionMinutes: 240
  };

  assert.equal(validateRetentionMinutes(undefined, storageConfig), 60);
  assert.equal(validateRetentionMinutes('15', storageConfig), 15);
  assert.throws(() => validateRetentionMinutes('1', storageConfig), ValidationError);
});

test('validateFileMetadata rejects files larger than the configured limit', () => {
  assert.throws(() => validateFileMetadata({
    fileName: 'archive.zip',
    fileSize: 11,
    contentType: 'application/zip'
  }, {
    maxFileBytes: 10
  }), ValidationError);
});

test('validateToken accepts url-safe session tokens', () => {
  assert.equal(validateToken('Wj0ZfWgOYYMt1qVgLr-123_4'), 'Wj0ZfWgOYYMt1qVgLr-123_4');
});