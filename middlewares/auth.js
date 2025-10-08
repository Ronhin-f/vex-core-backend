// core-backend/middlewares/auth.js
const jwt = require('jsonwebtoken');
const { isSuperadminEmail } = require('../config/superadmins');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta definir JWT_SECRET en el entorno');

/* ---------------- Utils ---------------- */
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

function readBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof h !== 'string') return null;
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

/* ------------- Middlewares -------------- */
function requireAuth(req, res, next) {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = normalizeUser(decoded);

    // Campos nuevos + legacy
    req.user = user;                 // esperado por controllers nuevos
    req.usuario = user;              // compat código viejo
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

/* ------------- Handler: /api/auth/introspect (JWT only) ------------- */
function introspect(req, res) {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ active: false, error: 'missing_token' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ active: false, error: 'invalid_token' });
    }

    const user = normalizeUser(decoded);
    return res.json({
      active: true,
      user_email: user.email,
      role: user.rol || 'user',
      org_id: user.organizacion_id || null,
      isService: false, // hoy no usamos service tokens
    });
  } catch (err) {
    console.error('[INTROSPECT_ERROR]', err);
    return res.status(500).json({ active: false, error: 'introspect_error' });
  }
}

/* ------------- Exports ------------- */
module.exports = {
  requireAuth,
  requireRole,
  authenticateToken: requireAuth, // compat
  introspect,                    // <-- NUEVO
};
