function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Giriş yapılmamış.' });
}

module.exports = { requireAuth };
