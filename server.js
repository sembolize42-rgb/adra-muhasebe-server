require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const pool = require('./db/pool');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error('HATA: SESSION_SECRET .env dosyasında tanımlı değil. Çıkılıyor.');
  process.exit(1);
}

app.set('trust proxy', 1); // Railway gibi ters proxy arkasında doğru IP/HTTPS algısı için

app.use(express.json({ limit: '2mb' }));

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  name: 'adra.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 gün
  }
}));

app.use('/api', authRoutes);
app.use('/api', requireAuth, stateRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Adra Muhasebe sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
