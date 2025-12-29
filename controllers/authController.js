// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const { isSuperadminEmail } = require('../config/superadmins');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { enqueueEmailOutbox } = require('../utils/emailOutbox');

const { JWT_SECRET } = process.env;
if (!JWT_SECRET) throw new Error('JWT_SECRET no esta definido en el entorno.');

const AUTH_DEBUG = process.env.AUTH_DEBUG === '1';
const JWT_ISSUER = process.env.JWT_ISSUER || 'vex-core';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'vex-core-clients';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_OPTS = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };
const JWT_VERIFY_OPTIONS = { ...JWT_OPTS, algorithms: ['HS256'] };
const RESET_TTL_MIN = Number(process.env.PASSWORD_RESET_TTL_MIN || 60);
const RESET_URL_BASE = process.env.PASSWORD_RESET_URL_BASE || null;
const RESET_WEBHOOK_URL = process.env.PASSWORD_RESET_WEBHOOK_URL || null;
const RESET_WEBHOOK_SECRET = process.env.PASSWORD_RESET_WEBHOOK_SECRET || null;

const ALLOW_PLAIN_PASSWORD = false;
if (process.env.AUTH_ALLOW_PLAIN === '1') {
  console.warn('[AUTH] AUTH_ALLOW_PLAIN ignorado: passwords en texto plano deshabilitados');
}

function signToken(payload) {
  const jti = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { ...JWT_OPTS, expiresIn: JWT_EXPIRES_IN });
}

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

function isStrongPassword(pw = '') {
  return pw.length >= 12 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function ensureResetTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      organizacion_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_email_org ON password_resets (email, organizacion_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash);
  `);
}

async function getOrgOptionsByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT u.organizacion_id, o.nombre AS organizacion_nombre
       FROM usuarios u
       JOIN organizaciones o ON o.id = u.organizacion_id
      WHERE u.email = $1
      ORDER BY o.nombre ASC`,
    [email]
  );
  return rows || [];
}

// Reexportamos middlewares unicos
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;

/* =========================
   Diagnostico
   ========================= */
exports.me = (req, res) => {
  return res.json({ ok: true, user: req.user });
};

/* =========================
   GET /auth/introspect  (JWT only)
   Respuesta esperada por Flows: { valid, user_email, role, org_id }
   ========================= */
exports.introspect = (req, res) => {
  try {
    const h = req.headers.authorization || req.headers.Authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token) return res.status(401).json({ valid: false, active: false, error: 'missing_token' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
    } catch (e) {
      if (AUTH_DEBUG) console.error('[AUTH_DEBUG] introspect invalid:', e?.message);
      return res.status(401).json({ valid: false, active: false, error: 'invalid_token' });
    }

    const email = normEmail(payload.email || payload.user_email || '');
    const org_id = payload.organizacion_id ?? payload.org_id ?? null;

    let role = payload.rol || payload.role || 'user';
    if (isSuperadminEmail(email)) role = 'superadmin';

    return res.json({
      valid: true,
      active: true,
      user_email: email,
      role,
      org_id,
      isService: false,
    });
  } catch (err) {
    console.error('[INTROSPECT_ERROR]', err);
    return res.status(500).json({ valid: false, active: false, error: 'introspect_error' });
  }
};

/* =========================
   POST /auth/login
   ========================= */
