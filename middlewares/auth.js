const jwt = require('jsonwebtoken');
const { JWT_SECRET } = process.env;

if (!JWT_SECRET) throw new Error("Falta definir JWT_SECRET en el entorno");

exports.authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario_email = decoded.email;
    req.organizacion_id = decoded.organizacion_id;
    req.rol = decoded.rol;
    next();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authMiddleware] Token inválido:', err.message);
    }
    return res.status(403).json({ message: 'Token inválido o expirado' });
  }
};
