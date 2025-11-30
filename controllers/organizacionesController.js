// controllers/organizacionesController.js
const { isSuperadminEmail } = require('../config/superadmins');

function normDom(emailOrDomain = '') {
  const s = String(emailOrDomain).toLowerCase().trim();
  const m = s.includes('@') ? s.match(/@([^@]+)$/) : null;
  return (m ? m[1] : s).replace(/^www\./, '');
}

// Solo superadmin o whitelisted
exports.getOrganizacionesConModulos = async (req, res) => {
  try {
    const email = req.usuario_email;
    const esSuperadmin = req.usuario?.rol === 'superadmin' || isSuperadminEmail(email);
    if (!esSuperadmin) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const orgs = await req.db.query('SELECT * FROM organizaciones ORDER BY creado_en DESC NULLS LAST');
    const modulos = await req.db.query('SELECT * FROM modulos');

    const data = orgs.rows.map((org) => {
      const mods = modulos.rows
        .filter((m) => m.organizacion_id === org.id)
        .map(({ nombre, habilitado }) => ({ nombre, habilitado }));
      return { ...org, modulos: mods };
    });

    res.json(data);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[organizacionesController/getOrganizacionesConModulos]', err);
    }
    res.status(500).json({ error: 'Error al obtener organizaciones' });
  }
};

// UX de registro: saber si un dominio ya está reclamado (y si es público)
exports.getDomainInfo = async (req, res) => {
  try {
    // Permito ?dom= o ?email=
    const param = req.query.dom || req.query.email || '';
    const dom = normDom(param);
    if (!dom) return res.status(400).json({ error: 'Falta dom/email' });

    const pub = await req.db.query('SELECT 1 FROM dominios_publicos WHERE dominio=$1', [dom]);
    const isPublicDomain = pub.rowCount > 0;

    const r = await req.db.query(
      `SELECT od.organizacion_id, od.verificado, o.nombre
       FROM organizacion_dominios od
       JOIN organizaciones o ON o.id = od.organizacion_id
       WHERE od.dominio=$1`,
      [dom]
    );

    if (!r.rowCount) {
      return res.json({ existe: false, isPublicDomain });
    }
    const row = r.rows[0];
    const esSuper = req.usuario?.rol === 'superadmin' || isSuperadminEmail(req.usuario_email);
    const mismaOrg = req.organizacion_id && row.organizacion_id === req.organizacion_id;

    if (!esSuper && !mismaOrg) {
      // No exponemos datos de otras organizaciones
      return res.json({ existe: true, isPublicDomain });
    }

    return res.json({
      existe: true,
      isPublicDomain,
      organizacion_id: row.organizacion_id,
      nombre: row.nombre,
      verificado: row.verificado
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.error('[getDomainInfo]', e);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Crear u obtener org por nombre exacto
exports.createOrGetOrganizacion = async (req, res) => {
  try {
    const rol = req.usuario?.rol || req.user?.rol;
    if (!['owner', 'superadmin'].includes(rol)) {
      return res.status(403).json({ error: 'Solo owner o superadmin pueden crear organizaciones' });
    }

    const nombreRaw = (req.body?.nombre || '').trim();
    if (!nombreRaw) return res.status(400).json({ error: 'Falta nombre' });

    const nombre = nombreRaw.replace(/\s+/g, ' ');

    const sel = await req.db.query(
      `SELECT id, nombre, estado FROM organizaciones WHERE nombre=$1`,
      [nombre]
    );
    if (sel.rowCount) {
      return res.json({ organizacion: sel.rows[0], created: false });
    }

    const ins = await req.db.query(
      `INSERT INTO organizaciones (nombre, estado)
       VALUES ($1, 'active')
       RETURNING id, nombre, estado`,
      [nombre]
    );
    return res.status(201).json({ organizacion: ins.rows[0], created: true });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.error('[createOrGetOrganizacion]', e);
    res.status(500).json({ error: 'Error interno' });
  }
};
