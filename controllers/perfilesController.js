// controllers/perfilesController.js
const { isSuperadminEmail } = require('../config/superadmins');

const VERTICALES_PERMITIDAS = [
  'general',
  'salud',
  'veterinaria',
  'servicios',
  'software',
  'educacion',
  'retail',
  'logistica',
  'manufactura',
  'finanzas',
  'agro',
  'consultoria',
  'otros',
];

let cachedVetFlags = null;
async function supportsVetFlags(db) {
  if (cachedVetFlags !== null) return cachedVetFlags;
  try {
    await db.query('SELECT habilita_ficha_mascotas, habilita_recordatorios_vacunas FROM organizacion_perfil LIMIT 1');
    cachedVetFlags = true;
  } catch (e) {
    if (e?.code === '42703' || e?.code === '42P01') {
      cachedVetFlags = false;
    } else {
      throw e;
    }
  }
  return cachedVetFlags;
}

function normEmail(s = '') {
  return String(s).trim().toLowerCase();
}

function cleanText(value, max = 120) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max);
}

function validateHttpUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function validateColor(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^#?[0-9a-fA-F]{3}$/.test(v) || /^#?[0-9a-fA-F]{6}$/.test(v)) {
    return v.startsWith('#') ? v : `#${v}`;
  }
  return null;
}

function normalizeAreaVertical(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (VERTICALES_PERMITIDAS.includes(v)) return v;
  return null;
}

function normalizeFlag(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return null;
}

async function getBaseUser(req, email, orgId) {
  const { rows } = await req.db.query(
    `SELECT email, nombre, rol
       FROM usuarios
      WHERE email = $1 AND organizacion_id = $2
      LIMIT 1`,
    [email, orgId]
  );
  return rows[0] || null;
}

exports.getPerfilOrganizacion = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) return res.status(400).json({ error: 'Falta organizacion_id en el token' });

    const org = await req.db.query(
      'SELECT id, nombre, estado FROM organizaciones WHERE id = $1 LIMIT 1',
      [orgId]
    );
    const baseOrg = org.rows[0];
    if (!baseOrg) return res.status(404).json({ error: 'Organizacion no encontrada' });

    const vetFlags = await supportsVetFlags(req.db);
    let perfil = null;

    if (vetFlags) {
      const { rows } = await req.db.query(
        `SELECT organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, habilita_ficha_mascotas, habilita_recordatorios_vacunas, updated_at
           FROM organizacion_perfil
          WHERE organizacion_id = $1
          LIMIT 1`,
        [orgId]
      );
      perfil = rows[0] || null;
    } else {
      const { rows } = await req.db.query(
        `SELECT organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, updated_at
           FROM organizacion_perfil
          WHERE organizacion_id = $1
          LIMIT 1`,
        [orgId]
      );
      perfil = rows[0] || null;
    }

    const nombre_publico = perfil?.nombre_publico || baseOrg.nombre;

    return res.json({
      ok: true,
      perfil: {
        organizacion_id: orgId,
        nombre_publico,
        logo_url: perfil?.logo_url || null,
        brand_color: perfil?.brand_color || null,
        idioma: perfil?.idioma || null,
        timezone: perfil?.timezone || null,
        area_vertical: perfil?.area_vertical || null,
        habilita_historias_clinicas: !!perfil?.habilita_historias_clinicas,
        habilita_ficha_mascotas: vetFlags ? !!perfil?.habilita_ficha_mascotas : false,
        habilita_recordatorios_vacunas: vetFlags ? !!perfil?.habilita_recordatorios_vacunas : false,
        updated_at: perfil?.updated_at || null,
      },
      base: { nombre: baseOrg.nombre, estado: baseOrg.estado },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[getPerfilOrganizacion]', e);
    }
    return res.status(500).json({ error: 'Error al obtener perfil de organizacion' });
  }
};

