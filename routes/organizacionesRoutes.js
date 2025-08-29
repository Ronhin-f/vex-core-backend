// routes/organizacionesRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const org = require('../controllers/organizacionesController');

router.get('/superadmin/organizaciones', authenticateToken, org.getOrganizacionesConModulos);
router.get('/domain-info', org.getDomainInfo);
router.post('/create-or-get', authenticateToken, org.createOrGetOrganizacion);

module.exports = router;
