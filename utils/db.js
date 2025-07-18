const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // ⚠️ Solo para entornos con Heroku/Railway. Ajustar si usás algo más seguro
});

module.exports = pool;
