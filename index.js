// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Rutas
const authRoutes = require('./routes/authRoutes');
const modulosRoutes = require('./routes/modulosRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const organizacionesRoutes = require('./routes/organizacionesRoutes');
const superadminRoutes = require('./routes/superadminRoutes');

// DB centralizada
const pool = require('./utils/db');

if (!process.env.JWT_SECRET) {
  throw new Error("Falta la variable JWT_SECRET en el entorno de ejecución.");
}

const app = express();
const PORT = process.env.PORT || 8080;

// Inyectar pool en req para acceso desde controllers
app.use((req, _res, next) => {
  req.db = pool;
  next();
});

// --- CORS robusto y explícito ---
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://vex-core-frontend.vercel.app',
    'https://vex-core-landing.vercel.app',
    'https://vex-crm-frontend.vercel.app',
    'https://vex-stock-frontend.vercel.app',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Endpoints de prueba
app.get('/', (_req, res) => {
  res.send('Vex Core API online');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'Vex Core API OK', timestamp: new Date().toISOString() });
});

// Rutas
app.use('/auth', authRoutes);
app.use('/modulos', modulosRoutes);
app.use('/usuarios', usuariosRoutes);
app.use('/organizaciones', organizacionesRoutes);
app.use('/superadmin', superadminRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

// Error handler
app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[UNHANDLED ERROR]', err);
  }
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
