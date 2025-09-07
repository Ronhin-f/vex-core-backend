// core-backend/middlewares/auth.js
const jwt = require('jsonwebtoken');
const { isSuperadminEmail } = require('../config/superadmins');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta definir JWT_SECRET en el entorno');

function normalizeUser(decoded) {
  const base = {
    id: decoded.id ?? decoded.user_id ?? decoded.uid ?? null,
    email: decoded.email,
    rol: decoded.rol,
    organizacion_id: decoded.organizacion_id ?? decoded.org_id ?? null,
    nombre: decoded.nombre ?? decoded.name ?? null,
  };
  if (isSuperadminEmail(base.email)) base.rol = 'superadmin';
  return base;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = normalizeUser(decoded);

    // Campos nuevos + legacy
    req.user = user;                 // <-- lo que esperan los controllers
    req.usuario = user;              // <-- compat con código viejo
    req.usuario_email = user.email;  // legacy
    req.organizacion_id = user.organizacion_id; // legacy

    return next();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[auth] Token inválido:', err.message);
    }
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.user || req.usuario;
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(u.rol)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    return next();
  };
}

// Export público esperado por las rutas
module.exports = {
  requireAuth,
  requireRole,
  // compat con tu nombre anterior
  authenticateToken: requireAuth,
};