exports.login = async (req, res) => {
  const t0 = Date.now();
  try {
    let { email, password, organizacion_id } = req.body || {};
    email = normEmail(email);

    if (organizacion_id !== undefined && organizacion_id !== null) {
      const n = Number(organizacion_id);
      organizacion_id = Number.isFinite(n) ? n : organizacion_id;
    }

    dbg('LOGIN >> email:', email, 'org:', organizacion_id || '(none)');

    if (!email || !password) {
      warn('LOGIN missing credentials', { hasEmail: !!email, hasPassword: !!password });
      return res.status(400).json({ ok: false, error: 'Email y contrasena son requeridos' });
    }

    const emailEsSuperadmin = isSuperadminEmail(email);

    // --- Rama con organizacion explicita
    if (organizacion_id) {
      const r = await req.db.query(
        'SELECT * FROM usuarios WHERE email=$1 AND organizacion_id=$2 LIMIT 1',
        [email, organizacion_id]
      );
      const u = r.rows[0];
      dbg('LOGIN with org -> found:', !!u);
      if (!u) return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });

      const hashed = looksLikeBcryptHash(u.password);
      dbg('LOGIN compare (with org) hashed?', hashed, 'len:', u.password ? String(u.password).length : 0);

      if (!hashed && !ALLOW_PLAIN_PASSWORD) {
        warn('LOGIN insecure_password_storage (org)', { email, organizacion_id });
        return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
      }

      let ok = false;
      try {
        ok = hashed ? await bcrypt.compare(password, u.password) : (password === u.password);
      } catch (e) {
        warn('LOGIN compare error (with org):', e?.message);
      }

      if (!ok) {
        warn('LOGIN compare_failed (with org)', { email, method: hashed ? 'bcrypt' : 'plain-eq' });
        return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
      }

      const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
      const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
      const token = signToken(payload);
      dbg('LOGIN success (with org)', { email, rolFinal, ms: Date.now() - t0 });
      return res.json({ ok: true, token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
    }

    // --- Sin organizacion explicita
    const all = await req.db.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    dbg('LOGIN no-org rows:', all.rowCount);

    if (all.rowCount === 0) {
      warn('LOGIN user_not_found', { email });
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }

    if (all.rowCount > 1) {
      // Seguridad: validar contrasena antes de listar organizaciones
      let passwordMatch = false;
      for (const u of all.rows) {
        const hashed = looksLikeBcryptHash(u.password);
        if (!hashed && !ALLOW_PLAIN_PASSWORD) {
          warn('LOGIN insecure_password_storage (multi)', { email, org: u.organizacion_id });
          continue;
        }
        try {
          const ok = hashed ? await bcrypt.compare(password, u.password) : (password === u.password);
          if (ok) { passwordMatch = true; break; }
        } catch (e) {
          warn('LOGIN compare error (multi-org loop):', e?.message);
        }
      }
      if (!passwordMatch) {
        warn('LOGIN compare_failed (multi-org)');
        return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
      }

      const { rows: opciones } = await req.db.query(
        `SELECT u.organizacion_id, o.nombre AS organizacion_nombre
         FROM usuarios u
         JOIN organizaciones o ON o.id = u.organizacion_id
         WHERE u.email = $1
         ORDER BY o.nombre ASC`,
        [email]
      );
      dbg('LOGIN multi-org -> opciones:', opciones.length);
      return res.status(409).json({
        ok: false,
        needs_org: true,
        opciones, // [{organizacion_id, organizacion_nombre}]
        error: 'El email pertenece a varias organizaciones. Seleccione una.',
      });
    }

    // Unica organizacion
    const u = all.rows[0];
    const hashed = looksLikeBcryptHash(u.password);
    dbg('LOGIN compare hashed?', hashed, 'len:', u.password ? String(u.password).length : 0);

    if (!hashed && !ALLOW_PLAIN_PASSWORD) {
      warn('LOGIN insecure_password_storage (single)', { email, org: u.organizacion_id });
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }

    let ok = false;
    try { ok = hashed ? await bcrypt.compare(password, u.password) : (password === u.password); }
    catch (e) { warn('LOGIN compare error:', e?.message); }

    if (!ok) {
      warn('LOGIN compare_failed', { email, method: hashed ? 'bcrypt' : 'plain-eq' });
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }

    const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
    const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
    const token = signToken(payload);

    dbg('LOGIN success', { email, rolFinal, org: u.organizacion_id, super: emailEsSuperadmin, ms: Date.now() - t0 });
    return res.json({ ok: true, token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
  } catch (error) {
    warn('LOGIN unhandled error:', error?.message);
    if (process.env.NODE_ENV !== 'production') console.error('[authController/login] Error:', error);
    res.status(500).json({ ok: false, error: 'Error interno al iniciar sesion' });
  }
};

/* =========================
   POST /auth/password-reset/request
   ========================= */
exports.requestPasswordReset = async (req, res) => {
  try {
    let { email, organizacion_id, reset_url_base } = req.body || {};
    email = normEmail(email);

    if (organizacion_id !== undefined && organizacion_id !== null) {
      const n = Number(organizacion_id);
      organizacion_id = Number.isFinite(n) ? n : organizacion_id;
    }

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email requerido' });
    }

    await ensureResetTable(req.db);

    // Buscar org si no viene
    if (!organizacion_id) {
      const opciones = await getOrgOptionsByEmail(req.db, email);
      if (opciones.length > 1) {
        return res.status(409).json({
          ok: false,
          needs_org: true,
          opciones,
          error: 'El email pertenece a varias organizaciones. Seleccione una.',
        });
      }
      if (opciones.length === 1) {
        organizacion_id = opciones[0].organizacion_id;
      }
    }

    // No revelar existencia de usuario
    if (!organizacion_id) {
      return res.json({ ok: true, message: 'Si el email existe, vas a recibir instrucciones.' });
    }

    const user = await req.db.query(
      'SELECT 1 FROM usuarios WHERE email=$1 AND organizacion_id=$2 LIMIT 1',
      [email, organizacion_id]
    );
    if (!user.rowCount) {
      return res.json({ ok: true, message: 'Si el email existe, vas a recibir instrucciones.' });
    }

    // Invalidar tokens previos
    await req.db.query(
      'UPDATE password_resets SET used_at=now() WHERE email=$1 AND organizacion_id=$2 AND used_at IS NULL',
      [email, organizacion_id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);

    await req.db.query(
      `INSERT INTO password_resets (email, organizacion_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, organizacion_id, tokenHash, expiresAt]
    );

    let orgName = null;
    try {
      const orgRow = await req.db.query('SELECT nombre FROM organizaciones WHERE id=$1 LIMIT 1', [organizacion_id]);
      orgName = orgRow.rows?.[0]?.nombre || null;
    } catch {}

    const base = reset_url_base || RESET_URL_BASE || null;
    const resetUrl = base
      ? `${String(base).replace(/\/+$/, '')}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(
          email
        )}&org=${encodeURIComponent(String(organizacion_id))}`
      : null;

    // Webhook opcional para enviar email
    let webhookOk = false;
    if (RESET_WEBHOOK_URL) {
      try {
        await axios.post(
          RESET_WEBHOOK_URL,
          {
            email,
            organizacion_id,
            organizacion_nombre: orgName,
            reset_url: resetUrl,
            token,
            expires_at: expiresAt.toISOString(),
          },
          {
            headers: RESET_WEBHOOK_SECRET ? { 'X-Webhook-Secret': RESET_WEBHOOK_SECRET } : undefined,
            timeout: 8000,
          }
        );
        webhookOk = true;
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[password-reset webhook]', e?.message || e);
        }
      }
    }

    if (!webhookOk) {
      await enqueueEmailOutbox(req.db, {
        organizacion_id,
        to_email: email,
        template: 'password_reset',
        payload: {
          organizacion_nombre: orgName,
          reset_url: resetUrl,
          token,
          expires_at: expiresAt.toISOString(),
        },
      }).catch((e) => {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[password-reset outbox]', e?.message || e);
        }
      });
    }

    return res.json({ ok: true, message: 'Si el email existe, vas a recibir instrucciones.' });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[password-reset request]', e?.message || e);
    }
    return res.status(500).json({ ok: false, error: 'Error interno al solicitar reset' });
  }
};

/* =========================
   POST /auth/password-reset/confirm
   ========================= */
exports.confirmPasswordReset = async (req, res) => {
  try {
    let { email, organizacion_id, token, new_password } = req.body || {};
    email = normEmail(email);

    if (organizacion_id !== undefined && organizacion_id !== null) {
      const n = Number(organizacion_id);
      organizacion_id = Number.isFinite(n) ? n : organizacion_id;
    }

    if (!email || !token || !new_password) {
      return res.status(400).json({ ok: false, error: 'Faltan parametros' });
    }
    if (!isStrongPassword(new_password)) {
      return res.status(400).json({
        ok: false,
        error: 'Password debe tener minimo 12 caracteres, letras y numeros',
      });
    }

    await ensureResetTable(req.db);

    if (!organizacion_id) {
      const opciones = await getOrgOptionsByEmail(req.db, email);
      if (opciones.length !== 1) {
        return res.status(400).json({ ok: false, error: 'organizacion_id requerido' });
      }
      organizacion_id = opciones[0].organizacion_id;
    }

    const tokenHash = hashResetToken(token);
    const r = await req.db.query(
      `SELECT id, expires_at
         FROM password_resets
        WHERE email=$1 AND organizacion_id=$2 AND token_hash=$3 AND used_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [email, organizacion_id, tokenHash]
    );
    const row = r.rows[0];
    if (!row) return res.status(400).json({ ok: false, error: 'Token invalido' });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, error: 'Token expirado' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await req.db.query(
      'UPDATE usuarios SET password=$1 WHERE email=$2 AND organizacion_id=$3',
      [hashed, email, organizacion_id]
    );

    await req.db.query('UPDATE password_resets SET used_at=now() WHERE id=$1', [row.id]);

    return res.json({ ok: true, message: 'Password actualizada' });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[password-reset confirm]', e?.message || e);
    }
    return res.status(500).json({ ok: false, error: 'Error interno al confirmar reset' });
  }
};

