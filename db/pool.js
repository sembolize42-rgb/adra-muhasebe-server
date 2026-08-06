const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL tanımlı değil. .env dosyasını kontrol et (.env.example örnek alınabilir).');
}

// Neon/Supabase gibi barındırılan Postgres servisleri SSL ister; localhost
// bağlantılarında (docker/local kurulum) SSL genelde kapalıdır.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Beklenmeyen veritabanı havuzu hatası:', err);
});

module.exports = pool;
