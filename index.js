// core-backend/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const { sanitizeHeaders, sanitizeBody } = require('./utils/sanitize');

// Rutas
const authRoutes = require('./routes/authRoutes');
const modulosRoutes = require('./routes/modulosRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const organizacionesRoutes = require('./routes/organizacionesRoutes');
const superadminRoutes = require('./routes/superadminRoutes');
const perfilRoutes = require('./routes/perfilRoutes');
const assistantRoutes = require('./routes/assistantRoutes');
// Failsafe directo para introspect
const { introspect } = require('./controllers/authController');

// DB centralizada
const pool = require('./utils/db');

if (!process.env.JWT_SECRET) {
  throw new Error('Falta la variable JWT_SECRET en el entorno de ejecucion.');
}

const PORT = process.env.PORT || 8080;
const app = express();

// Aceptamos proxy inverso (Railway) para IP real y cookies seguras
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Evitamos 304/ETag para que Axios no reciba respuestas vacias cacheadas
app.disable('etag');
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/* ================================
   CORS (arriba y con Vary: Origin)
   ================================ */
const PROD_ORIGINS = [
  'https://vectorargentina.com',
  'https://www.vectorargentina.com',
];

const EXTRA_ORIGINS = String(process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOW_VERCEL_PREVIEWS = process.env.CORS_ALLOW_VERCEL_PREVIEWS === '1';
const VERCEL_PREVIEW_REGEX = new RegExp(
  process.env.CORS_VERCEL_PREVIEW_REGEX || '^https://.*\\.vercel\\.app$'
);

const ALLOW_LOCALHOST =
  process.env.NODE_ENV !== 'production' || process.env.CORS_ALLOW_LOCALHOST === '1';

const LOCAL_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

const ALLOWED_ORIGINS = new Set([
  ...PROD_ORIGINS,
  ...EXTRA_ORIGINS,
  ...(ALLOW_LOCALHOST ? LOCAL_ORIGINS : []),
]);

function isOriginAllowed(origin) {
  if (!origin) return true; // curl/postman/servers
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (ALLOW_VERCEL_PREVIEWS && VERCEL_PREVIEW_REGEX.test(origin)) return true;
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Assistant-Debug'],
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  res.setHeader('Vary', 'Origin');
  next();
});

app.use(cors(corsOptions));
// Preflight global seguro
app.options(/.*/, cors(corsOptions));

// Headers de hardening (CSP deshabilitado para compat con FE)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts:
      process.env.NODE_ENV === 'production'
        ? { maxAge: 15552000, includeSubDomains: true, preload: true }
        : false,
  })
);

// x-request-id para trazabilidad
app.use((req, res, next) => {
  const rid = req.headers['x-request-id'] || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex'));
  req.id = rid;
  res.setHeader('X-Request-Id', rid);
  next();
});

/* ================================
   Parsers
   ================================ */
const jsonParserDefault = express.json({ limit: '200kb' });
const jsonParserAssistant = express.json({ limit: process.env.ASSISTANT_BODY_LIMIT || '1mb' });

app.use((req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/api/assistant/chat') || p.startsWith('/assistant/chat')) {
    return jsonParserAssistant(req, res, next);
  }
  return jsonParserDefault(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: '200kb' }));

/* ============================================
   Inyeccion de pool (compat req.db y app.locals)
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

// Health estandar
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

// Otros modulos
app.use('/api/modulos', modulosRoutes);
app.use('/modulos', modulosRoutes); // alias legacy

app.use('/api/usuarios', usuariosRoutes);
app.use('/usuarios', usuariosRoutes);

app.use('/api/organizaciones', organizacionesRoutes);
app.use('/organizaciones', organizacionesRoutes);

app.use('/api/superadmin', superadminRoutes);
app.use('/superadmin', superadminRoutes);

app.use('/api/perfil', perfilRoutes);
app.use('/perfil', perfilRoutes);

app.use('/api/assistant', assistantRoutes);
app.use('/assistant', assistantRoutes);

/* ============== 404 =============== */
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

/* ======= Manejador de errores ====== */
app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') {
    const safeReq = _req
      ? {
          method: _req.method,
          path: _req.path,
          request_id: _req.id,
          headers: sanitizeHeaders(_req.headers),
          body: sanitizeBody(_req.body),
        }
      : null;
    console.error('[UNHANDLED ERROR]', { error: err?.message || err, req: safeReq });
  }
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

/* ============ Arranque ============ */
app.listen(PORT, () => {
  console.log(`Vex Core backend corriendo en http://localhost:${PORT}`);
});
