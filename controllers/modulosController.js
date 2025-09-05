// controllers/modulosController.js
const MOD_DEBUG = process.env.MODULOS_DEBUG === '1';
const dbg = (...a) => MOD_DEBUG && console.log('[MODULOS]', ...a);

/**
 * GET /modulos
 * Devuelve los módulos de la organización del usuario autenticado.
 * - Si el usuario no tiene organizacion_id (p.ej. superadmin “global”), devolvemos [].
 * Respuesta: [{ nombre, habilitado }, ...]
 */
exports.getMisModulos = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) {
      // Superadmin sin org asignada: no hay módulos que mostrar por org
      dbg('getMisModulos: user without organizacion_id → []');
      return res.json([]);
    }

    const { rows } = await req.db.query(
      `SELECT nombre, habilitado
         FROM modulos
        WHERE organizacion_id = $1
        ORDER BY nombre`,
      [orgId]
    );

    const out = rows.map(r => ({ nombre: r.nombre, habilitado: !!r.habilitado }));
    dbg('getMisModulos:', { orgId, count: out.length });
    return res.json(out);
  } catch (e) {
    console.error('[getMisModulos] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudieron cargar los módulos' });
  }
};

/**
 * GET /modulos/:nombre
 * Estado de un módulo por nombre para la org del usuario autenticado.
 * Respuesta: { nombre, habilitado }
 */
exports.getModuloByNombre = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    const { nombre } = req.params || {};
    if (!orgId) {
      return res.status(401).json({ error: 'No autorizado: falta organización' });
    }
    if (!nombre) {
      return res.status(400).json({ error: 'Nombre de módulo requerido' });
    }

    const { rows } = await req.db.query(
      `SELECT habilitado
         FROM modulos
        WHERE organizacion_id = $1
          AND nombre = $2
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
 * POST /modulos/toggle  (owner de su propia org)
 * Body: { nombre: string, habilitado: boolean }
 * Requiere: requireAuth + requireRole('owner') en rutas.
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
      RETURNING *
      )
      INSERT INTO modulos (organizacion_id, nombre, habilitado)
      SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM up)
      RETURNING *;
    `;
    const { rows } = await req.db.query(q, [orgId, nombre, habilitado]);
    dbg('ownerToggle', { orgId, nombre, habilitado });

    return res.json({ ok: true, modulo: rows[0] || null });
  } catch (e) {
    console.error('[ownerToggle] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudo actualizar el módulo' });
  }
};

/**
 * POST /modulos/superadmin  (puede tocar cualquier organización)
 * Body: { organizacion_id: number, nombre: string, habilitado: boolean }
 * Requiere: requireAuth + requireRole('superadmin') en rutas.
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
      RETURNING *
      )
      INSERT INTO modulos (organizacion_id, nombre, habilitado)
      SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM up)
      RETURNING *;
    `;
    const { rows } = await req.db.query(q, [organizacion_id, nombre, habilitado]);
    dbg('superToggle', { organizacion_id, nombre, habilitado });

    return res.json({ ok: true, modulo: rows[0] || null });
  } catch (e) {
    console.error('[superToggle] Error:', e?.message);
    return res.status(500).json({ error: 'No se pudo actualizar el módulo' });
  }
};

/* ====== Aliases para compatibilidad con código viejo ====== */
// Antes devolvías objeto plano { nombre: habilitado }. Lo mantenemos como alias opcional.
exports.getModulos = async (req, res) => {
  try {
    const orgId = req.user?.organizacion_id;
    if (!orgId) return res.status(401).json({ error: 'No autorizado: falta organización' });

    const { rows } = await req.db.query(
      `SELECT nombre, habilitado
         FROM modulos
        WHERE organizacion_id = $1`,
      [orgId]
    );
    const plano = {};
    for (const r of rows) plano[r.nombre] = !!r.habilitado;
    dbg('getModulos (alias):', { orgId, keys: Object.keys(plano).length });
    return res.json(plano);
  } catch (e) {
    console.error('[getModulos alias] Error:', e?.message);
    return res.status(500).json({ error: 'Error al obtener módulos' });
  }
};

// Alias del toggle de superadmin antiguo
exports.toggleModuloSuperadmin = exports.superToggle;
