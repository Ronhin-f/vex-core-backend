// routes/modulosRoutes.js
const express = require('express');
const router = express.Router();

const auth = require('../controllers/authController');
const modulos = require('../controllers/modulosController');

// Logs de verificación (solo útiles al boot)
if (process.env.MODULOS_DEBUG === '1') {
  console.log('[ROUTES/modulos] requireAuth:', typeof auth.requireAuth);
  console.log('[ROUTES/modulos] requireRole:', typeof auth.requireRole);
  console.log('[ROUTES/modulos] getMisModulos:', typeof modulos.getMisModulos);
  console.log('[ROUTES/modulos] getModuloByNombre:', typeof modulos.getModuloByNombre);
  console.log('[ROUTES/modulos] ownerToggle:', typeof modulos.ownerToggle);
  console.log('[ROUTES/modulos] superToggle:', typeof modulos.superToggle);
}

// Wrapper defensivo: si el handler no es función, responde 500 claramente
const safe = (name, fn) => {
  if (typeof fn !== 'function') {
    console.error(`[ROUTES/modulos] Handler "${name}" no es función (es: ${typeof fn}).`);
    return (_req, res) => res.status(500).json({ error: `Handler "${name}" no disponible` });
  }
  return fn;
};

/**
 * GET /modulos
 * Devuelve objeto plano { crm: bool, stock: bool } para la organización del usuario.
 * Controladores esperados:
 *   - auth.requireAuth
 *   - modulos.getMisModulos
 */
router.get(
  '/',
  safe('requireAuth', auth.requireAuth),
  safe('getMisModulos', modulos.getMisModulos)
);

/**
 * GET /modulos/:nombre  (opcional)
 * Devuelve { nombre, habilitado } para la organización del usuario.
 * Si tu controller aún no lo tiene, simplemente no expongas esta ruta.
 */
if (typeof modulos.getModuloByNombre === 'function') {
  router.get(
    '/:nombre',
    safe('requireAuth', auth.requireAuth),
    safe('getModuloByNombre', modulos.getModuloByNombre)
  );
}

/**
 * POST /modulos/toggle
 * Solo owner (o superadmin vía bypass en requireRole).
 * Body: { nombre, habilitado }
 */
router.post(
  '/toggle',
  safe('requireAuth', auth.requireAuth),
  safe('requireRole(owner)', auth.requireRole && auth.requireRole('owner')),
  safe('ownerToggle', modulos.ownerToggle)
);

/**
 * POST /modulos/superadmin
 * Solo superadmin.
 * Body: { organizacion_id, nombre, habilitado }
 */
router.post(
  '/superadmin',
  safe('requireAuth', auth.requireAuth),
  safe('requireRole(superadmin)', auth.requireRole && auth.requireRole('superadmin')),
  safe('superToggle', modulos.superToggle)
);

module.exports = router;
