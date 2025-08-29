// routes/superadminRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const superadminController = require('../controllers/superadminController');

router.get('/organizaciones', authenticateToken, superadminController.getOrganizaciones);

module.exports = router;
