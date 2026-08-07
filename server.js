require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');

const pool = require('./db/pool');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.error('HATA: SESSION_SECRET .env dosyasında tanımlı değil. Çıkılıyor.');
  process.exit(1);
}

app.set('trust proxy', 1); // Railway gibi ters proxy arkasında doğru IP/HTTPS algısı için

// Masaüstü uygulaması (Electron), kendi sabit local portundan bu API'ye
// Bearer token ile istek atar — bu yüzden sadece o origin'e CORS izni
// veriyoruz. Web arayüzü zaten aynı origin'den servis edildiği için CORS'a
// ihtiyaç duymuyor (bu middleware sadece cross-origin isteklerde devreye girer).
const DESKTOP_ORIGIN = process.env.DESKTOP_APP_ORIGIN || 'http://localhost:57632';
app.use('/api', cors({
  origin: DESKTOP_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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
app.use('/api', requireAuth, syncRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Adra Muhasebe sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
