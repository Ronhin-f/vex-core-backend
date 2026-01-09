const REDACTED = '[REDACTED]';

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_BODY_KEYS = [
  'password',
  'new_password',
  'old_password',
  'token',
  'reset_token',
  'confirm_token',
  'access_token',
  'refresh_token',
  'secret',
  'jwt',
];

function isSensitiveKey(key) {
  const k = String(key || '').toLowerCase();
  return SENSITIVE_BODY_KEYS.some((needle) => k === needle || k.includes(needle));
}

function sanitizeHeaders(headers = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_HEADER_KEYS.has(lower)) {
      safe[key] = REDACTED;
      continue;
    }
    if (typeof value === 'string' && lower === 'authorization' && value.startsWith('Bearer ')) {
      safe[key] = 'Bearer ' + REDACTED;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

function sanitizeBody(body, depth = 0) {
  if (!body || depth > 4) return body;
  if (Array.isArray(body)) return body.map((item) => sanitizeBody(item, depth + 1));
  if (typeof body !== 'object') return body;

  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    if (isSensitiveKey(key)) {
      safe[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      safe[key] = sanitizeBody(value, depth + 1);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

module.exports = {
  sanitizeHeaders,
  sanitizeBody,
};
