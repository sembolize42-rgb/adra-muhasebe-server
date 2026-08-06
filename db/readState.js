// Veritabanındaki tabloları frontend'in beklediği `state` şekline (camelCase)
// geri çevirir. GET /api/state bunu kullanır.
//
// Not: tüm DATE sütunları to_char(...,'YYYY-MM-DD') ile string olarak
// çekiliyor — node-postgres'in DATE tipini yerel saat dilimine göre Date
// nesnesine çevirmesinden kaynaklanabilecek gün kaymalarını (off-by-one)
// tamamen ortadan kaldırmak için.

async function readState(client) {
  // Not: aynı client üzerinde sorgular sıralı (await ile birer birer)
  // çalıştırılıyor — node-postgres tek bir client'ta eşzamanlı (Promise.all)
  // query çağrılarını desteklemiyor (pg@9'da tamamen kaldırılacak bir
  // deprecation uyarısı veriyor).
  const bankAccounts = await client.query('SELECT id, name, archived FROM bank_accounts ORDER BY name');
  const customers = await client.query('SELECT id, name, type FROM customers ORDER BY name');
  const projects = await client.query('SELECT id, name, client, budget FROM projects ORDER BY name');
  const cards = await client.query('SELECT id, name FROM cards ORDER BY name');
  const partners = await client.query('SELECT id, name FROM partners ORDER BY name');
  const loans = await client.query(`SELECT id, name, currency, amount, to_char(date,'YYYY-MM-DD') AS date, description FROM loans ORDER BY date`);
  const transactions = await client.query(`SELECT id, type, to_char(date,'YYYY-MM-DD') AS date, description, category, project, amount, customer_id, account FROM transactions ORDER BY date`);
  const checks = await client.query(`SELECT id, direction, bank, check_no, description, to_char(received_date,'YYYY-MM-DD') AS received_date, to_char(due_date,'YYYY-MM-DD') AS due_date, account, amount, status, tx_id FROM checks ORDER BY due_date`);
  const costs = await client.query(`SELECT id, project_id, to_char(date,'YYYY-MM-DD') AS date, description, category, amount FROM costs ORDER BY date`);
  const cardCharges = await client.query(`SELECT id, card_id, to_char(date,'YYYY-MM-DD') AS date, description, amount, status, payment_tx_id, to_char(payment_date,'YYYY-MM-DD') AS payment_date FROM card_charges ORDER BY date`);
  const salaryPayments = await client.query(`SELECT id, partner_id, to_char(date,'YYYY-MM-DD') AS date, description, amount, tx_id, account, recorded, to_char(recorded_date,'YYYY-MM-DD') AS recorded_date, recorded_note FROM salary_payments ORDER BY date`);
  const customerEntries = await client.query(`SELECT id, customer_id, to_char(date,'YYYY-MM-DD') AS date, description, type, amount, tx_id FROM customer_entries ORDER BY date`);
  const transfers = await client.query(`SELECT id, to_char(date,'YYYY-MM-DD') AS date, from_account, to_account, description, amount FROM transfers ORDER BY date`);
  const loanPayments = await client.query(`SELECT id, loan_id, to_char(date,'YYYY-MM-DD') AS date, amount_fx, rate, amount_try, account, description, tx_id FROM loan_payments ORDER BY date`);
  const meta = await client.query('SELECT version, extra FROM app_state_meta WHERE id = TRUE');

  const num = (v) => (v === null || v === undefined ? 0 : Number(v));
  const metaRow = meta.rows[0] || { version: 1, extra: {} };

  const state = {
    bankAccounts: bankAccounts.rows.map((r) => ({ id: r.id, name: r.name, archived: r.archived })),
    customers: customers.rows.map((r) => ({ id: r.id, name: r.name, type: r.type })),
    projects: projects.rows.map((r) => ({ id: r.id, name: r.name, client: r.client, budget: num(r.budget) })),
    cards: cards.rows.map((r) => ({ id: r.id, name: r.name })),
    partners: partners.rows.map((r) => ({ id: r.id, name: r.name })),
    loans: loans.rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency, amount: num(r.amount), date: r.date, description: r.description })),
    transactions: transactions.rows.map((r) => ({ id: r.id, type: r.type, date: r.date, description: r.description, category: r.category, project: r.project, amount: num(r.amount), customerId: r.customer_id, account: r.account })),
    checks: checks.rows.map((r) => ({ id: r.id, direction: r.direction, bank: r.bank, checkNo: r.check_no, description: r.description, receivedDate: r.received_date, dueDate: r.due_date, account: r.account, amount: num(r.amount), status: r.status, txId: r.tx_id })),
    costs: costs.rows.map((r) => ({ id: r.id, projectId: r.project_id, date: r.date, description: r.description, category: r.category, amount: num(r.amount) })),
    cardCharges: cardCharges.rows.map((r) => ({ id: r.id, cardId: r.card_id, date: r.date, description: r.description, amount: num(r.amount), status: r.status, paymentTxId: r.payment_tx_id, paymentDate: r.payment_date })),
    salaryPayments: salaryPayments.rows.map((r) => ({ id: r.id, partnerId: r.partner_id, date: r.date, description: r.description, amount: num(r.amount), txId: r.tx_id, account: r.account, recorded: r.recorded, recordedDate: r.recorded_date, recordedNote: r.recorded_note })),
    customerEntries: customerEntries.rows.map((r) => ({ id: r.id, customerId: r.customer_id, date: r.date, description: r.description, type: r.type, amount: num(r.amount), txId: r.tx_id })),
    transfers: transfers.rows.map((r) => ({ id: r.id, date: r.date, from: r.from_account, to: r.to_account, description: r.description, amount: num(r.amount) })),
    loanPayments: loanPayments.rows.map((r) => ({ id: r.id, loanId: r.loan_id, date: r.date, amountFx: num(r.amount_fx), rate: num(r.rate), amountTRY: num(r.amount_try), account: r.account, description: r.description, txId: r.tx_id })),
    ...(metaRow.extra || {})
  };

  return { state, version: metaRow.version };
}

module.exports = { readState };
