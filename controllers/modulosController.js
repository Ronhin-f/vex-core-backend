// controllers/modulosController.js
const { isSuperadminEmail } = require('../config/superadmins');

// Devuelve los módulos habilitados para la organización autenticada
exports.getModulos = async (req, res) => {
  try {
    const organizacion_id = req.organizacion_id || req.usuario?.organizacion_id;
    if (!organizacion_id) {
      return res.status(401).json({ error: "No autorizado: falta organización" });
    }

    const result = await req.db.query(
      `SELECT nombre, habilitado FROM modulos WHERE organizacion_id = $1`,
      [organizacion_id]
    );

    const modulosPlano = {};
    for (const row of result.rows) modulosPlano[row.nombre] = row.habilitado;

    res.json(modulosPlano);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/getModulos]', err);
    }
    res.status(500).json({ error: 'Error al obtener módulos' });
  }
};

// Estado de un módulo por nombre
exports.getModuloByNombre = async (req, res) => {
  const { nombre } = req.params;
  try {
    const organizacion_id = req.organizacion_id || req.usuario?.organizacion_id;
    if (!organizacion_id) {
      return res.status(401).json({ error: "No autorizado: falta organización" });
    }
    const result = await req.db.query(
      `SELECT habilitado FROM modulos WHERE organizacion_id = $1 AND nombre = $2`,
      [organizacion_id, nombre]
    );
    const habilitado = result.rows[0]?.habilitado || false;
    res.json({ nombre, habilitado });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/getModuloByNombre]', err);
    }
    res.status(500).json({ error: 'Error al verificar módulo' });
  }
};

// Activar/desactivar módulos (solo superadmin por whitelist o rol)
exports.toggleModuloSuperadmin = async (req, res) => {
  const email = req.usuario_email;
  const esSuperadmin = req.usuario?.rol === 'superadmin' || isSuperadminEmail(email);
  if (!esSuperadmin) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const { organizacion_id, nombre, habilitado } = req.body || {};
  if (!organizacion_id || !nombre || typeof habilitado !== 'boolean') {
    return res.status(400).json({ error: 'Faltan datos o tipo incorrecto' });
  }

  try {
    const existe = await req.db.query(
      'SELECT id FROM modulos WHERE organizacion_id = $1 AND nombre = $2',
      [organizacion_id, nombre]
    );

    if (existe.rowCount > 0) {
      await req.db.query(
        'UPDATE modulos SET habilitado = $1 WHERE organizacion_id = $2 AND nombre = $3',
        [habilitado, organizacion_id, nombre]
      );
    } else {
      await req.db.query(
        'INSERT INTO modulos (organizacion_id, nombre, habilitado) VALUES ($1, $2, $3)',
        [organizacion_id, nombre, habilitado]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/toggleModuloSuperadmin]', err);
    }
    res.status(500).json({ error: 'Error al actualizar módulo' });
  }
};
