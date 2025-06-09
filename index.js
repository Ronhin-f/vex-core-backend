// VEX CORE BACKEND COMPLETO - LISTO PARA PRODUCCIÓN
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
const SECRET_KEY = process.env.JWT_SECRET || 'vex_core_secreta';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json());

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

app.post('/registro', async (req, res) => {
  const { email, password, nombre_organizacion, nombre_usuario } = req.body;
  if (!email || !password || !nombre_organizacion) {
    return res.status(400).json({ message: 'Faltan campos requeridos' });
  }

  try {
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length) return res.status(409).json({ message: 'Usuario ya existe' });

    const org = await pool.query(
      'INSERT INTO organizaciones (nombre) VALUES ($1) RETURNING id',
      [nombre_organizacion]
    );
    const orgId = org.rows[0].id;

    const hash = bcrypt.hashSync(password, 10);
    await pool.query(
      `INSERT INTO usuarios (email, password, rol, nombre, organizacion_id)
       VALUES ($1, $2, 'owner', $3, $4)`,
      [email, hash, nombre_usuario || '', orgId]
    );

    const token = jwt.sign({ email, organizacion_id: orgId }, SECRET_KEY, { expiresIn: '8h' });
    res.json({ message: 'Registrado correctamente', token });
  } catch (err) {
    console.error(err);
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
    console.error(err);
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
    console.error(err);
    res.status(500).json({ message: 'Error al obtener módulos' });
  }
});

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
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar módulo' });
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
    console.error(err);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'Vex Core API OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
