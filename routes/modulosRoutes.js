// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

// Middlewares con bypass superadmin
const { requireAuth, requireRole } = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// Debug opcional
const DBG = process.env.MODULOS_ROUTES_DEBUG === '1';
if (DBG) {
  console.info('[ROUTES/modulos] typeof requireAuth       =', typeof requireAuth);
  console.info('[ROUTES/modulos] typeof requireRole       =', typeof requireRole);
  console.info('[ROUTES/modulos] typeof modulos.getMods   =', typeof modulos.getMisModulos);
  console.info('[ROUTES/modulos] typeof modulos.toggle    =', typeof modulos.ownerToggle);
  console.info('[ROUTES/modulos] typeof modulos.super     =', typeof modulos.superToggle);
  console.info('[ROUTES/modulos] typeof modulos.getConfig =', typeof modulos.getModuloConfig);
}

// Lista de módulos (obj plano {crm,stock,flows})
router.get('/', requireAuth, modulos.getMisModulos);

// Config de módulo (flows | crm | stock) -> { fe_url, api_base, ... }
router.get('/:nombre/config', requireAuth, modulos.getModuloConfig);

// Estado puntual
router.get('/:nombre', requireAuth, modulos.getModuloByNombre);

// Owner puede activar/desactivar en su org (superadmin tambien pasa)
router.post('/toggle', requireAuth, requireRole('owner'), modulos.ownerToggle);

// Solo superadmin habilita/deshabilita modulos en otra org
router.post('/superadmin', requireAuth, requireRole('superadmin'), modulos.superToggle);

module.exports = router;
