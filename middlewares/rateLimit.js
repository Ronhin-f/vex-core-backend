const rateLimit = require('express-rate-limit');

function defaultKeyGenerator(req) {
  return req.ip || 'unknown';
}

function emailKeyGenerator(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${req.ip || 'unknown'}|${email}`;
}

function createRateLimiter({
  windowMs,
  max,
  message,
  keyGenerator = defaultKeyGenerator,
  skip,
  standardHeaders = true,
  legacyHeaders = false,
}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders,
    legacyHeaders,
    keyGenerator,
    skip,
    handler: (req, res, _next, options) => {
      const reset = req.rateLimit?.resetTime?.getTime?.() || null;
      if (reset) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
      }
      res
        .status(options.statusCode || 429)
        .json(message || { ok: false, error: 'Demasiadas solicitudes', code: 'rate_limit' });
    },
  });
}

function createSlowDown({
  windowMs = 15 * 60 * 1000,
  delayAfter = 5,
  delayMs = 250,
  keyGenerator = defaultKeyGenerator,
  maxDelayMs = 2000,
}) {
  const hits = new Map();

  return (req, _res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;
    const over = entry.count - delayAfter;
    if (over <= 0) return next();

    const delay = Math.min(over * delayMs, maxDelayMs);
    return setTimeout(next, delay);
  };
}

module.exports = {
  createRateLimiter,
  createSlowDown,
  defaultKeyGenerator,
  emailKeyGenerator,
};
