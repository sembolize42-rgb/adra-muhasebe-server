// Ortak mantık: tarayıcıdaki `state` nesnesini (camelCase) alıp veritabanına
// tamamen yazar (mevcut verinin yerini alır). import-json.js ve
// routes/state.js (PUT /api/state) bu fonksiyonu paylaşır.
//
// Küçük veri hacmi (onlarca–yüzlerce satır) göz önüne alınarak "hepsini sil,
// hepsini yeniden ekle" yaklaşımı tercih edildi — basit, doğru ve tek
// transaction içinde atomik.

const KNOWN_KEYS = [
  'transactions', 'checks', 'projects', 'costs', 'cards', 'cardCharges',
  'partners', 'salaryPayments', 'customers', 'customerEntries', 'transfers',
  'bankAccounts', 'loans', 'loanPayments'
];

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

// client: pg client, ALREADY inside a transaction (BEGIN çağrılmış olmalı).
async function replaceState(client, state, { bumpVersion = true } = {}) {
  const st = state || {};
  const arr = (key) => (Array.isArray(st[key]) ? st[key] : []);

  // 1) Sil — child'dan parent'a.
  await client.query('DELETE FROM loan_payments');
  await client.query('DELETE FROM transfers');
  await client.query('DELETE FROM customer_entries');
  await client.query('DELETE FROM salary_payments');
  await client.query('DELETE FROM card_charges');
  await client.query('DELETE FROM costs');
  await client.query('DELETE FROM checks');
  await client.query('DELETE FROM transactions');
  await client.query('DELETE FROM loans');
  await client.query('DELETE FROM partners');
  await client.query('DELETE FROM cards');
  await client.query('DELETE FROM projects');
  await client.query('DELETE FROM customers');
  await client.query('DELETE FROM bank_accounts');

  // 2) Ekle — parent'tan child'a.
  for (const a of arr('bankAccounts')) {
    await client.query(
      'INSERT INTO bank_accounts (id, name, archived) VALUES ($1,$2,$3)',
      [a.id, a.name, b(a.archived)]
    );
  }
  for (const c of arr('customers')) {
    await client.query(
      'INSERT INTO customers (id, name, type) VALUES ($1,$2,$3)',
      [c.id, c.name, c.type || 'musteri']
    );
  }
  for (const p of arr('projects')) {
    await client.query(
      'INSERT INTO projects (id, name, client, budget) VALUES ($1,$2,$3,$4)',
      [p.id, p.name, s(p.client), n(p.budget, 0)]
    );
  }
  for (const k of arr('cards')) {
    await client.query('INSERT INTO cards (id, name) VALUES ($1,$2)', [k.id, k.name]);
  }
  for (const pt of arr('partners')) {
    await client.query('INSERT INTO partners (id, name) VALUES ($1,$2)', [pt.id, pt.name]);
  }
  for (const l of arr('loans')) {
    await client.query(
      'INSERT INTO loans (id, name, currency, amount, date, description) VALUES ($1,$2,$3,$4,$5,$6)',
      [l.id, l.name, l.currency || 'TRY', n(l.amount, 0), l.date, s(l.description)]
    );
  }
  for (const t of arr('transactions')) {
    await client.query(
      `INSERT INTO transactions (id, type, date, description, category, project, amount, customer_id, account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.id, t.type, t.date, s(t.description), s(t.category), s(t.project), n(t.amount, 0), s(t.customerId), t.account || 'nakit']
    );
  }
  for (const c of arr('checks')) {
    await client.query(
      `INSERT INTO checks (id, direction, bank, check_no, description, received_date, due_date, account, amount, status, tx_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.direction, s(c.bank), s(c.checkNo), s(c.description), c.receivedDate || c.dueDate, c.dueDate, c.account || 'nakit', n(c.amount, 0), c.status || 'bekliyor', s(c.txId)]
    );
  }
  for (const c of arr('costs')) {
    await client.query(
      'INSERT INTO costs (id, project_id, date, description, category, amount) VALUES ($1,$2,$3,$4,$5,$6)',
      [c.id, c.projectId, c.date, s(c.description), s(c.category), n(c.amount, 0)]
    );
  }
  for (const c of arr('cardCharges')) {
    await client.query(
      `INSERT INTO card_charges (id, card_id, date, description, amount, status, payment_tx_id, payment_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.id, c.cardId, c.date, s(c.description), n(c.amount, 0), c.status || 'odenmedi', s(c.paymentTxId), s(c.paymentDate)]
    );
  }
  for (const sp of arr('salaryPayments')) {
    await client.query(
      `INSERT INTO salary_payments (id, partner_id, date, description, amount, tx_id, account, recorded, recorded_date, recorded_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [sp.id, sp.partnerId, sp.date, s(sp.description), n(sp.amount, 0), s(sp.txId), sp.account || 'nakit', b(sp.recorded), s(sp.recordedDate), s(sp.recordedNote)]
    );
  }
  for (const e of arr('customerEntries')) {
    await client.query(
      `INSERT INTO customer_entries (id, customer_id, date, description, type, amount, tx_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.id, e.customerId, e.date, s(e.description), e.type, n(e.amount, 0), s(e.txId)]
    );
  }
  for (const x of arr('transfers')) {
    await client.query(
      `INSERT INTO transfers (id, date, from_account, to_account, description, amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [x.id, x.date, x.from, x.to, s(x.description), n(x.amount, 0)]
    );
  }
  for (const p of arr('loanPayments')) {
    await client.query(
      `INSERT INTO loan_payments (id, loan_id, date, amount_fx, rate, amount_try, account, description, tx_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.loanId, p.date, n(p.amountFx, 0), n(p.rate, 1), n(p.amountTRY, 0), p.account || 'nakit', s(p.description), s(p.txId)]
    );
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

module.exports = { replaceState, KNOWN_KEYS };
