const express = require('express');
const bcrypt = require('bcryptjs');

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

  const { password } = req.body || {};
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
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

module.exports = router;
