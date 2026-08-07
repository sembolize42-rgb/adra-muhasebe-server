-- Adra Muhasebe — PostgreSQL şeması
-- Mevcut tek-dosya HTML uygulamasındaki `state` nesnesinin birebir karşılığı.
-- Sıra, foreign key bağımlılıklarına göre: önce parent tablolar, sonra child tablolar.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  archived  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS customers (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  type  TEXT NOT NULL DEFAULT 'musteri' -- 'musteri' | 'tedarikci'
);

CREATE TABLE IF NOT EXISTS projects (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  client  TEXT,
  budget  NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cards (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'TRY', -- TRY | USD | EUR
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  date         DATE NOT NULL,
  description  TEXT
);

-- transactions: account serbest metin ('nakit' ya da bank_accounts.id); tutarlı
-- kalması için FK yerine uygulama katmanında doğrulanıyor (aynı eski davranış).
CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL, -- 'gelir' | 'gider'
  date         DATE NOT NULL,
  description  TEXT,
  category     TEXT,
  project      TEXT,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_id  TEXT REFERENCES customers(id) ON DELETE SET NULL,
  account      TEXT NOT NULL DEFAULT 'nakit'
);

CREATE TABLE IF NOT EXISTS checks (
  id             TEXT PRIMARY KEY,
  direction      TEXT NOT NULL, -- 'alinan' | 'verilen'
  bank           TEXT,
  check_no       TEXT,
  description    TEXT,
  received_date  DATE,
  due_date       DATE NOT NULL,
  account        TEXT NOT NULL DEFAULT 'nakit',
  amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'bekliyor',
  tx_id          TEXT REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS costs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  description  TEXT,
  category     TEXT,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS card_charges (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  description    TEXT,
  amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'odenmedi',
  payment_tx_id  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  payment_date   DATE
);

CREATE TABLE IF NOT EXISTS salary_payments (
  id             TEXT PRIMARY KEY,
  partner_id     TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  description    TEXT,
  amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  tx_id          TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  account        TEXT NOT NULL DEFAULT 'nakit',
  recorded       BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_date  DATE,
  recorded_note  TEXT
);

CREATE TABLE IF NOT EXISTS customer_entries (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL, -- 'borc' | 'tahsilat' | 'odeme'
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  tx_id        TEXT REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id           TEXT PRIMARY KEY,
  date         DATE NOT NULL,
  from_account TEXT NOT NULL,
  to_account   TEXT NOT NULL,
  description  TEXT,
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id           TEXT PRIMARY KEY,
  loan_id      TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  amount_fx    NUMERIC(14,4) NOT NULL DEFAULT 0,
  rate         NUMERIC(14,6) NOT NULL DEFAULT 1,
  amount_try   NUMERIC(14,2) NOT NULL DEFAULT 0,
  account      TEXT NOT NULL DEFAULT 'nakit',
  description  TEXT,
  tx_id        TEXT REFERENCES transactions(id) ON DELETE SET NULL
);

-- Tek satırlık meta tablo: iyimser eşzamanlılık kontrolü (version) + bilinmeyen
-- üst-seviye alanlar için (örn. "offers") kayıp veri olmaması adına bir JSONB yedek alan.
CREATE TABLE IF NOT EXISTS app_state_meta (
  id       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  version  INTEGER NOT NULL DEFAULT 1,
  extra    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_state_meta (id, version) VALUES (TRUE, 1) ON CONFLICT (id) DO NOTHING;

-- Not: oturum (session) tablosu burada tanımlı değil — connect-pg-simple
-- server açılışında `createTableIfMissing: true` ile kendisi oluşturuyor.

-- Masaüstü uygulaması (Electron) için: web'in cookie-session'ı yerine uzun
-- ömürlü bir Bearer token ile giriş yapar (cross-origin cookie/SameSite
-- karmaşasından kaçınmak için). Şifre zaten paylaşılan ortak sır olduğundan
-- ve bu token'a erişim zaten o sırrı bilmeyi gerektirdiğinden düz metin
-- saklanıyor — bir API key'e eşdeğer risk profili.
CREATE TABLE IF NOT EXISTS api_tokens (
  token       TEXT PRIMARY KEY,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- Ortak giriş şifresinin bcrypt hash'i. Önceden .env'deki APP_PASSWORD_HASH
-- sabitti (değiştirmek için sunucuyu yeniden deploy etmek gerekiyordu);
-- artık burada tutuluyor ki program içinden (Şifre Değiştir) anında
-- güncellenebilsin, sunucu yeniden başlamadan. server.js açılışında bu
-- tablo boşsa .env'deki APP_PASSWORD_HASH ile bir kerelik doldurulur
-- (bkz. db/ensurePassword.js) — böylece mevcut kurulumlar kesintisiz geçer.
CREATE TABLE IF NOT EXISTS app_password (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  hash        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
