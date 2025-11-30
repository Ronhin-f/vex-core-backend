// routes/authRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/authController');

// Log basico (no loguea passwords)
const logLogin = (req, _res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase();
    console.log('[LOGIN_DEBUG] >> /auth/login email:', email);
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

router.post('/login', loginLimiter, logLogin, authController.login);
router.post('/register', registerLimiter, authController.register);
router.post('/change-password', changePassLimiter, authController.requireAuth, authController.changePassword);

// Diagnostico de sesion
router.get('/me', authController.requireAuth, authController.me);

// Introspeccion de token (para Flows/servicios internos)
router.get('/introspect', authController.introspect);

module.exports = router;
