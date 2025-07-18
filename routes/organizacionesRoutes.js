const express = require('express');
const router = express.Router();
const organizacionesController = require('../controllers/organizacionesController');
const { authenticateToken } = require('../middlewares/auth');

// 👉 Ver todas las organizaciones con sus módulos (solo superadmin)
router.get('/superadmin/organizaciones', authenticateToken, organizacionesController.getOrganizacionesConModulos);

module.exports = router;
