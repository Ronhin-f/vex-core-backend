require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("JWT_SECRET está cargada?", process.env.JWT_SECRET ? 'SI' : 'NO');
console.log("Valor JWT_SECRET:", process.env.JWT_SECRET);

if (!process.env.JWT_SECRET) {
  throw new Error("Falta la variable JWT_SECRET en el entorno de ejecución.");
}

const app = express();
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.JWT_SECRET;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://vex-core-frontend.vercel.app',
    'https://vex-core-landing.vercel.app',
    'https://vex-crm-frontend.vercel.app',
  ],
  credentials: true,
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Vex Core API online');
});

app.get('/health', (req, res) => {
  res.json({ status: 'Vex Core API OK', timestamp: new Date().toISOString() });
});

function authenticateToken(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.usuario_email = decoded.email;
    req.organizacion_id = decoded.organizacion_id;
    req.rol = decoded.rol;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token inválido' });
  }
}

// 🔒 Ruta protegida: Solo superadmins pueden ver todas las organizaciones
app.get("/superadmin/organizaciones", authenticateToken, async (req, res) => {
  if (!["admin@vex.com", "melisa@vector.inc"].includes(req.usuario_email)) {
    return res.status(403).json({ error: "Sin autorización" });
  }

  try {
    const result = await pool.query(`
      SELECT o.id, o.nombre, o.nicho, o.email_admin,
             COALESCE(json_agg(json_build_object('nombre', m.nombre, 'habilitado', m.habilitado)) FILTER (WHERE m.nombre IS NOT NULL), '[]') as modulos
      FROM organizaciones o
      LEFT JOIN modulos m ON o.id = m.organizacion_id
      GROUP BY o.id
      ORDER BY o.id;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("[GET /superadmin/organizaciones]", err);
    res.status(500).json({ error: "Error al obtener organizaciones" });
  }
});

app.post('/registro', async (req, res) => {
  const { email, password, nombre_organizacion, nombre_usuario, nicho } = req.body;
  if (!email || !password || !nombre_organizacion) {
    return res.status(400).json({ message: 'Faltan campos requeridos' });
  }
  try {
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length) return res.status(409).json({ message: 'Usuario ya existe' });

    const org = await pool.query(
      'INSERT INTO organizaciones (nombre, email_admin, nicho) VALUES ($1, $2, $3) RETURNING id',
      [nombre_organizacion, email, nicho || null]
    );
    const orgId = org.rows[0].id;

    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      `INSERT INTO usuarios (email, password, rol, nombre, organizacion_id)
       VALUES ($1, $2, 'owner', $3, $4)`,
      [email, hash, nombre_usuario || '', orgId]
    );

    const token = jwt.sign({ email, organizacion_id: orgId, rol: 'owner' }, SECRET_KEY, { expiresIn: '8h' });
    res.json({ message: 'Registrado correctamente', token });
  } catch (err) {
    console.error('[POST /registro] ', err);
    res.status(500).json({ message: 'Error interno al registrar' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(401).json({ message: 'No existe el usuario' });

    const match = bcrypt.compareSync(password, user.rows[0].password);
    if (!match) return res.status(401).json({ message: 'Contraseña incorrecta' });

    const token = jwt.sign({
      email: user.rows[0].email,
      organizacion_id: user.rows[0].organizacion_id,
      rol: user.rows[0].rol
    }, SECRET_KEY, { expiresIn: '8h' });

    res.json({ token, email: user.rows[0].email, rol: user.rows[0].rol });
  } catch (err) {
    console.error('[POST /login] ', err);
    res.status(500).json({ message: 'Error al iniciar sesión' });
  }
});

app.get('/modulos', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT nombre, habilitado FROM modulos WHERE organizacion_id = $1`,
      [req.organizacion_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /modulos] ', err);
    res.status(500).json({ message: 'Error al obtener módulos' });
  }
});

app.get('/modulos/:nombre', authenticateToken, async (req, res) => {
  const { nombre } = req.params;
  try {
    const resultado = await pool.query(
      `SELECT habilitado FROM modulos WHERE organizacion_id = $1 AND nombre = $2`,
      [req.organizacion_id, nombre]
    );
    const habilitado = resultado.rows[0]?.habilitado || false;
    res.json({ nombre, habilitado });
  } catch (err) {
    console.error('[GET /modulos/:nombre] ', err);
    res.status(500).json({ message: 'Error al verificar módulo' });
  }
});

// POST para habilitar/deshabilitar módulos
app.post("/modulos/superadmin", authenticateToken, async (req, res) => {
  const puedeVer = ["admin@vex.com", "melisa@vector.inc"];
  if (!puedeVer.includes(req.usuario_email)) {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  const { organizacion_id, nombre, habilitado } = req.body;

  try {
    const existe = await pool.query(
      "SELECT id FROM modulos WHERE organizacion_id = $1 AND nombre = $2",
      [organizacion_id, nombre]
    );

    if (existe.rows.length > 0) {
      await pool.query(
        "UPDATE modulos SET habilitado = $1 WHERE organizacion_id = $2 AND nombre = $3",
        [habilitado, organizacion_id, nombre]
      );
    } else {
      await pool.query(
        "INSERT INTO modulos (organizacion_id, nombre, habilitado) VALUES ($1, $2, $3)",
        [organizacion_id, nombre, habilitado]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[POST /modulos/superadmin]", err);
    res.status(500).json({ error: "Error al actualizar módulo" });
  }
});

app.get('/usuarios', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT email, rol, nombre FROM usuarios WHERE organizacion_id = $1 ORDER BY email`,
      [req.organizacion_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /usuarios] ', err);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

app.post('/crear-usuario', authenticateToken, async (req, res) => {
  const { email, password, nombre, rol } = req.body;
  const rolesValidos = ['admin', 'user'];
  if (!email || !password || !rolesValidos.includes(rol)) {
    return res.status(400).json({ message: 'Datos inválidos o rol no permitido' });
  }

  try {
    const creador = await pool.query('SELECT rol FROM usuarios WHERE email = $1', [req.usuario_email]);
    if (creador.rows[0].rol !== 'owner') {
      return res.status(403).json({ message: 'Solo el owner puede crear usuarios' });
    }

    const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length) return res.status(409).json({ message: 'Ese email ya está registrado' });

    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      `INSERT INTO usuarios (email, password, rol, nombre, organizacion_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [email, hash, rol, nombre || '', req.organizacion_id]
    );
    res.json({ message: 'Usuario creado correctamente' });
  } catch (err) {
    console.error('[POST /crear-usuario] ', err);
    res.status(500).json({ message: 'Error interno al crear usuario' });
  }
});

/* ----------- SUPERADMIN ----------- */

// GET organizaciones con módulos
app.get("/superadmin/organizaciones", authenticateToken, async (req, res) => {
  const puedeVer = ["admin@vex.com", "melisa@vector.inc"];
  if (!puedeVer.includes(req.usuario_email)) {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  try {
    const orgs = await db.query("SELECT * FROM organizaciones");
    const modulos = await db.query("SELECT * FROM modulos");

    const data = orgs.rows.map((org) => {
      const mods = modulos.rows.filter((m) => m.organizacion_id === org.id);
      return {
        ...org,
        modulos: mods.map(({ nombre, habilitado }) => ({ nombre, habilitado })),
      };
    });

    res.json(data);
  } catch (err) {
    console.error("[GET /superadmin/organizaciones]", err);
    res.status(500).json({ error: "Error al obtener organizaciones" });
  }
});

// POST para habilitar/deshabilitar módulos
app.post("/modulos/superadmin", authenticateToken, async (req, res) => {
  const puedeVer = ["admin@vex.com", "melisa@vector.inc"];
  if (!puedeVer.includes(req.usuario_email)) {
    return res.status(403).json({ error: "Acceso denegado" });
  }

  const { organizacion_id, nombre, habilitado } = req.body;

  try {
    const existe = await db.query(
      "SELECT id FROM modulos WHERE organizacion_id = $1 AND nombre = $2",
      [organizacion_id, nombre]
    );

    if (existe.rows.length > 0) {
      await db.query(
        "UPDATE modulos SET habilitado = $1 WHERE organizacion_id = $2 AND nombre = $3",
        [habilitado, organizacion_id, nombre]
      );
    } else {
      await db.query(
        "INSERT INTO modulos (organizacion_id, nombre, habilitado) VALUES ($1, $2, $3)",
        [organizacion_id, nombre, habilitado]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[POST /modulos/superadmin]", err);
    res.status(500).json({ error: "Error al actualizar módulo" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
