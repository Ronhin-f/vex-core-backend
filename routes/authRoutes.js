const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: { ok: false, error: 'Demasiados intentos, proba mas tarde' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const changePassLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const resetRequestLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: { ok: false, error: 'Demasiadas solicitudes, proba mas tarde' },
});

const resetConfirmLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: { ok: false, error: 'Demasiados intentos, proba mas tarde' },
});

router.post('/login', loginLimiter, logLogin, authController.login);
router.post('/register', registerLimiter, authController.register);
router.post('/change-password', changePassLimiter, authController.requireAuth, authController.changePassword);
router.post('/password-reset/request', resetRequestLimiter, authController.requestPasswordReset);
router.post('/password-reset/confirm', resetConfirmLimiter, authController.confirmPasswordReset);

// Diagnostico de sesion
router.get('/me', authController.requireAuth, authController.me);

// Introspeccion de token (para Flows/servicios internos)
router.get('/introspect', authController.introspect);

module.exports = router;
