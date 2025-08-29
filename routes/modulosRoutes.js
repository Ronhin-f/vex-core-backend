// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const mod = require('../controllers/modulosController');

router.get('/', authenticateToken, mod.getModulos);
router.get('/:nombre', authenticateToken, mod.getModuloByNombre);
router.post('/toggle', authenticateToken, mod.toggleModuloSuperadmin);

module.exports = router;
