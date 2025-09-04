// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Log básico de entrada (no loguea contraseñas)
router.post('/login', (req, _res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase();
    console.log('[LOGIN_DEBUG] >> /auth/login email:', email);
  } catch {}
  next();
});

router.post('/login', authController.login);

// Registrar usuario (resuelve/crea organización según email/dom)
router.post('/register', authController.register);

// Diagnóstico de sesión (útil para el front)
router.get('/me', authController.requireAuth, authController.me);

module.exports = router;
