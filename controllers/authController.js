// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { isSuperadminEmail } = require('../config/superadmins');

const { JWT_SECRET } = process.env;
if (!JWT_SECRET) throw new Error("JWT_SECRET no está definido en el entorno.");

function extractDomain(email = '') {
  const m = String(email).toLowerCase().trim().match(/@([^@]+)$/);
  return m ? m[1] : null;
}
function normEmail(s = '') {
  return String(s).trim().toLowerCase();
}

/* =========================
   POST /auth/login
   ========================= */
exports.login = async (req, res) => {
  try {
    let { email, password, organizacion_id } = req.body || {};
    email = normEmail(email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Alineación de superadmin (si corresponde)
    const emailEsSuperadmin = isSuperadminEmail(email);

    // Priorizar organizacion_id si viene
    if (organizacion_id) {
      const r = await req.db.query(
        'SELECT * FROM usuarios WHERE email=$1 AND organizacion_id=$2',
        [email, organizacion_id]
      );
      const u = r.rows[0];
      if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

      const ok = await bcrypt.compare(password, u.password);
      if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

      const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
      const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
      return res.json({ token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
    }

    // Sin organizacion_id: puede haber N orgs para ese email
    const all = await req.db.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    if (all.rowCount === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (all.rowCount > 1) {
      // Devolver opciones con nombres de ORGANIZACIONES (no del usuario)
      const { rows: opciones } = await req.db.query(
        `SELECT u.organizacion_id, o.nombre
         FROM usuarios u
         JOIN organizaciones o ON o.id = u.organizacion_id
         WHERE u.email = $1
         ORDER BY o.nombre ASC`,
        [email]
      );
      return res.status(409).json({
        error: 'El email pertenece a varias organizaciones. Seleccione una.',
        opciones
      });
    }

    const u = all.rows[0];
    const ok = await bcrypt.compare(password, u.password);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const rolFinal = emailEsSuperadmin ? 'superadmin' : u.rol;
    const payload = { email: u.email, rol: rolFinal, organizacion_id: u.organizacion_id, nombre: u.nombre };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, user: payload, userEncoded: encodeURIComponent(JSON.stringify(payload)) });
  } catch (error) {
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
    if (process.env.NODE_ENV !== 'production') {
      console.log('[REGISTER] raw body:', req.body);
    }

    let { email, password, nombre, rol } = req.body || {};
    let { organizacion_id, organizacion, nombre_organizacion } = req.body || {};

    email = normEmail(email);
    nombre = String(nombre || '').trim();

    // Validaciones básicas → 400
    if (!email || !password || !nombre) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[REGISTER] faltan campos', { email: !!email, password: !!password, nombre: !!nombre });
      }
      return res.status(400).json({ error: 'Faltan datos: nombre, email y contraseña son obligatorios' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const dom = extractDomain(email);
    if (!dom) return res.status(400).json({ error: 'Email inválido' });

    // ¿dominio público?
    const pub = await req.db.query('SELECT 1 FROM dominios_publicos WHERE dominio=$1', [dom]);
    const isPublicDomain = pub.rowCount > 0;

    await client.query('BEGIN');

    let createdOrgNow = false;

    // Resolver organización:
    // 1) Si mandan organizacion_id, usarlo (se valida al insertar usuario por FK).
    // 2) Si no, ver si el dominio está reclamado (organizacion_dominios).
    // 3) Si dominio no público → crear org y registrar dominio no verificado.
    // 4) Si dominio público → crear org "Personal".
    if (!organizacion_id) {
      const domRow = await client.query(
        `SELECT organizacion_id FROM organizacion_dominios WHERE dominio=$1`,
        [dom]
      );

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
        await client.query(
          `INSERT INTO organizacion_dominios (organizacion_id, dominio, verificado, metodo_verificacion, token_verificacion)
           VALUES ($1, $2, false, 'dns', $3)`,
          [organizacion_id, dom, token]
        );
      } else {
        const orgIns = await client.query(
          `INSERT INTO organizaciones (nombre, estado) VALUES ($1, 'active') RETURNING id`,
          [`${nombre} (Personal)`]
        );
        organizacion_id = orgIns.rows[0].id;
        createdOrgNow = true;
      }
    }

    // Rol por defecto
    if (!rol) {
      rol = createdOrgNow ? 'owner' : 'user';
    }

    // Forzar superadmin si está whitelisteado
    if (isSuperadminEmail(email)) {
      rol = 'superadmin';
    }

    // Duplicado dentro de la org → 409
    const dupe = await client.query(
      'SELECT 1 FROM usuarios WHERE email=$1 AND organizacion_id=$2',
      [email, organizacion_id]
    );
    if (dupe.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El email ya existe en esa organización' });
    }

    // Insert usuario
    const hashed = await bcrypt.hash(password, 10);
    const insert = `
      INSERT INTO usuarios (email, password, nombre, rol, organizacion_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING email, nombre, rol, organizacion_id
    `;
    const { rows } = await client.query(insert, [email, hashed, nombre, rol, organizacion_id]);

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Usuario registrado con éxito',
      usuario: rows[0],
      onboarding: { dominio: dom, posible_org_por_dominio: !isPublicDomain }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (process.env.NODE_ENV !== 'production') console.error('[authController/register] Error:', error);

    // Cuando venga de Postgres con código de error específico
    if (error?.code === '23505') {
      // unique_violation
      return res.status(409).json({ error: 'El email ya existe' });
    }
    return res.status(500).json({ error: 'Error interno al registrar usuario' });
  } finally {
    client.release();
  }
};
