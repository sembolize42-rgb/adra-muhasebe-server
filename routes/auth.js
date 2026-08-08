const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth, isAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Ortak şifrenin hash'i artık DB'de (app_password) — program içinden
// değiştirilebilsin diye. .env'deki APP_PASSWORD_HASH sadece DB boşsa
// (ilk kurulum / henüz migrate+seed olmamışsa) bir yedek/geçiş değeri.
async function getPasswordHash() {
  const result = await pool.query('SELECT hash FROM app_password WHERE id = TRUE');
  if (result.rows.length) return result.rows[0].hash;
  return process.env.APP_PASSWORD_HASH || null;
}

// Şifre denemesi için sıkı rate-limit: 15 dakikada IP başına en fazla 8
// deneme. Başarılı girişler sayaca dahil edilmiyor (skipSuccessfulRequests)
// ki normal kullanım hiç etkilenmesin, sadece art arda yanlış deneme
// engellensin. Şifre değiştirme de aynı limiti kullanıyor (mevcut şifre
// doğrulaması içerdiği için aynı brute-force riski var).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Çok fazla yanlış deneme. 15 dakika sonra tekrar dene.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { password, wantToken, label } = req.body || {};
  const hash = await getPasswordHash();
  if (!hash) {
    return res.status(500).json({ error: 'Sunucuda şifre ayarlı değil. Yöneticiye ulaşın.' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Şifre gerekli.' });
  }

  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    return res.status(401).json({ error: 'Şifre yanlış.' });
  }

  req.session.authenticated = true;

  // Sadece isteyen istemciye (masaüstü uygulaması) bir Bearer token üret.
  // Web arayüzü bunu istemez, cookie-session yeterli.
  let token = null;
  if (wantToken) {
    token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      'INSERT INTO api_tokens (token, label) VALUES ($1,$2)',
      [token, typeof label === 'string' ? label.slice(0, 200) : 'Masaüstü uygulaması']
    );
  }

  res.json({ ok: true, token });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('adra.sid'); // server.js'deki session cookie adıyla eşleşmeli
    res.json({ ok: true });
  });
});

// Masaüstü uygulaması "çıkış yap" dediğinde SADECE kendi token'ını sunucudan siler.
router.post('/logout-token', requireAuth, async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    await pool.query('DELETE FROM api_tokens WHERE token = $1', [match[1].trim()]);
  }
  res.json({ ok: true });
});

router.get('/session', async (req, res) => {
  res.json({ authenticated: await isAuthenticated(req) });
});

// ---- Şifre değiştirme (program içinden) ----
// Ortak şifreyi değiştirmek için mevcut şifre bilinmeli (sadece oturum
// açık olması yetmez — çalınan bir cihaz/açık bırakılmış bir sekme
// üzerinden başkasının şifreyi değiştirip herkesi dışarıda bırakmasını
// engeller). Not: bu, MEVCUT masaüstü token'larını iptal ETMEZ — bir
// cihaz kaybolduysa/çalındıysa ayrıca "Masaüstü Oturumlarını Sonlandır"
// kullanılmalı.
router.post('/admin/change-password', requireAuth, loginLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'Mevcut şifre gerekli.' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı.' });
  }

  const currentHash = await getPasswordHash();
  if (!currentHash) {
    return res.status(500).json({ error: 'Sunucuda şifre ayarlı değil.' });
  }
  const ok = await bcrypt.compare(currentPassword, currentHash);
  if (!ok) {
    return res.status(401).json({ error: 'Mevcut şifre yanlış.' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `INSERT INTO app_password (id, hash, updated_at) VALUES (TRUE, $1, now())
     ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
    [newHash]
  );

  res.json({ ok: true });
});

// ---- Şifre kurtarma (unutulan ortak şifre için, sabit "kurtarma şifresi" ile) ----
// .env'deki RECOVERY_PASSWORD_HASH, DB'deki ortak şifreden TAMAMEN ayrı,
// sabit (programdan değiştirilemeyen) ikinci bir sırdır. Sadece güvenli bir
// yerde (parola yöneticisi, kasa vb.) saklanan bu tek kurtarma şifresi
// bilinmeden, unutulan ortak şifre programın kendisinden asla
// sıfırlanamaz — .env/DB'ye sunucu erişimine gerek kalmaz. Başarılı bir
// kurtarma TÜM masaüstü oturumlarını da sonlandırır (kim başka bir cihazda
// oturum açık bırakmış olursa olsun, yeni şifreyle yeniden giriş yapması
// gerekir) — reset-password.js scripti ile aynı mantık, sadece programın
// içinden, sunucuya elle erişmeden yapılabiliyor.
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Çok fazla deneme. 1 saat sonra tekrar dene.' }
});

router.post('/recover-password', recoveryLimiter, async (req, res) => {
  const { recoveryPassword, newPassword } = req.body || {};
  const recoveryHash = process.env.RECOVERY_PASSWORD_HASH;
  if (!recoveryHash) {
    return res.status(500).json({ error: 'Sunucuda kurtarma şifresi ayarlı değil. Yöneticiye ulaşın.' });
  }
  if (!recoveryPassword || typeof recoveryPassword !== 'string') {
    return res.status(400).json({ error: 'Kurtarma şifresi gerekli.' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı.' });
  }

  const ok = await bcrypt.compare(recoveryPassword, recoveryHash);
  if (!ok) {
    return res.status(401).json({ error: 'Kurtarma şifresi yanlış.' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_password (id, hash, updated_at) VALUES (TRUE, $1, now())
       ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`,
      [newHash]
    );
    const revokedResult = await client.query('DELETE FROM api_tokens');
    await client.query('COMMIT');
    res.json({ ok: true, revokedDevices: revokedResult.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Şifre sıfırlanamadı, tekrar dener misin?' });
  } finally {
    client.release();
  }
});

// ---- Cihaz (masaüstü) token yönetimi ----
// Ortak şifreyi değiştirmek MEVCUT masaüstü token'larını iptal ETMEZ —
// token bağımsız bir kimlik bilgisidir. Bir bilgisayar kaybolduğunda/
// çalındığında gerçek çözüm budur: web'den giriş yapıp burayı kullanarak
// TÜM cihaz oturumlarını anında sonlandırmak (herkesin masaüstü
// uygulamasında tekrar şifre girmesi gerekir, veri kaybı olmaz).

router.get('/admin/device-tokens', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT label, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC'
  );
  res.json({ tokens: result.rows });
});

router.post('/admin/revoke-device-tokens', requireAuth, async (req, res) => {
  const result = await pool.query('DELETE FROM api_tokens');
  res.json({ ok: true, revoked: result.rowCount });
});

module.exports = router;