/* =========================
   POST /auth/change-password
   ========================= */
exports.changePassword = async (req, res) => {
  try {
    const email = req.user?.email;
    const orgId = req.user?.organizacion_id;
    const { old_password, new_password } = req.body || {};

    if (!email || !orgId) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (!old_password || !new_password) {
      return res.status(400).json({ ok: false, error: 'Faltan parametros' });
    }

    const strong = new_password.length >= 12 && /[A-Za-z]/.test(new_password) && /\d/.test(new_password);
    if (!strong) {
      return res.status(400).json({ ok: false, error: 'Password debe tener minimo 12 caracteres, letras y numeros' });
    }

    const { rows } = await req.db.query(
      'SELECT password FROM usuarios WHERE email=$1 AND organizacion_id=$2 LIMIT 1',
      [email, orgId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    if (!looksLikeBcryptHash(user.password)) {
      return res.status(403).json({ ok: false, error: 'Password legacy invalido, contacta soporte' });
    }

    const ok = await bcrypt.compare(old_password, user.password);
    if (!ok) return res.status(401).json({ ok: false, error: 'Password actual incorrecto' });

    const hashed = await bcrypt.hash(new_password, 12);
    await req.db.query(
      'UPDATE usuarios SET password=$1 WHERE email=$2 AND organizacion_id=$3',
      [hashed, email, orgId]
    );

    // Opcional: invalidar tokens viejos guardando jti en blacklist
    return res.json({ ok: true, message: 'Password actualizada' });
  } catch (err) {
    console.error('[changePassword]', err?.message);
    return res.status(500).json({ ok: false, error: 'Error al cambiar password' });
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
    const areaVerticalReq = normalizeAreaVertical(req.body?.area_vertical);
    const habilitaHistoriasReq = normalizeFlag(req.body?.habilita_historias_clinicas);
    const habilitaFichaMascotasReq = normalizeFlag(req.body?.habilita_ficha_mascotas);
    const habilitaRecordatoriosVacunasReq = normalizeFlag(req.body?.habilita_recordatorios_vacunas);

    email = normEmail(email);
    nombre = String(nombre || '').trim();

    if (!email || !password || !nombre) {
      warn('REGISTER missing fields', { hasEmail: !!email, hasPassword: !!password, hasNombre: !!nombre });
      return res.status(400).json({ ok: false, error: 'Faltan datos: nombre, email y contrasena son obligatorios' });
    }
    const strongPassword = password.length >= 12 && /[A-Za-z]/.test(password) && /\d/.test(password);
    if (!strongPassword) {
      return res.status(400).json({
        ok: false,
        error: 'La contrasena debe tener minimo 12 caracteres, letras y numeros'
      });
    }

    const dom = extractDomain(email);
    if (!dom) return res.status(400).json({ ok: false, error: 'Email invalido' });

    let isPublicDomain = false;
    try {
      const pub = await req.db.query('SELECT 1 FROM dominios_publicos WHERE dominio=$1', [dom]);
      isPublicDomain = pub.rowCount > 0;
    } catch (e) {
      if (e?.code !== '42P01') throw e; // tabla opcional
      isPublicDomain = false;
    }

    await client.query('BEGIN');

    let createdOrgNow = false;
    let orgNombreCreada = null;

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
        orgNombreCreada = orgName;

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
        const orgNamePersonal = `${nombre} (Personal)`;
        const orgIns = await client.query(
          `INSERT INTO organizaciones (nombre, estado) VALUES ($1, 'active') RETURNING id`,
          [orgNamePersonal]
        );
        organizacion_id = orgIns.rows[0].id;
        createdOrgNow = true;
        orgNombreCreada = orgNamePersonal;
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
      return res.status(409).json({ ok: false, error: 'El email ya existe en esa organizacion' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const insert = `
      INSERT INTO usuarios (email, password, nombre, rol, organizacion_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING email, nombre, rol, organizacion_id
    `;
    const { rows } = await client.query(insert, [email, hashed, nombre, rol, organizacion_id]);

    if (createdOrgNow) {
      const finalNombreOrg = orgNombreCreada || organizacion || nombre_organizacion || nombre || 'Organizacion';
      const vetFlags = await supportsVetFlags(client);
      try {
        if (vetFlags) {
          await client.query(
            `INSERT INTO organizacion_perfil (organizacion_id, nombre_publico, area_vertical, habilita_historias_clinicas, habilita_ficha_mascotas, habilita_recordatorios_vacunas, updated_at)
             VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, false), COALESCE($6, false), NOW())
             ON CONFLICT (organizacion_id)
             DO UPDATE SET
               nombre_publico = COALESCE(organizacion_perfil.nombre_publico, EXCLUDED.nombre_publico),
               area_vertical = COALESCE(EXCLUDED.area_vertical, organizacion_perfil.area_vertical),
               habilita_historias_clinicas = COALESCE(EXCLUDED.habilita_historias_clinicas, organizacion_perfil.habilita_historias_clinicas),
               habilita_ficha_mascotas = COALESCE(EXCLUDED.habilita_ficha_mascotas, organizacion_perfil.habilita_ficha_mascotas),
               habilita_recordatorios_vacunas = COALESCE(EXCLUDED.habilita_recordatorios_vacunas, organizacion_perfil.habilita_recordatorios_vacunas),
               updated_at = NOW()`,
            [
              organizacion_id,
              finalNombreOrg,
              areaVerticalReq,
              habilitaHistoriasReq === null ? null : !!habilitaHistoriasReq,
              habilitaFichaMascotasReq === null ? null : !!habilitaFichaMascotasReq,
              habilitaRecordatoriosVacunasReq === null ? null : !!habilitaRecordatoriosVacunasReq,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO organizacion_perfil (organizacion_id, nombre_publico, area_vertical, habilita_historias_clinicas, updated_at)
             VALUES ($1, $2, $3, COALESCE($4, false), NOW())
             ON CONFLICT (organizacion_id)
             DO UPDATE SET
               nombre_publico = COALESCE(organizacion_perfil.nombre_publico, EXCLUDED.nombre_publico),
               area_vertical = COALESCE(EXCLUDED.area_vertical, organizacion_perfil.area_vertical),
               habilita_historias_clinicas = COALESCE(EXCLUDED.habilita_historias_clinicas, organizacion_perfil.habilita_historias_clinicas),
               updated_at = NOW()`,
            [
              organizacion_id,
              finalNombreOrg,
              areaVerticalReq,
              habilitaHistoriasReq === null ? null : !!habilitaHistoriasReq,
            ]
          );
        }
      } catch (e) {
        if (e?.code !== '42P01' && e?.code !== '42703') throw e; // tabla aun no migrada o columnas faltantes
      }
    }

    await client.query('COMMIT');

    dbg('REGISTER success', { email, rol, organizacion_id, createdOrgNow });
    return res.status(201).json({
      ok: true,
      message: 'Usuario registrado con exito',
      usuario: rows[0],
      onboarding: { dominio: dom, posible_org_por_dominio: !isPublicDomain }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    warn('REGISTER error', error?.code, error?.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authController/register] Error:', error?.code, error?.message);
    }

    if (error?.code === '23505') return res.status(409).json({ ok: false, error: 'El email ya existe' });
    if (error?.code === '23503') return res.status(400).json({ ok: false, error: 'Organizacion invalida' });

    return res.status(500).json({ ok: false, error: 'Error interno al registrar usuario' });
  } finally {
    client.release();
  }
};
