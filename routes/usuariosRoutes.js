//routes/usuariosRoutes.js
const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuariosController');
const { authenticateToken } = require('../middlewares/auth');

// 👉 Listar usuarios de la organización
router.get('/', authenticateToken, usuariosController.getUsuarios);

// 👉 Crear nuevo usuario (solo owner)
router.post('/crear-usuario', authenticateToken, usuariosController.crearUsuario);

// Whoami: devuelve el usuario autenticado por JWT
router.get('/me', authenticateToken, usuariosController.getUsuarioActual);

module.exports = router;
