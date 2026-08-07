// Sunucu açılışında bir kez çalışır: app_password tablosu boşsa,
// .env'deki APP_PASSWORD_HASH'i DB'ye taşır (mevcut kurulumların şifresi
// değişmeden yeni sisteme geçer). Tablo zaten doluysa dokunmaz — DB
// artık tek gerçek kaynak (source of truth).
const pool = require('./pool');

async function ensurePassword() {
  const existing = await pool.query('SELECT 1 FROM app_password WHERE id = TRUE');
  if (existing.rows.length) return; // zaten ayarlanmış (DB üzerinden değiştirilmiş olabilir)

  const envHash = process.env.APP_PASSWORD_HASH;
  if (!envHash) {
    console.warn('UYARI: app_password tablosu boş ve APP_PASSWORD_HASH da ayarlı değil. Giriş yapılamayacak — npm run hash-password ile bir hash üretip APP_PASSWORD_HASH olarak ayarla, sonra sunucuyu yeniden başlat.');
    return;
  }
  await pool.query(
    'INSERT INTO app_password (id, hash) VALUES (TRUE, $1) ON CONFLICT (id) DO NOTHING',
    [envHash]
  );
  console.log('app_password tablosu .env değerinden ilk kez dolduruldu.');
}

module.exports = { ensurePassword };
