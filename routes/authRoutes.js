const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// 👉 Iniciar sesión
router.post('/login', authController.login);

// 👉 Registrar usuario (requiere organizacion_id ya creado)
router.post('/register', authController.register);

module.exports = router;
