// controllers/superadminController.js
const { isSuperadminEmail } = require('../config/superadmins');

const SA_DEBUG = process.env.SUPERADMIN_DEBUG === '1';
const dbg = (...a) => SA_DEBUG && console.log('[SUPERADMIN]', ...a);

/**
 * GET /superadmin/organizaciones
 * Requiere: requireAuth + requireRole('superadmin') en la ruta.
 * Devuelve: { ok: true, organizaciones: [{ id, nombre, nicho, email_admin, estado, modulos: [{nombre, habilitado}] }] }
 */
exports.getOrganizaciones = async (req, res) => {
  try {
    const email = String(req.user?.email || '').toLowerCase();
    const isSuper =
      req.user?.rol === 'superadmin' ||
      req.user?.isSuperadmin === true ||
      isSuperadminEmail(email);

    if (!isSuper) {
      return res.status(403).json({ ok: false, error: 'Acceso denegado' });
    }

    dbg('getOrganizaciones by:', email);

    const q = `
      SELECT
        o.id,
        o.nombre,
        o.nicho,
        o.email_admin,
        o.estado,
        COALESCE(
          json_agg(
            json_build_object('nombre', m.nombre, 'habilitado', m.habilitado)
            ORDER BY m.nombre
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'::json
        ) AS modulos
      FROM organizaciones o
      LEFT JOIN modulos m ON m.organizacion_id = o.id
      GROUP BY o.id
      ORDER BY o.nombre ASC
    `;

    const { rows } = await req.db.query(q);
    dbg('orgs:', rows.length);

    return res.json({ ok: true, organizaciones: rows });
  } catch (err) {
    console.error('[superadminController/getOrganizaciones] Error:', err?.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener organizaciones' });
  }
};
