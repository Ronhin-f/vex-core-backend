// middlewares/auth.js
const jwt = require('jsonwebtoken');
const { isSuperadminEmail } = require('../config/superadmins');

const { JWT_SECRET } = process.env;
if (!JWT_SECRET) throw new Error("Falta definir JWT_SECRET en el entorno");

exports.authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const base = {
      email: decoded.email,
      rol: decoded.rol,
      organizacion_id: decoded.organizacion_id,
      nombre: decoded.nombre
    };

    // Alinear por whitelist de superadmins (token viejo, etc.)
    if (isSuperadminEmail(base.email)) base.rol = 'superadmin';

    req.usuario = base;
    req.usuario_email = base.email;
    req.organizacion_id = base.organizacion_id;

    next();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authMiddleware] Token inválido:', err.message);
    }
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
