// index.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Rutas
const authRoutes = require('./routes/authRoutes');
const modulosRoutes = require('./routes/modulosRoutes');
const usuariosRoutes = require('./routes/usuariosRoutes');
const organizacionesRoutes = require('./routes/organizacionesRoutes');
const superadminRoutes = require('./routes/superadminRoutes'); // ✅ NUEVO

// Middleware
const { authenticateToken } = require('./middlewares/auth');

console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("JWT_SECRET está cargada?", process.env.JWT_SECRET ? 'SI' : 'NO');
console.log("Valor JWT_SECRET:", process.env.JWT_SECRET);

if (!process.env.JWT_SECRET) {
  throw new Error("Falta la variable JWT_SECRET en el entorno de ejecución.");
}

const app = express();
const PORT = process.env.PORT || 8080;

// Pool de conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Inyectar pool en req para acceso desde controllers
app.use((req, res, next) => {
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
app.get('/', (req, res) => {
  res.send('Vex Core API online');
});

app.get('/health', (req, res) => {
  res.json({ status: 'Vex Core API OK', timestamp: new Date().toISOString() });
});

// Rutas protegidas
app.use('/auth', authRoutes);
app.use('/modulos', modulosRoutes);
app.use('/usuarios', usuariosRoutes);
app.use('/organizaciones', organizacionesRoutes);
app.use('/superadmin', superadminRoutes); // ✅ REGISTRO DE LA NUEVA RUTA

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`🚀 Vex Core backend corriendo en http://localhost:${PORT}`);
});
