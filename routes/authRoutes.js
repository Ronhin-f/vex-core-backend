// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Log básico (no loguea passwords)
const logLogin = (req, _res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase();
    console.log('[LOGIN_DEBUG] >> /auth/login email:', email);
  } catch {}
  next();
};

router.post('/login', logLogin, authController.login);
router.post('/register', authController.register);

// Diagnóstico de sesión
router.get('/me', authController.requireAuth, authController.me);

module.exports = router;
