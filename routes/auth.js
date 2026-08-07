const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireAuth, isAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Basit brute-force yavaşlatma: bellek içi, IP başına son deneme zamanı.
// Tek şifreli küçük ofis kullanımı için yeterli; kalıcı/dağıtık değil.
const lastAttempt = new Map();
const MIN_INTERVAL_MS = 800;

router.post('/login', async (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const last = lastAttempt.get(ip) || 0;
  if (now - last < MIN_INTERVAL_MS) {
    return res.status(429).json({ error: 'Çok hızlı deneme, birkaç saniye bekle.' });
  }
  lastAttempt.set(ip, now);

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
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// Masaüstü uygulaması "çıkış yap" dediğinde token'ı sunucudan da siler.
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

module.exports = router;
