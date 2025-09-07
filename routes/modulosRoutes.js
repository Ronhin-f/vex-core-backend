// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

const { requireAuth, requireRole } = require('../middleware/auth'); // ajustá el path si tu middleware se llama distinto
const modulos = require('../controllers/modulosController');

// Debug opcional para confirmar carga del módulo en logs
console.info('[ROUTES/modulos] typeof auth.requireAuth =', typeof requireAuth);
console.info('[ROUTES/modulos] typeof auth.requireRole  =', typeof requireRole);
console.info('[ROUTES/modulos] typeof modulos.getMisModulos =', typeof modulos.getMisModulos);
console.info('[ROUTES/modulos] typeof modulos.ownerToggle   =', typeof modulos.ownerToggle);
console.info('[ROUTES/modulos] typeof modulos.superToggle   =', typeof modulos.superToggle);

// Lista de módulos de la organización del usuario (objeto plano {crm:boolean, stock:boolean})
router.get('/', requireAuth, modulos.getMisModulos);

// Estado de un módulo puntual {nombre, habilitado}
router.get('/:nombre', requireAuth, modulos.getModuloByNombre);

// Owner puede togglear en su propia organización
router.post('/toggle', requireAuth, requireRole('owner'), modulos.ownerToggle);

// Superadmin puede togglear en cualquier organización
router.post('/superadmin', requireAuth, requireRole('superadmin'), modulos.superToggle);

module.exports = router;
