exports.getModulos = async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT nombre, habilitado FROM modulos WHERE organizacion_id = $1`,
      [req.organizacion_id]
    );
    res.json(result.rows);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/getModulos]', err);
    }
    res.status(500).json({ message: 'Error al obtener módulos' });
  }
};

exports.getModuloByNombre = async (req, res) => {
  const { nombre } = req.params;
  try {
    const result = await req.db.query(
      `SELECT habilitado FROM modulos WHERE organizacion_id = $1 AND nombre = $2`,
      [req.organizacion_id, nombre]
    );
    const habilitado = result.rows[0]?.habilitado || false;
    res.json({ nombre, habilitado });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/getModuloByNombre]', err);
    }
    res.status(500).json({ message: 'Error al verificar módulo' });
  }
};

exports.toggleModuloSuperadmin = async (req, res) => {
  const puedeVer = ['admin@vex.com', 'melisa@vector.inc'];
  if (!puedeVer.includes(req.usuario_email)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  const { organizacion_id, nombre, habilitado } = req.body;

  if (!organizacion_id || !nombre || typeof habilitado !== 'boolean') {
    return res.status(400).json({ error: 'Faltan datos o tipo incorrecto' });
  }

  try {
    const existe = await req.db.query(
      'SELECT id FROM modulos WHERE organizacion_id = $1 AND nombre = $2',
      [organizacion_id, nombre]
    );

    if (existe.rows.length > 0) {
      await req.db.query(
        'UPDATE modulos SET habilitado = $1 WHERE organizacion_id = $2 AND nombre = $3',
        [habilitado, organizacion_id, nombre]
      );
    } else {
      await req.db.query(
        'INSERT INTO modulos (organizacion_id, nombre, habilitado) VALUES ($1, $2, $3)',
        [organizacion_id, nombre, habilitado]
      );
    }

    res.sendStatus(200);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[modulosController/toggleModuloSuperadmin]', err);
    }
    res.status(500).json({ error: 'Error al actualizar módulo' });
  }
};
