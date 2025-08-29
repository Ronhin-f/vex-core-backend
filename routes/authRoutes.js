// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Iniciar sesión
router.post('/login', authController.login);

// Registrar usuario (resuelve/crea organización según email/dom)
router.post('/register', authController.register);

module.exports = router;
