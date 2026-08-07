// ŞİFRE KURTARMA — ortak şifre unutulduğunda kullanılır.
// Mevcut şifreyi BİLMEYE gerek yok; sadece bu bilgisayardaki (ya da
// DATABASE_URL'e sahip herhangi bir yerdeki) .env dosyasına erişim yeterli.
//
// Kullanım:
//   node scripts/reset-password.js "yeni-sifre"
//   node scripts/reset-password.js "yeni-sifre" --revoke-devices
//
// --revoke-devices verilirse, tüm masaüstü uygulaması oturumları da
// (api_tokens tablosu) aynı anda temizlenir — herkesin masaüstünde de
// yeni şifreyle tekrar giriş yapması gerekir. Vermezsen sadece web/masaüstü
// GİRİŞ şifresi değişir, zaten açık olan masaüstü oturumları etkilenmez.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

async function main() {
  const newPassword = process.argv[2];
  const revokeDevices = process.argv.includes('--revoke-devices');

  if (!newPassword) {
    console.error('Kullanım: node scripts/reset-password.js "yeni-sifre" [--revoke-devices]');
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error('Yeni şifre en az 8 karakter olmalı.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(newPassword, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_password (id, hash, updated_at) VALUES (TRUE, $1, now())
       ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
      [hash]
    );
    let revoked = 0;
    if (revokeDevices) {
      const r = await client.query('DELETE FROM api_tokens');
      revoked = r.rowCount;
    }
    await client.query('COMMIT');
    console.log('Şifre başarıyla sıfırlandı.');
    if (revokeDevices) console.log(revoked + ' masaüstü oturumu da sonlandırıldı.');
    else console.log('Mevcut masaüstü oturumları etkilenmedi (istersen --revoke-devices ile tekrar çalıştırabilirsin).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Hata:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
