class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;
const SHARE_TYPES = new Set(['link', 'note', 'file']);
const NOTE_MAX_LENGTH = 4000;
const FILE_NAME_MAX_LENGTH = 180;
const CONTENT_TYPE_MAX_LENGTH = 160;

function validateToken(input) {
  const token = String(input || '').trim();

  if (!TOKEN_PATTERN.test(token)) {
    throw new ValidationError('Enter a valid session token.', 'INVALID_TOKEN');
  }

  return token;
}

function normalizeUrl(input) {
  const rawValue = String(input || '').trim();

  if (!rawValue) {
    throw new ValidationError('Please enter a URL to send.', 'URL_REQUIRED');
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;

  let parsedUrl;

  try {
    parsedUrl = new URL(candidate);
  } catch (error) {
    throw new ValidationError('Enter a valid URL, for example https://example.com.', 'INVALID_URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ValidationError('Only http and https URLs are supported.', 'UNSUPPORTED_PROTOCOL');
  }

  return parsedUrl.toString();
}

function normalizeShareType(input) {
  const shareType = String(input || 'link').trim().toLowerCase();

  if (!SHARE_TYPES.has(shareType)) {
    throw new ValidationError('Select a supported share type.', 'INVALID_SHARE_TYPE');
  }

  return shareType;
}

function normalizeNoteText(input) {
  const text = String(input || '').trim();

  if (!text) {
    throw new ValidationError('Enter the note you want to share.', 'NOTE_REQUIRED');
  }

  if (text.length > NOTE_MAX_LENGTH) {
    throw new ValidationError(`Notes can be up to ${NOTE_MAX_LENGTH} characters.`, 'NOTE_TOO_LONG');
  }

  return text;
}

function validateRetentionMinutes(input, storageConfig) {
  if (input === undefined || input === null || String(input).trim() === '') {
    return storageConfig.defaultRetentionMinutes;
  }

  const retentionMinutes = Number.parseInt(String(input).trim(), 10);

  if (!Number.isFinite(retentionMinutes) || retentionMinutes <= 0) {
    throw new ValidationError('Choose a valid share lifetime.', 'INVALID_RETENTION_MINUTES');
  }

  if (
    retentionMinutes < storageConfig.minRetentionMinutes
    || retentionMinutes > storageConfig.maxRetentionMinutes
  ) {
    throw new ValidationError(
      `Share lifetime must be between ${storageConfig.minRetentionMinutes} and ${storageConfig.maxRetentionMinutes} minutes.`,
      'RETENTION_OUT_OF_RANGE'
    );
  }

  return retentionMinutes;
}

function validateShareId(input) {
  const shareId = Number.parseInt(String(input || '').trim(), 10);

  if (!Number.isSafeInteger(shareId) || shareId <= 0) {
    throw new ValidationError('Enter a valid share identifier.', 'INVALID_SHARE_ID');
  }

  return shareId;
}

function validateFileMetadata(input, storageConfig) {
  const fileName = String(input && input.fileName ? input.fileName : '').trim();
  const sanitizedFileName = fileName.replace(/[\\/]+/g, '_');
  const contentType = String(input && input.contentType ? input.contentType : 'application/octet-stream').trim();
  const fileSize = Number.parseInt(String(input && input.fileSize ? input.fileSize : ''), 10);

  if (!sanitizedFileName) {
    throw new ValidationError('Choose a file to upload.', 'FILE_NAME_REQUIRED');
  }

  if (sanitizedFileName.length > FILE_NAME_MAX_LENGTH) {
    throw new ValidationError(`File names can be up to ${FILE_NAME_MAX_LENGTH} characters.`, 'FILE_NAME_TOO_LONG');
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new ValidationError('File size must be greater than zero.', 'INVALID_FILE_SIZE');
  }

  if (fileSize > storageConfig.maxFileBytes) {
    throw new ValidationError('This file is larger than the current upload limit.', 'FILE_TOO_LARGE');
  }

  if (!contentType || contentType.length > CONTENT_TYPE_MAX_LENGTH || /[\r\n]/.test(contentType)) {
    throw new ValidationError('The file content type is invalid.', 'INVALID_CONTENT_TYPE');
  }

  return {
    fileName: sanitizedFileName,
    fileSize,
    contentType: contentType || 'application/octet-stream'
  };
}

module.exports = {
  ValidationError,
  normalizeNoteText,
  normalizeShareType,
  normalizeUrl,
  validateFileMetadata,
  validateRetentionMinutes,
  validateShareId,
  validateToken
};