exports.updatePerfilOrganizacion = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    const rol = req.user?.rol;
    const email = req.user?.email;

    const esSuper = isSuperadminEmail(email) || rol === 'superadmin';
    if (!orgId) return res.status(400).json({ error: 'Falta organizacion_id en el token' });
    if (!esSuper && rol !== 'owner') {
      return res.status(403).json({ error: 'Solo owner o superadmin pueden editar el perfil de la organizacion' });
    }

    const nombre_publico = cleanText(req.body?.nombre_publico, 120);
    const logo_url = validateHttpUrl(req.body?.logo_url);
    const brand_color = validateColor(req.body?.brand_color);
    const idioma = cleanText(req.body?.idioma, 8);
    const timezone = cleanText(req.body?.timezone, 64);
    const area_vertical = normalizeAreaVertical(req.body?.area_vertical);
    const habilita_historias_clinicas = normalizeFlag(req.body?.habilita_historias_clinicas);
    const habilita_ficha_mascotas = normalizeFlag(req.body?.habilita_ficha_mascotas);
    const habilita_recordatorios_vacunas = normalizeFlag(req.body?.habilita_recordatorios_vacunas);

    const org = await req.db.query(
      'SELECT nombre FROM organizaciones WHERE id = $1 LIMIT 1',
      [orgId]
    );
    const baseNombre = org.rows[0]?.nombre || null;

    const finalNombre = nombre_publico || baseNombre;
    if (!finalNombre) {
      return res.status(400).json({ error: 'No hay nombre valido para la organizacion' });
    }

    const vetFlags = await supportsVetFlags(req.db);
    let upsert = '';
    let params = [];

    if (vetFlags) {
      upsert = `
        INSERT INTO organizacion_perfil (organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, habilita_ficha_mascotas, habilita_recordatorios_vacunas, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false), COALESCE($9, false), COALESCE($10, false), NOW())
        ON CONFLICT (organizacion_id)
        DO UPDATE SET
          nombre_publico = EXCLUDED.nombre_publico,
          logo_url = COALESCE(EXCLUDED.logo_url, organizacion_perfil.logo_url),
          brand_color = COALESCE(EXCLUDED.brand_color, organizacion_perfil.brand_color),
          idioma = COALESCE(EXCLUDED.idioma, organizacion_perfil.idioma),
          timezone = COALESCE(EXCLUDED.timezone, organizacion_perfil.timezone),
          area_vertical = COALESCE(EXCLUDED.area_vertical, organizacion_perfil.area_vertical),
          habilita_historias_clinicas = COALESCE(EXCLUDED.habilita_historias_clinicas, organizacion_perfil.habilita_historias_clinicas),
          habilita_ficha_mascotas = COALESCE(EXCLUDED.habilita_ficha_mascotas, organizacion_perfil.habilita_ficha_mascotas),
          habilita_recordatorios_vacunas = COALESCE(EXCLUDED.habilita_recordatorios_vacunas, organizacion_perfil.habilita_recordatorios_vacunas),
          updated_at = NOW()
        RETURNING organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, habilita_ficha_mascotas, habilita_recordatorios_vacunas, updated_at;
      `;
      params = [
        orgId,
        finalNombre,
        logo_url,
        brand_color,
        idioma,
        timezone,
        area_vertical,
        habilita_historias_clinicas === null ? null : !!habilita_historias_clinicas,
        habilita_ficha_mascotas === null ? null : !!habilita_ficha_mascotas,
        habilita_recordatorios_vacunas === null ? null : !!habilita_recordatorios_vacunas,
      ];
    } else {
      upsert = `
        INSERT INTO organizacion_perfil (organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false), NOW())
        ON CONFLICT (organizacion_id)
        DO UPDATE SET
          nombre_publico = EXCLUDED.nombre_publico,
          logo_url = COALESCE(EXCLUDED.logo_url, organizacion_perfil.logo_url),
          brand_color = COALESCE(EXCLUDED.brand_color, organizacion_perfil.brand_color),
          idioma = COALESCE(EXCLUDED.idioma, organizacion_perfil.idioma),
          timezone = COALESCE(EXCLUDED.timezone, organizacion_perfil.timezone),
          area_vertical = COALESCE(EXCLUDED.area_vertical, organizacion_perfil.area_vertical),
          habilita_historias_clinicas = COALESCE(EXCLUDED.habilita_historias_clinicas, organizacion_perfil.habilita_historias_clinicas),
          updated_at = NOW()
        RETURNING organizacion_id, nombre_publico, logo_url, brand_color, idioma, timezone, area_vertical, habilita_historias_clinicas, updated_at;
      `;
      params = [
        orgId,
        finalNombre,
        logo_url,
        brand_color,
        idioma,
        timezone,
        area_vertical,
        habilita_historias_clinicas === null ? null : !!habilita_historias_clinicas,
      ];
    }

    const { rows } = await req.db.query(upsert, params);

    const perfil = rows[0];
    return res.json({ ok: true, perfil });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[updatePerfilOrganizacion]', e);
    }
    return res.status(500).json({ error: 'Error al actualizar perfil de organizacion' });
  }
};

