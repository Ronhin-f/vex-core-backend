// utils/db.js
const { Pool } = require('pg');

const isProd = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(isProd ? { ssl: { rejectUnauthorized: false } } : {})
});

module.exports = pool;
