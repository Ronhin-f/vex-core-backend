// core-backend/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Rutas
const authRoutes = require('./routes/authRoutes');
const modulosRoutes = require('./routes/modulosRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const organizacionesRoutes = require('./routes/organizacionesRoutes');
const superadminRoutes = require('./routes/superadminRoutes');
// Failsafe directo para introspect
const { introspect } = require('./controllers/authController');

// DB centralizada
const pool = require('./utils/db');

if (!process.env.JWT_SECRET) {
  throw new Error('Falta la variable JWT_SECRET en el entorno de ejecución.');
}

const app = express();
const PORT = process.env.PORT || 8080;

/* ================================
   CORS (arriba y con Vary: Origin)
   ================================ */
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://vex-core-frontend.vercel.app',
  'https://vex-core-landing.vercel.app',
  'https://vex-crm-frontend.vercel.app',
  'https://vex-stock-frontend.vercel.app',
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl/postman/servers
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  next();
});

app.use(cors(corsOptions));
// Preflight global seguro
app.options(/.*/, cors(corsOptions));

/* ================================
   Parsers
   ================================ */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ============================================
   Inyección de pool (compat req.db y app.locals)
   ============================================ */
app.use((req, _res, next) => {
  req.db = pool;
  req.app.locals.pool = pool;
  next();
});

/* ======= Endpoints simples ======= */
app.get('/', (_req, res) => {
  res.send('Vex Core API online');
});

// Health estándar
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/* ============== Rutas ==============
   Montamos con y sin /api para compatibilidad.
   Lo importante para Flows es /api/auth/introspect.
   ================================== */
// Auth
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes); // alias legacy
// Failsafe directo por si el router no cargara
app.get('/api/auth/introspect', introspect);

// Otros módulos
app.use('/api/modulos', modulosRoutes);
app.use('/modulos', modulosRoutes); // alias legacy

app.use('/api/usuarios', usuariosRoutes);
app.use('/usuarios', usuariosRoutes);

app.use('/api/organizaciones', organizacionesRoutes);
app.use('/organizaciones', organizacionesRoutes);

app.use('/api/superadmin', superadminRoutes);
app.use('/superadmin', superadminRoutes);

/* ============== 404 =============== */
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

/* ======= Manejador de errores ====== */
app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[UNHANDLED ERROR]', err);
  }
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

/* ============ Arranque ============ */
app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
