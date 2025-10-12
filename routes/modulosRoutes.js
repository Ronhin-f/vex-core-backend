// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

// Middlewares con bypass superadmin
const { requireAuth, requireRole } = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// Debug opcional
const DBG = process.env.MODULOS_ROUTES_DEBUG === '1';
if (DBG) {
  console.info('[ROUTES/modulos] typeof requireAuth     =', typeof requireAuth);
  console.info('[ROUTES/modulos] typeof requireRole     =', typeof requireRole);
  console.info('[ROUTES/modulos] typeof modulos.getMods =', typeof modulos.getMisModulos);
  console.info('[ROUTES/modulos] typeof modulos.toggle  =', typeof modulos.ownerToggle);
  console.info('[ROUTES/modulos] typeof modulos.super   =', typeof modulos.superToggle);
}

// Lista de módulos (obj plano {crm,stock,flows})
router.get('/', requireAuth, modulos.getMisModulos);

// Estado puntual
router.get('/:nombre', requireAuth, modulos.getModuloByNombre);

// Owner toggle (superadmin pasa por bypass)
router.post('/toggle', requireAuth, requireRole('owner'), modulos.ownerToggle);

// Superadmin toggle
router.post('/superadmin', requireAuth, requireRole('superadmin'), modulos.superToggle);

module.exports = router;
