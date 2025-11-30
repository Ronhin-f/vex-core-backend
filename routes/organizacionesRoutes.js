// routes/organizacionesRoutes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const org = require('../controllers/organizacionesController');

const domainInfoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/superadmin/organizaciones', authenticateToken, org.getOrganizacionesConModulos);
router.get('/domain-info', authenticateToken, domainInfoLimiter, org.getDomainInfo);
router.post('/create-or-get', authenticateToken, requireRole('owner', 'superadmin'), org.createOrGetOrganizacion);

module.exports = router;
