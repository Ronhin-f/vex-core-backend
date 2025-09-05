// routes/superadminRoutes.js
const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../controllers/authController');
const superadmin = require('../controllers/superadminController');

// 🔒 Todo /superadmin exige token + rol superadmin
router.use(requireAuth, requireRole('superadmin'));

router.get('/organizaciones', superadmin.getOrganizaciones);

module.exports = router;
