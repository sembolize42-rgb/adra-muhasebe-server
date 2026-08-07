const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth, isAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Şifre denemesi için sıkı rate-limit: 15 dakikada IP başına en fazla 8
// deneme. Başarılı girişler sayaca dahil edilmiyor (skipSuccessfulRequests)
// ki normal kullanım hiç etkilenmesin, sadece art arda yanlış deneme
// engellensin.
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
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    return res.status(500).json({ error: 'Sunucuda APP_PASSWORD_HASH ayarlı değil.' });
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
