// Ortak mantık: tarayıcıdaki `state` nesnesini (camelCase) alıp veritabanına
// yazar. İki tüketicisi var:
//   - replaceState(): tam değişim ("hepsini sil, hepsini yeniden ekle") —
//     import-json.js ve routes/state.js (PUT /api/state) kullanır.
//   - insertRow(): tek satır ekleme (ON CONFLICT DO NOTHING ile idempotent) —
//     routes/sync.js (masaüstü uygulamasının offline kuyruğu) kullanır.
// Her iki yol da aynı INSERTERS tablosunu paylaşır, böylece sütun eşlemesi
// tek bir yerde tanımlı kalır.

const KNOWN_KEYS = [
  'transactions', 'checks', 'projects', 'costs', 'cards', 'cardCharges',
  'partners', 'salaryPayments', 'customers', 'customerEntries', 'transfers',
  'bankAccounts', 'loans', 'loanPayments'
];

// Silme (child->parent) ve ekleme (parent->child) sırası bu diziyle belirlenir.
const ORDER = [
  'bankAccounts', 'customers', 'projects', 'cards', 'partners', 'loans',
  'transactions', 'checks', 'costs', 'cardCharges', 'salaryPayments',
  'customerEntries', 'transfers', 'loanPayments'
];

const DELETE_TABLE = {
  bankAccounts: 'bank_accounts', customers: 'customers', projects: 'projects',
  cards: 'cards', partners: 'partners', loans: 'loans', transactions: 'transactions',
  checks: 'checks', costs: 'costs', cardCharges: 'card_charges',
  salaryPayments: 'salary_payments', customerEntries: 'customer_entries',
  transfers: 'transfers', loanPayments: 'loan_payments'
};

function n(v, fallback = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : fallback;
}
function s(v) {
  return v === undefined || v === null ? null : String(v);
}
function b(v) {
  return !!v;
}

