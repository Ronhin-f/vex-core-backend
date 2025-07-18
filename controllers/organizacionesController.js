exports.getOrganizacionesConModulos = async (req, res) => {
  const puedeVer = ['admin@vex.com', 'melisa@vector.inc'];
  if (!puedeVer.includes(req.usuario_email)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  try {
    const orgs = await req.db.query('SELECT * FROM organizaciones');
    const modulos = await req.db.query('SELECT * FROM modulos');

    const data = orgs.rows.map((org) => {
      const mods = modulos.rows
        .filter((m) => m.organizacion_id === org.id)
        .map(({ nombre, habilitado }) => ({ nombre, habilitado }));
      return { ...org, modulos: mods };
    });

    res.json(data);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[organizacionesController/getOrganizacionesConModulos]', err);
    }
    res.status(500).json({ error: 'Error al obtener organizaciones' });
  }
};
