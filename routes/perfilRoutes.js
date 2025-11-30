// routes/perfilRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const perfilesController = require('../controllers/perfilesController');

// Perfil de organizacion (multi-tenant, owner/superadmin para updates)
router.get('/organizacion', authenticateToken, perfilesController.getPerfilOrganizacion);
router.put('/organizacion', authenticateToken, perfilesController.updatePerfilOrganizacion);

// Perfil de usuario dentro de la organizacion actual
router.get('/usuarios/:email', authenticateToken, perfilesController.getPerfilUsuario);
router.put('/usuarios/:email', authenticateToken, perfilesController.updatePerfilUsuario);

module.exports = router;
