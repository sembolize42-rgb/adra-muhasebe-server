require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

app.set('trust proxy', 1); // Render gibi ters proxy arkasında doğru IP/HTTPS algısı için

// Güvenlik başlıkları (X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, HSTS, X-Powered-By kaldırma, vb.). CSP'yi burada
// KAPALI tutuyoruz — web arayüzü hâlâ satır-içi <script>/<style> ve
// CDN'den ExcelJS kullanıyor; bunları kırmadan doğru bir CSP yazmak ayrı
// bir iş. Masaüstü uygulaması zaten kendi CSP'sini local sunucusundan
// (desktop/main.js) ayrıca uyguluyor.
app.use(helmet({ contentSecurityPolicy: false }));

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

// Genel API rate-limit: normal kullanım (birkaç kişi, dakikada bir senkron
// kontrolü) çok altında, ama sızmış bir token'la yapılacak toplu kötüye
// kullanımı ya da bozuk bir istemcinin sonsuz döngüsünü sınırlıyor.
// /login kendi daha sıkı limitine sahip (routes/auth.js).
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek, biraz sonra tekrar dene.' }
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

// Genel hata yakalayıcı: beklenmeyen bir hata Express'in varsayılan HTML
// hata sayfasını (ve NODE_ENV=production olmadığında stack trace'i)
// döndürmesin — API her zaman JSON döner.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Beklenmeyen hata:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Sunucu hatası.' });
});

app.listen(PORT, () => {
  console.log(`Adra Muhasebe sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
