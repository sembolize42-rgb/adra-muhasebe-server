const pool = require('../db/pool');

// Web arayüzü çerez tabanlı session kullanır. Masaüstü uygulaması (Electron)
// farklı bir origin'den (localhost:sabit-port) geldiği ve cross-origin
// çerezlerin SameSite/CORS karmaşasına girmemek için, girişte aldığı uzun
// ömürlü bir Bearer token'ı `Authorization: Bearer <token>` başlığıyla
// gönderir. Bu modül ikisini de destekler.
//
// Token'lar süresiz yaşamaz: bir cihaz uzun süre (INACTIVITY_DAYS)
// kullanılmazsa ya da mutlak yaş sınırını (ABSOLUTE_MAX_DAYS) aşarsa
// otomatik geçersiz sayılır — kayıp/çalıntı bir bilgisayarın token'ı sonsuza
// dek geçerli kalmaz. Ayrıca bkz. POST /api/admin/revoke-device-tokens
// (tüm token'ları anında iptal etmek için, örn. laptop çalındığında).
const INACTIVITY_DAYS = 60;
const ABSOLUTE_MAX_DAYS = 180;

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function isValidToken(token) {
  if (!token) return false;
  try {
    const result = await pool.query(
      'SELECT token, created_at, last_used_at FROM api_tokens WHERE token = $1',
      [token]
    );
    if (!result.rows.length) return false;

    const row = result.rows[0];
    const now = Date.now();
    const createdAt = new Date(row.created_at).getTime();
    const lastActivity = row.last_used_at ? new Date(row.last_used_at).getTime() : createdAt;
    const dayMs = 24 * 60 * 60 * 1000;

    if (now - lastActivity > INACTIVITY_DAYS * dayMs || now - createdAt > ABSOLUTE_MAX_DAYS * dayMs) {
      // Süresi dolmuş — sessizce sil, bir daha kontrol etmeye gerek kalmasın.
      pool.query('DELETE FROM api_tokens WHERE token = $1', [token]).catch(() => {});
      return false;
    }

    pool.query('UPDATE api_tokens SET last_used_at = now() WHERE token = $1', [token]).catch(() => {});
    return true;
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
