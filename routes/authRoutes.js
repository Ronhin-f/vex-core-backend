const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const {
  createRateLimiter,
  createSlowDown,
  emailKeyGenerator,
  defaultKeyGenerator,
} = require('../middlewares/rateLimit');

const LOGIN_DEBUG = process.env.LOGIN_DEBUG === '1' || process.env.AUTH_DEBUG === '1';

// Log basico (no loguea passwords)
const logLogin = (req, _res, next) => {
  try {
    if (LOGIN_DEBUG) {
      const email = String(req.body?.email || '').toLowerCase();
      console.log('[LOGIN_DEBUG] >> /auth/login email:', email);
    }
  } catch {}
  next();
};

const rateLimitMessage = (msg) => ({
  ok: false,
  error: msg || 'Demasiados intentos, proba mas tarde',
  code: 'rate_limit',
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyGenerator: emailKeyGenerator,
  message: rateLimitMessage('Demasiados intentos, proba mas tarde'),
});

const loginSlowDown = createSlowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 4,
  delayMs: 400,
  keyGenerator: emailKeyGenerator,
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: defaultKeyGenerator,
  message: rateLimitMessage('Demasiados registros, proba mas tarde'),
});

const changePassLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  keyGenerator: defaultKeyGenerator,
  message: rateLimitMessage('Demasiados intentos, proba mas tarde'),
});

const resetRequestLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 5,
  keyGenerator: emailKeyGenerator,
  message: rateLimitMessage('Demasiadas solicitudes, proba mas tarde'),
});

const resetConfirmLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000,
  max: 10,
  keyGenerator: emailKeyGenerator,
  message: rateLimitMessage('Demasiados intentos, proba mas tarde'),
});

router.post('/login', loginSlowDown, loginLimiter, logLogin, authController.login);
router.post('/register', registerLimiter, authController.register);
router.post('/change-password', changePassLimiter, authController.requireAuth, authController.changePassword);
router.post('/password-reset/request', resetRequestLimiter, authController.requestPasswordReset);
router.post('/password-reset/confirm', resetConfirmLimiter, authController.confirmPasswordReset);

// Diagnostico de sesion
router.get('/me', authController.requireAuth, authController.me);

// Introspeccion de token (para Flows/servicios internos)
router.get('/introspect', authController.introspect);

module.exports = router;
