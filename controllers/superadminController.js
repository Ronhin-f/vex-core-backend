// controllers/superadminController.js
const { isSuperadminEmail } = require('../config/superadmins');

exports.getOrganizaciones = async (req, res) => {
  try {
    const email = req.usuario_email;
    const esSuperadmin = req.usuario?.rol === 'superadmin' || isSuperadminEmail(email);
    if (!esSuperadmin) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const result = await req.db.query(`
      SELECT o.id, o.nombre, o.nicho, o.email_admin,
        COALESCE(json_agg(m.*) FILTER (WHERE m.id IS NOT NULL), '[]') AS modulos
      FROM organizaciones o
      LEFT JOIN modulos m ON o.id = m.organizacion_id
      GROUP BY o.id
      ORDER BY o.nombre ASC
    `);

    res.json({ organizaciones: result.rows });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error("[superadminController/getOrganizaciones]", err);
    }
    res.status(500).json({ error: 'Error al obtener organizaciones' });
  }
};