exports.getPerfilUsuario = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) return res.status(400).json({ error: 'Falta organizacion_id en el token' });

    const email = normEmail(req.params?.email || '');
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const base = await getBaseUser(req, email, orgId);
    if (!base) return res.status(404).json({ error: 'Usuario no encontrado en esta organizacion' });

    const { rows } = await req.db.query(
      `SELECT organizacion_id, usuario_email, nombre, apellido, avatar_url, phone, updated_at
         FROM usuario_perfil
        WHERE organizacion_id = $1 AND LOWER(usuario_email) = LOWER($2)
        LIMIT 1`,
      [orgId, email]
    );

    const perfil = rows[0] || null;
    const nombre = perfil?.nombre || base.nombre || email.split('@')[0];
    const apellido = perfil?.apellido || null;
    const nombre_completo = apellido ? `${nombre} ${apellido}`.trim() : nombre;

    return res.json({
      ok: true,
      perfil: {
        organizacion_id: orgId,
        usuario_email: email,
        nombre,
        apellido,
        nombre_completo,
        avatar_url: perfil?.avatar_url || null,
        phone: perfil?.phone || null,
        updated_at: perfil?.updated_at || null,
      },
      base: { nombre: base.nombre, rol: base.rol },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[getPerfilUsuario]', e);
    }
    return res.status(500).json({ error: 'Error al obtener perfil de usuario' });
  }
};

exports.updatePerfilUsuario = async (req, res) => {
  try {
    const actor = req.user || {};
    const orgId = actor.organizacion_id;
    if (!orgId) return res.status(400).json({ error: 'Falta organizacion_id en el token' });

    const email = normEmail(req.params?.email || '');
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const base = await getBaseUser(req, email, orgId);
    if (!base) return res.status(404).json({ error: 'Usuario no encontrado en esta organizacion' });

    const esPropio = normEmail(actor.email) === email;
    const esAdmin = ['owner', 'admin'].includes(actor.rol) || actor.rol === 'superadmin' || actor.isSuperadmin;
    if (!esPropio && !esAdmin) {
      return res.status(403).json({ error: 'No podes editar este perfil' });
    }

    const nombre = cleanText(req.body?.nombre, 120);
    const apellido = cleanText(req.body?.apellido, 120);
    const avatar_url = validateHttpUrl(req.body?.avatar_url);
    const phone = cleanText(req.body?.phone, 32);

    if (!nombre && !apellido && !avatar_url && !phone) {
      return res.status(400).json({ error: 'Nada para actualizar' });
    }

    const upsert = `
      INSERT INTO usuario_perfil (organizacion_id, usuario_email, nombre, apellido, avatar_url, phone, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (organizacion_id, usuario_email)
      DO UPDATE SET
        nombre = COALESCE(EXCLUDED.nombre, usuario_perfil.nombre),
        apellido = COALESCE(EXCLUDED.apellido, usuario_perfil.apellido),
        avatar_url = COALESCE(EXCLUDED.avatar_url, usuario_perfil.avatar_url),
        phone = COALESCE(EXCLUDED.phone, usuario_perfil.phone),
        updated_at = NOW()
      RETURNING organizacion_id, usuario_email, nombre, apellido, avatar_url, phone, updated_at;
    `;

    const { rows } = await req.db.query(upsert, [
      orgId,
      email,
      nombre,
      apellido,
      avatar_url,
      phone,
    ]);

    const perfil = rows[0];
    const nombre_completo = perfil.apellido ? `${perfil.nombre || base.nombre || email.split('@')[0]} ${perfil.apellido}`.trim() : (perfil.nombre || base.nombre || email.split('@')[0]);

    return res.json({
      ok: true,
      perfil: { ...perfil, nombre_completo },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[updatePerfilUsuario]', e);
    }
    return res.status(500).json({ error: 'Error al actualizar perfil de usuario' });
  }
};


