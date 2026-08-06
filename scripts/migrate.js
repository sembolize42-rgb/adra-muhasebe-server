// Şemayı (db/schema.sql) hedef veritabanına uygular. Idempotent — tekrar
// çalıştırmak güvenlidir (hepsi CREATE TABLE IF NOT EXISTS).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('Şema uygulanıyor...');
    await client.query(sql);
    console.log('Tamam: tüm tablolar hazır.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Şema uygulanamadı:', err);
  process.exit(1);
});
