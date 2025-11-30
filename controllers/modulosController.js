// controllers/modulosController.js
const MOD_DEBUG = process.env.MODULOS_DEBUG === '1';
const dbg = (...a) => MOD_DEBUG && console.log('[MODULOS]', ...a);

const ALLOWED = new Set(['crm', 'stock', 'flows']); // modulos soportados

function normName(s = '') {
  return String(s).trim().toLowerCase();
}

/**
 * Normaliza filas a objeto plano { crm: bool, stock: bool, flows: bool }.
 * Mantiene defaults en false.
 */
function rowsToObj(rows = []) {
  const out = { crm: false, stock: false, flows: false };
  for (const r of rows) {
    const name = normName(r.nombre);
    if (ALLOWED.has(name)) {
      out[name] = !!r.habilitado;
    }
  }
  return out;
}

/**
 * GET /modulos
 * Debe responder un OBJETO PLANO { crm, stock, flows }.
 * Si no hay org, devolvemos { crm:false, stock:false, flows:false } (no 401).
 */
exports.getModulos = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) {
      dbg('getModulos: user sin organizacion_id -> {crm:false,stock:false,flows:false}');
      return res.json({ crm: false, stock: false, flows: false });
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
    return res.status(500).json({ error: 'No se pudieron cargar los modulos' });
  }
};

/**
 * GET /modulos/:nombre
 * Devuelve { nombre, habilitado } (bool) para la org del usuario.
 */
exports.getModuloByNombre = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    const nombreRaw = req.params?.nombre;
    if (!nombreRaw) return res.status(400).json({ error: 'Nombre de modulo requerido' });

    const nombre = normName(nombreRaw);
    if (!ALLOWED.has(nombre)) {
      return res.status(400).json({ error: 'Modulo invalido' });
    }

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
    return res.status(500).json({ error: 'Error al verificar modulo' });
  }
};

/**
 * POST /modulos/toggle  (owner en su propia organizacion)
 * Body: { nombre: string, habilitado: boolean }
 * Rutas: requireAuth + requireRole('owner')
 */
exports.ownerToggle = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    let { nombre, habilitado } = req.body || {};

    if (!orgId) return res.status(401).json({ error: 'No autorizado: falta organizacion' });
    if (!nombre || typeof habilitado !== 'boolean') {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    nombre = normName(nombre);
    if (!ALLOWED.has(nombre)) {
      return res.status(400).json({ error: 'Modulo invalido' });
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
    return res.status(500).json({ error: 'No se pudo actualizar el modulo' });
  }
};

/**
 * POST /modulos/superadmin  (puede tocar cualquier organizacion)
 * Body: { organizacion_id: number, nombre: string, habilitado: boolean }
 * Rutas: requireAuth + requireRole('superadmin')
 */
exports.superToggle = async (req, res) => {
  try {
    let { organizacion_id, nombre, habilitado } = req.body || {};
    if (!organizacion_id || !nombre || typeof habilitado !== 'boolean') {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    nombre = normName(nombre);
    if (!ALLOWED.has(nombre)) {
      return res.status(400).json({ error: 'Modulo invalido' });
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
    return res.status(500).json({ error: 'No se pudo actualizar el modulo' });
  }
};

/**
 * GET /modulos/:nombre/config
 * Lee la configuracion del modulo desde system_settings (key = nombre).
 * Esperado en DB (ej. flows): { fe_url: string, api_base: string }
 */
exports.getModuloConfig = async (req, res) => {
  try {
    const nombre = normName(req.params?.nombre || '');
    if (!ALLOWED.has(nombre)) {
      return res.status(400).json({ ok: false, error: 'modulo_invalido', nombre });
    }

    const { rows } = await req.db.query(
      'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
      [nombre]
    );

    const cfg = rows?.[0]?.value || null;
    if (!cfg) {
      dbg('getModuloConfig: config_not_found', { nombre });
      return res.status(404).json({ ok: false, error: 'config_not_found', nombre });
    }

    // Devolvemos plano para el FE: { ok, nombre, ...cfg }
    const out = { ok: true, nombre, ...cfg };
    dbg('getModuloConfig:', out);
    return res.json(out);
  } catch (e) {
    console.error('[getModuloConfig] Error:', e?.message);
    return res.status(500).json({ ok: false, error: e?.message || 'config_error' });
  }
};

/** Aliases para compatibilidad con codigo viejo */
exports.getMisModulos = exports.getModulos;              // antes usabas este nombre
exports.toggleModuloSuperadmin = exports.superToggle;    // alias viejo