// Her tablo için: {text, values(rec)} üreten fonksiyon. `ignoreConflict`
// true ise "ON CONFLICT (id) DO NOTHING" eklenir (senkron kuyruğu için
// idempotent tekrar denemeler güvenli olsun diye).
const INSERTERS = {
  bankAccounts: (rec, ic) => ({
    text: `INSERT INTO bank_accounts (id, name, archived) VALUES ($1,$2,$3)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name, b(rec.archived)]
  }),
  customers: (rec, ic) => ({
    text: `INSERT INTO customers (id, name, type) VALUES ($1,$2,$3)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name, rec.type || 'musteri']
  }),
  projects: (rec, ic) => ({
    text: `INSERT INTO projects (id, name, client, budget) VALUES ($1,$2,$3,$4)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name, s(rec.client), n(rec.budget, 0)]
  }),
  cards: (rec, ic) => ({
    text: `INSERT INTO cards (id, name) VALUES ($1,$2)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name]
  }),
  partners: (rec, ic) => ({
    text: `INSERT INTO partners (id, name) VALUES ($1,$2)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name]
  }),
  loans: (rec, ic) => ({
    text: `INSERT INTO loans (id, name, currency, amount, date, description) VALUES ($1,$2,$3,$4,$5,$6)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.name, rec.currency || 'TRY', n(rec.amount, 0), rec.date, s(rec.description)]
  }),
  transactions: (rec, ic) => ({
    text: `INSERT INTO transactions (id, type, date, description, category, project, amount, customer_id, account)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.type, rec.date, s(rec.description), s(rec.category), s(rec.project), n(rec.amount, 0), s(rec.customerId), rec.account || 'nakit']
  }),
  checks: (rec, ic) => ({
    text: `INSERT INTO checks (id, direction, bank, check_no, description, received_date, due_date, account, amount, status, tx_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.direction, s(rec.bank), s(rec.checkNo), s(rec.description), rec.receivedDate || rec.dueDate, rec.dueDate, rec.account || 'nakit', n(rec.amount, 0), rec.status || 'bekliyor', s(rec.txId)]
  }),
  costs: (rec, ic) => ({
    text: `INSERT INTO costs (id, project_id, date, description, category, amount) VALUES ($1,$2,$3,$4,$5,$6)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.projectId, rec.date, s(rec.description), s(rec.category), n(rec.amount, 0)]
  }),
  cardCharges: (rec, ic) => ({
    text: `INSERT INTO card_charges (id, card_id, date, description, amount, status, payment_tx_id, payment_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.cardId, rec.date, s(rec.description), n(rec.amount, 0), rec.status || 'odenmedi', s(rec.paymentTxId), s(rec.paymentDate)]
  }),
  salaryPayments: (rec, ic) => ({
    text: `INSERT INTO salary_payments (id, partner_id, date, description, amount, tx_id, account, recorded, recorded_date, recorded_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.partnerId, rec.date, s(rec.description), n(rec.amount, 0), s(rec.txId), rec.account || 'nakit', b(rec.recorded), s(rec.recordedDate), s(rec.recordedNote)]
  }),
  customerEntries: (rec, ic) => ({
    text: `INSERT INTO customer_entries (id, customer_id, date, description, type, amount, tx_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.customerId, rec.date, s(rec.description), rec.type, n(rec.amount, 0), s(rec.txId)]
  }),
  transfers: (rec, ic) => ({
    text: `INSERT INTO transfers (id, date, from_account, to_account, description, amount)
           VALUES ($1,$2,$3,$4,$5,$6)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.date, rec.from, rec.to, s(rec.description), n(rec.amount, 0)]
  }),
  loanPayments: (rec, ic) => ({
    text: `INSERT INTO loan_payments (id, loan_id, date, amount_fx, rate, amount_try, account, description, tx_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)${ic ? ' ON CONFLICT (id) DO NOTHING' : ''}`,
    values: [rec.id, rec.loanId, rec.date, n(rec.amountFx, 0), n(rec.rate, 1), n(rec.amountTRY, 0), rec.account || 'nakit', s(rec.description), s(rec.txId)]
  })
};

// Tek satır ekler. `key` KNOWN_KEYS'ten biri olmalı. ignoreConflict:true ise
// aynı id tekrar gönderilirse (senkron tekrar denemesi) sessizce atlanır.
async function insertRow(client, key, rec, { ignoreConflict = true } = {}) {
  const build = INSERTERS[key];
  if (!build) throw new Error('Bilinmeyen kayıt türü: ' + key);
  const { text, values } = build(rec, ignoreConflict);
  await client.query(text, values);
}

// client: pg client, ALREADY inside a transaction (BEGIN çağrılmış olmalı).
async function replaceState(client, state, { bumpVersion = true } = {}) {
  const st = state || {};
  const arr = (key) => (Array.isArray(st[key]) ? st[key] : []);

  // 1) Sil — ORDER'ın tersi (child'dan parent'a).
  for (let i = ORDER.length - 1; i >= 0; i--) {
    await client.query(`DELETE FROM ${DELETE_TABLE[ORDER[i]]}`);
  }

  // 2) Ekle — parent'tan child'a (fresh tablo, conflict beklenmiyor).
  for (const key of ORDER) {
    for (const rec of arr(key)) {
      await insertRow(client, key, rec, { ignoreConflict: false });
    }
  }

  // 3) Bilinmeyen üst-seviye alanları (örn. "offers") kaybetmemek için sakla.
  const extra = {};
  for (const key of Object.keys(st)) {
    if (!KNOWN_KEYS.includes(key)) extra[key] = st[key];
  }
  if (bumpVersion) {
    await client.query(
      'UPDATE app_state_meta SET version = version + 1, extra = $1, updated_at = now() WHERE id = TRUE',
      [JSON.stringify(extra)]
    );
  } else {
    await client.query(
      'UPDATE app_state_meta SET extra = $1, updated_at = now() WHERE id = TRUE',
      [JSON.stringify(extra)]
    );
  }
}

module.exports = { replaceState, insertRow, KNOWN_KEYS, ORDER };
