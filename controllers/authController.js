// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { isSuperadminEmail } = require('../config/superadmins');

const { JWT_SECRET } = process.env;
if (!JWT_SECRET) throw new Error("JWT_SECRET no está definido en el entorno.");

const AUTH_DEBUG = process.env.AUTH_DEBUG === '1';

function extractDomain(email = '') {
  const m = String(email).toLowerCase().trim().match(/@([^@]+)$/);
  return m ? m[1] : null;
}
function normEmail(s = '') {
  return String(s).trim().toLowerCase();
}
function looksLikeBcryptHash(s) {
  return typeof s === 'string' && /^\$2[aby]\$\d{2}\$/.test(s);
}
function dbg(...args) { if (AUTH_DEBUG) console.log('[AUTH_DEBUG]', ...args); }
function warn(...args) { console.warn('[AUTH_WARN]', ...args); }

// ===== JWT middleware =====
exports.requireAuth = (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ ok:false, error:'NO_TOKEN' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (e) {
    if (AUTH_DEBUG) console.error('[AUTH_DEBUG] requireAuth error:', e?.message);
    return res.status(401).json({ ok:false, error:'INVALID_TOKEN' });
  }
};

// ===== Diagnóstico =====
exports.me = (req, res) => {
  return res.json({ ok:true, user: req.user });
};

/* =========================
   POST /auth/login
   ========================= */
