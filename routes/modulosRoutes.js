// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// Módulos del usuario (por su organización)
router.get('/', auth.requireAuth, modulos.getMisModulos);

// Toggle para owner (su propia organización)
router.post(
  '/toggle',
  auth.requireAuth,
  auth.requireRole('owner'),
  modulos.ownerToggle
);

// Toggle global para superadmin
router.post(
  '/superadmin',
  auth.requireAuth,
  auth.requireRole('superadmin'),
  modulos.superToggle
);

module.exports = router;
