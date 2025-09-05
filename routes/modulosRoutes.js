// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// Módulos del usuario (por su organización)
router.get('/', requireAuth, modulos.getMisModulos);

// Toggle para owner (su propia organización)
router.post('/toggle', requireAuth, requireRole('owner'), modulos.ownerToggle);

// Toggle global para superadmin
router.post('/superadmin', requireAuth, requireRole('superadmin'), modulos.superToggle);

module.exports = router;
