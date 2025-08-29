// controllers/usuariosController.js
const bcrypt = require('bcryptjs');

function normEmail(s = '') {
  return String(s).trim().toLowerCase();
}

exports.getUsuarios = async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT email, rol, nombre 
         FROM usuarios 
        WHERE organizacion_id = $1 
        ORDER BY email`,
      [req.organizacion_id]
    );
    res.json(result.rows);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[usuariosController/getUsuarios]', err);
    }
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

exports.crearUsuario = async (req, res) => {
  try {
    const { email, password, nombre, rol } = req.body || {};
    const rolesValidos = ['admin', 'user'];

    if (!email || !password || typeof nombre !== 'string' || !rolesValidos.includes(rol)) {
      return res.status(400).json({ error: 'Datos inválidos o rol no permitido' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    // Solo owner puede crear usuarios en su organización
    const creador = await req.db.query(
      'SELECT rol FROM usuarios WHERE email = $1 AND organizacion_id = $2',
      [req.usuario_email, req.organizacion_id]
    );
    if (creador.rows[0]?.rol !== 'owner' && creador.rows[0]?.rol !== 'superadmin') {
      return res.status(403).json({ error: 'Solo el owner puede crear usuarios' });
    }

    const emailN = normEmail(email);
    const nombreN = String(nombre || '').trim();

    // Duplicado dentro de la org (no global)
    const existe = await req.db.query(
      'SELECT 1 FROM usuarios WHERE email = $1 AND organizacion_id = $2',
      [emailN, req.organizacion_id]
    );
    if (existe.rowCount) {
      return res.status(409).json({ error: 'Ese email ya está registrado en esta organización' });
    }

    const hash = await bcrypt.hash(password, 10);
    await req.db.query(
      `INSERT INTO usuarios (email, password, rol, nombre, organizacion_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [emailN, hash, rol, nombreN, req.organizacion_id]
    );

    res.status(201).json({ message: 'Usuario creado correctamente' });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[usuariosController/crearUsuario]', err);
    }
    res.status(500).json({ error: 'Error interno al crear usuario' });
  }
};

exports.getUsuarioActual = async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT email, nombre, rol, organizacion_id 
         FROM usuarios 
        WHERE email = $1 AND organizacion_id = $2`,
      [req.usuario_email, req.organizacion_id]
    );
    const usuario = result.rows[0];
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ usuario });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[usuariosController/getUsuarioActual]", err);
    }
    res.status(500).json({ error: "Error al obtener usuario actual" });
  }
};
