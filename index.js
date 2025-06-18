require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// 🚨 Sin defaults, explota si no hay JWT_SECRET
if (!process.env.JWT_SECRET) {
  throw new Error("Falta la variable JWT_SECRET en el entorno de ejecución.");
}
const SECRET_KEY = process.env.JWT_SECRET;

// Pool de Postgres (ajustado para Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://vex-core-frontend.vercel.app',
    'https://vex-core-landing.vercel.app'
  ],
  credentials: true,
}));
app.use(express.json());

// Ruta raíz y healthcheck para debugging rápido
app.get('/', (req, res) => {
  res.send('Vex Core API online');
});
app.get('/health', (req, res) => {
  res.json({ status: 'Vex Core API OK', timestamp: new Date().toISOString() });
});

// Middleware de autenticación JWT
function authenticateToken(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ message: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.usuario_email = decoded.email;
    req.organizacion_id = decoded.organizacion_id;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token inválido' });
  }
}

// Registro de usuario y organización
app.post('/registro', async (req, res) => {
  const { email, password, nombre_organizacion, nombre_usuario } = req.body;
  if (!email || !password || !nombre_organizacion) {
    return res.status(400).json({ message: 'Faltan campos requeridos' });
  }

  try {
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length) return res.status(409).json({ message: 'Usuario ya existe' });

    // Crea la organización
    const org = await pool.query(
      'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id',
      [nombre_organizacion]
    );
    const orgId = org.rows[0].id;

    // Crea el usuario owner
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      `INSERT INTO usuarios (email, password, rol, nombre, organizacion_id)
       VALUES ($1, $2, 'owner', $3, $4)`,
      [email, hash, nombre_usuario || '', orgId]
    );

    const token = jwt.sign({ email, organizacion_id: orgId }, SECRET_KEY, { expiresIn: '8h' });
    res.json({ message: 'Registrado correctamente', token });
  } catch (err) {
    console.error('[POST /registro] ', err);
    res.status(500).json({ message: 'Error interno al registrar' });
  }
});

// Login de usuario
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

// Obtención de módulos habilitados
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

// Actualización/alta de módulos (solo owner)
app.post('/modulos', authenticateToken, async (req, res) => {
  const { nombre, habilitado } = req.body;
  try {
    const user = await pool.query(
      'SELECT rol FROM usuarios WHERE email = $1',
      [req.usuario_email]
    );
    if (user.rows[0].rol !== 'owner') {
      return res.status(403).json({ message: 'No autorizado' });
    }

    await pool.query(
      `INSERT INTO modulos (organizacion_id, nombre, habilitado)
       VALUES ($1, $2, $3)
       ON CONFLICT (organizacion_id, nombre)
       DO UPDATE SET habilitado = EXCLUDED.habilitado`,
      [req.organizacion_id, nombre, habilitado]
    );
    res.json({ message: 'Módulo actualizado' });
  } catch (err) {
    console.error('[POST /modulos] ', err);
    res.status(500).json({ message: 'Error al actualizar módulo' });
  }
});

// Listado de usuarios por organización
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

// Siempre al final: listener del servidor
app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
