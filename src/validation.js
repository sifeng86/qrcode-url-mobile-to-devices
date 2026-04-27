class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

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

module.exports = {
  ValidationError,
  normalizeUrl,
  validateToken
};