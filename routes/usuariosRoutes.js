//routes/usuariosRoutes.js
const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { authenticateToken } = require('../middlewares/auth');
const { createRateLimiter, defaultKeyGenerator } = require('../middlewares/rateLimit');

const createUserLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 15,
  keyGenerator: defaultKeyGenerator,
  message: { ok: false, error: 'Demasiadas invitaciones, proba mas tarde', code: 'rate_limit' },
});

// 👉 Listar usuarios de la organización
router.get('/', authenticateToken, usuariosController.getUsuarios);

// 👉 Crear nuevo usuario (solo owner)
router.post('/crear-usuario', authenticateToken, createUserLimiter, usuariosController.crearUsuario);

// Whoami: devuelve el usuario autenticado por JWT
router.get('/me', authenticateToken, usuariosController.getUsuarioActual);

module.exports = router;
