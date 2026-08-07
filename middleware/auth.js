const pool = require('../db/pool');

// Web arayüzü çerez tabanlı session kullanır. Masaüstü uygulaması (Electron)
// farklı bir origin'den (localhost:sabit-port) geldiği ve cross-origin
// çerezlerin SameSite/CORS karmaşasına girmemek için, girişte aldığı uzun
// ömürlü bir Bearer token'ı `Authorization: Bearer <token>` başlığıyla
// gönderir. Bu modül ikisini de destekler.

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function isValidToken(token) {
  if (!token) return false;
  try {
    const result = await pool.query('SELECT token FROM api_tokens WHERE token = $1', [token]);
    if (result.rows.length) {
      pool.query('UPDATE api_tokens SET last_used_at = now() WHERE token = $1', [token]).catch(() => {});
      return true;
    }
  } catch (err) {
    console.error('Token doğrulama hatası:', err);
  }
  return false;
}

async function isAuthenticated(req) {
  if (req.session && req.session.authenticated) return true;
  return isValidToken(extractBearerToken(req));
}

async function requireAuth(req, res, next) {
  if (await isAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Giriş yapılmamış.' });
}

module.exports = { requireAuth, isAuthenticated, extractBearerToken };
