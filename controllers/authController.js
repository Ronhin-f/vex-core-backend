const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = process.env;

if (!JWT_SECRET) throw new Error("JWT_SECRET no está definido en el entorno.");

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  }

  try {
    const result = await req.db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = result.rows[0];
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });

    const valid = await bcrypt.compare(password, usuario.password);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      {
        email: usuario.email,
        rol: usuario.rol,
        organizacion_id: usuario.organizacion_id,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      email: usuario.email,
      rol: usuario.rol,
      organizacion_id: usuario.organizacion_id,
      nombre: usuario.nombre
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authController/login] Error:', error);
    }
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
};

exports.register = async (req, res) => {
  const { email, password, nombre, rol = 'user', organizacion_id } = req.body;

  if (!email || !password || !nombre || !organizacion_id) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const existe = await req.db.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await req.db.query(
      'INSERT INTO usuarios (email, password, nombre, rol, organizacion_id) VALUES ($1, $2, $3, $4, $5) RETURNING email, rol, nombre, organizacion_id',
      [email, hashedPassword, nombre, rol, organizacion_id]
    );

    res.status(201).json({ message: 'Usuario registrado con éxito', usuario: result.rows[0] });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[authController/register] Error:', error);
    }
    res.status(500).json({ error: 'Error interno al registrar usuario' });
  }
};
