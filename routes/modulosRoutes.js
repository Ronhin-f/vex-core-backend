// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// DEBUG de importaciones (se ve en logs al levantar)
console.log('[ROUTES/modulos] typeof auth.requireAuth =', typeof auth.requireAuth);
console.log('[ROUTES/modulos] typeof auth.requireRole =', typeof auth.requireRole);
console.log('[ROUTES/modulos] typeof modulos.getMisModulos =', typeof modulos.getMisModulos);
console.log('[ROUTES/modulos] typeof modulos.ownerToggle =', typeof modulos.ownerToggle);
console.log('[ROUTES/modulos] typeof modulos.superToggle =', typeof modulos.superToggle);

// Wrapper defensivo: si el handler no es función, no rompas el boot
const safe = (name, fn) => {
  if (typeof fn !== 'function') {
    console.error(`[ROUTES/modulos] Handler "${name}" no es función (es: ${typeof fn}).`);
    return (_req, res) => res.status(500).json({ error: `Handler "${name}" no disponible` });
  }
  return fn;
};

// Módulos del usuario (por su organización)
router.get('/', safe('requireAuth', auth.requireAuth), safe('getMisModulos', modulos.getMisModulos));

// Toggle para owner (su propia organización)
router.post(
  '/toggle',
  safe('requireAuth', auth.requireAuth),
  safe('requireRole(owner)', auth.requireRole ? auth.requireRole('owner') : undefined),
  safe('ownerToggle', modulos.ownerToggle)
);

// Toggle global para superadmin
router.post(
  '/superadmin',
  safe('requireAuth', auth.requireAuth),
  safe('requireRole(superadmin)', auth.requireRole ? auth.requireRole('superadmin') : undefined),
  safe('superToggle', modulos.superToggle)
);

module.exports = router;
