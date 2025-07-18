const express = require('express');
const router = express.Router();
const modulosController = require('../controllers/modulosController');
const { authenticateToken } = require('../middlewares/auth');

// 👉 Obtener todos los módulos de la organización
router.get('/', authenticateToken, modulosController.getModulos);

// 👉 Verificar si un módulo está habilitado
router.get('/:nombre', authenticateToken, modulosController.getModuloByNombre);

// 👉 Habilitar/deshabilitar módulos como superadmin
router.post('/superadmin', authenticateToken, modulosController.toggleModuloSuperadmin);

module.exports = router;