exports.login = async (req, res) => {
  const t0 = Date.now();
  try {
    let { email, password, organizacion_id } = req.body || {};
    email = normEmail(email);

    dbg('LOGIN >> email:', email, 'org:', organizacion_id || '(none)');

    if (!email || !password) {
      warn('LOGIN missing credentials', { hasEmail: !!email, hasPassword: !!password });
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const emailEsSuperadmin = isSuperadminEmail(email);

    // --- Rama con organización explícita
    if (organizacion_id) {
      const r = await req.db.query(
        'SELECT * FROM usuarios WHERE email=$1 AND organizacion_id=$2 LIMIT 1',
        [email, organizacion_id]
      );
      const u = r.rows[0];
      dbg('LOGIN with org -> found:', !!u);
      if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

      const hashed = looksLikeBcryptHash(u.password);
      dbg('LOGIN compare (with org) hashed?', hashed, 'len:', u.password ? String(u.password).length : 0);

      let ok = false;
      try { ok = hashed ? await bcrypt.compare(password, u.password) : (password === u.password); }
      catch (e) { warn('LOGIN compare error (with org):', e?.message); }

      if (!ok) {
        warn('LOGIN compare_failed (with org)', { email, method: hashed ? 'bcrypt' : 'plain-eq' });
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
      const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
      dbg('LOGIN success (with org)', { email, rolFinal, ms: Date.now() - t0 });
      return res.json({ token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
    }

    // --- Sin organización explícita
    const all = await req.db.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    dbg('LOGIN no-org rows:', all.rowCount);

    if (all.rowCount === 0) {
      warn('LOGIN user_not_found', { email });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (all.rowCount > 1) {
      const { rows: opciones } = await req.db.query(
        `SELECT u.organizacion_id, o.nombre
         FROM usuarios u
         JOIN organizaciones o ON o.id = u.organizacion_id
         WHERE u.email = $1
         ORDER BY o.nombre ASC`,
        [email]
      );
      dbg('LOGIN multi-org -> opciones:', opciones.length);
      return res.status(409).json({
        error: 'El email pertenece a varias organizaciones. Seleccione una.',
        opciones
      });
    }

    const u = all.rows[0];
    const hashed = looksLikeBcryptHash(u.password);
    dbg('LOGIN compare hashed?', hashed, 'len:', u.password ? String(u.password).length : 0);

    let ok = false;
    try { ok = hashed ? await bcrypt.compare(password, u.password) : (password === u.password); }
    catch (e) { warn('LOGIN compare error:', e?.message); }

    if (!ok) {
      warn('LOGIN compare_failed', { email, method: hashed ? 'bcrypt' : 'plain-eq' });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
    const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    dbg('LOGIN success', { email, rolFinal, org: u.organizacion_id, super: emailEsSuperadmin, ms: Date.now() - t0 });
    return res.json({ token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
  } catch (error) {
    warn('LOGIN unhandled error:', error?.message);
    if (process.env.NODE_ENV !== 'production') console.error('[authController/login] Error:', error);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
};

/* =========================
   POST /auth/register
   ========================= */
exports.register = async (req, res) => {
  const client = await req.db.connect();
  try {
    if (AUTH_DEBUG) {
      dbg('REGISTER body:', {
        email: req.body?.email,
        nombre: req.body?.nombre,
        organizacion_id: req.body?.organizacion_id,
      });
    }

    let { email, password, nombre, rol } = req.body || {};
    let { organizacion_id, organizacion, nombre_organizacion } = req.body || {};

    email = normEmail(email);
    nombre = String(nombre || '').trim();

    if (!email || !password || !nombre) {
      warn('REGISTER missing fields', { hasEmail: !!email, hasPassword: !!password, hasNombre: !!nombre });
      return res.status(400).json({ error: 'Faltan datos: nombre, email y contraseña son obligatorios' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const dom = extractDomain(email);
    if (!dom) return res.status(400).json({ error: 'Email inválido' });

    // dominio público (si existe la tabla)
    let isPublicDomain = false;
    try {
      const pub = await req.db.query('SELECT 1 FROM dominios_publicos WHERE dominio=$1', [dom]);
      isPublicDomain = pub.rowCount > 0;
    } catch (e) {
      if (e?.code !== '42P01') throw e;
      isPublicDomain = false;
    }

    await client.query('BEGIN');

    let createdOrgNow = false;

    // Resolver organización (si existe tabla de dominios)
    if (!organizacion_id) {
      let domRow = { rowCount: 0, rows: [] };
      try {
        domRow = await client.query(
          `SELECT organizacion_id FROM organizacion_dominios WHERE dominio=$1`,
          [dom]
        );
      } catch (e) {
        if (e?.code !== '42P01') throw e;
      }

      if (domRow.rowCount > 0) {
        organizacion_id = domRow.rows[0].organizacion_id;
      } else if (!isPublicDomain) {
        const orgName = (organizacion || nombre_organizacion || dom.split('.')[0]).trim() || dom;
        const orgIns = await client.query(
          `INSERT INTO organizaciones (nombre, estado) VALUES ($1, 'pending') RETURNING id`,
          [orgName]
        );
        organizacion_id = orgIns.rows[0].id;
        createdOrgNow = true;

        const token = crypto.randomBytes(12).toString('hex');
        try {
          await client.query(
            `INSERT INTO organizacion_dominios (organizacion_id, dominio, verificado, metodo_verificacion, token_verificacion)
             VALUES ($1, $2, false, 'dns', $3)`,
            [organizacion_id, dom, token]
          );
        } catch (e) {
          if (e?.code !== '42P01') throw e;
        }
      } else {
        const orgIns = await client.query(
          `INSERT INTO organizaciones (nombre, estado) VALUES ($1, 'active') RETURNING id`,
          [`${nombre} (Personal)`]
        );
        organizacion_id = orgIns.rows[0].id;
        createdOrgNow = true;
      }
    }

    if (!rol) rol = createdOrgNow ? 'owner' : 'user';
    if (isSuperadminEmail(email)) rol = 'superadmin';

    const dupe = await client.query(
      'SELECT 1 FROM usuarios WHERE email=$1 AND organizacion_id=$2',
      [email, organizacion_id]
    );
    if (dupe.rowCount) {
      await client.query('ROLLBACK');
      warn('REGISTER duplicate', { email, organizacion_id });
      return res.status(409).json({ error: 'El email ya existe en esa organización' });
    }

    const hashed = await bcrypt.hash(password, 10); // guardamos hash en "password"
    const insert = `
      INSERT INTO usuarios (email, password, nombre, rol, organizacion_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING email, nombre, rol, organizacion_id
    `;
    const { rows } = await client.query(insert, [email, hashed, nombre, rol, organizacion_id]);

    await client.query('COMMIT');

    dbg('REGISTER success', { email, rol, organizacion_id, createdOrgNow });
    return res.status(201).json({
      message: 'Usuario registrado con éxito',
      usuario: rows[0],
      onboarding: { dominio: dom, posible_org_por_dominio: !isPublicDomain }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    warn('REGISTER error', error?.code, error?.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authController/register] Error:', error?.code, error?.message);
    }

    if (error?.code === '23505') return res.status(409).json({ error: 'El email ya existe' });
    if (error?.code === '23503') return res.status(400).json({ error: 'Organización inválida' });

    return res.status(500).json({ error: 'Error interno al registrar usuario' });
  } finally {
    client.release();
  }
};
