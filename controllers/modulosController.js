// controllers/modulosController.js
const MOD_DEBUG = process.env.MODULOS_DEBUG === '1';
const dbg = (...a) => MOD_DEBUG && console.log('[MODULOS]', ...a);

/**
 * Normaliza filas a objeto plano { crm: bool, stock: bool }.
 * Mantiene defaults en false.
 */
function rowsToObj(rows = []) {
  const out = { crm: false, stock: false };
  for (const r of rows) {
    const name = String(r.nombre || '').toLowerCase();
    if (name === 'crm' || name === 'stock') {
      out[name] = !!r.habilitado;
    }
  }
  return out;
}

/**
 * GET /modulos
 * Debe responder un OBJETO PLANO { crm: bool, stock: bool }.
 * Si no hay org, devolvemos { crm:false, stock:false } (no 401).
 */
exports.getModulos = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) {
      dbg('getModulos: user sin organizacion_id → {crm:false,stock:false}');
      return res.json({ crm: false, stock: false });
    }

    const { rows } = await req.db.query(
      `SELECT nombre, habilitado
         FROM modulos
        WHERE organizacion_id = $1`,
      [orgId]
    );

    const obj = rowsToObj(rows);
    dbg('getModulos:', { orgId, obj });
    return res.json(obj);
  } catch (e) {
    console.error('[getModulos] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudieron cargar los módulos' });
  }
};

/**
 * GET /modulos/:nombre
 * Devuelve { nombre, habilitado } (bool) para la org del usuario.
 */
exports.getModuloByNombre = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    const { nombre } = req.params || {};

    if (!nombre) return res.status(400).json({ error: 'Nombre de módulo requerido' });
    if (!orgId) return res.json({ nombre, habilitado: false });

    const { rows } = await req.db.query(
      `SELECT habilitado
         FROM modulos
        WHERE organizacion_id = $1 AND nombre = $2
        LIMIT 1`,
      [orgId, nombre]
    );

    const habilitado = !!rows?.[0]?.habilitado;
    dbg('getModuloByNombre:', { orgId, nombre, habilitado });
    return res.json({ nombre, habilitado });
  } catch (e) {
    console.error('[getModuloByNombre] Error:', e?.message);
    return res.status(500).json({ error: 'Error al verificar módulo' });
  }
};

/**
 * POST /modulos/toggle  (owner en su propia organización)
 * Body: { nombre: string, habilitado: boolean }
 * Rutas: requireAuth + requireRole('owner')
 */
exports.ownerToggle = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    const { nombre, habilitado } = req.body || {};

    if (!orgId) return res.status(401).json({ error: 'No autorizado: falta organización' });
    if (!nombre || typeof habilitado !== 'boolean') {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }

    const q = `
      WITH up AS (
        UPDATE modulos
           SET habilitado = $3
         WHERE organizacion_id = $1
           AND nombre = $2
      RETURNING id, organizacion_id, nombre, habilitado
      )
      INSERT INTO modulos (organizacion_id, nombre, habilitado)
      SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM up)
      RETURNING id, organizacion_id, nombre, habilitado;
    `;
    const { rows } = await req.db.query(q, [orgId, nombre, habilitado]);
    const row = rows[0] || { nombre, habilitado };

    dbg('ownerToggle', { orgId, nombre, habilitado });
    return res.json({ ok: true, modulo: { nombre: String(row.nombre), habilitado: !!row.habilitado } });
  } catch (e) {
    console.error('[ownerToggle] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudo actualizar el módulo' });
  }
};

/**
 * POST /modulos/superadmin  (puede tocar cualquier organización)
 * Body: { organizacion_id: number, nombre: string, habilitado: boolean }
 * Rutas: requireAuth + requireRole('superadmin')
 */
exports.superToggle = async (req, res) => {
  try {
    const { organizacion_id, nombre, habilitado } = req.body || {};
    if (!organizacion_id || !nombre || typeof habilitado !== 'boolean') {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }

    const q = `
      WITH up AS (
        UPDATE modulos
           SET habilitado = $3
         WHERE organizacion_id = $1
           AND nombre = $2
      RETURNING id, organizacion_id, nombre, habilitado
      )
      INSERT INTO modulos (organizacion_id, nombre, habilitado)
      SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM up)
      RETURNING id, organizacion_id, nombre, habilitado;
    `;
    const { rows } = await req.db.query(q, [organizacion_id, nombre, habilitado]);
    const row = rows[0] || { nombre, habilitado };

    dbg('superToggle', { organizacion_id, nombre, habilitado });
    return res.json({ ok: true, modulo: { nombre: String(row.nombre), habilitado: !!row.habilitado } });
  } catch (e) {
    console.error('[superToggle] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudo actualizar el módulo' });
  }
};

/** Aliases para compatibilidad con código viejo */
exports.getMisModulos = exports.getModulos;              // antes usabas este nombre
exports.toggleModuloSuperadmin = exports.superToggle;    // alias viejo
