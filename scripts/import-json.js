// Mevcut "Yedeği İndir (.json)" dosyasını veritabanına aktarır.
// Kullanım:  node scripts/import-json.js "C:\...\Muhasebe Yedek.json"
// Varsayılan: proje kökündeki "Muhasebe Yedek.json".
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { replaceState } = require('../db/replaceState');
const { readState } = require('../db/readState');

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '..', '..', 'Muhasebe Yedek.json');
  console.log('Okunuyor:', filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const state = JSON.parse(raw);

  const beforeCounts = countRows(state);
  console.log('İçe aktarılacak kayıt sayıları:', beforeCounts);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await replaceState(client, state, { bumpVersion: false });
    await client.query('UPDATE app_state_meta SET version = 1 WHERE id = TRUE');
    await client.query('COMMIT');
    console.log('Aktarım tamamlandı, transaction commit edildi.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Hata oluştu, tüm değişiklikler geri alındı:', err);
    process.exitCode = 1;
    return;
  } finally {
    client.release();
  }

  // Doğrulama: veritabanından geri okuyup sayıları karşılaştır.
  const verifyClient = await pool.connect();
  try {
    const { state: dbState, version } = await readState(verifyClient);
    const afterCounts = countRows(dbState);
    console.log('Veritabanındaki kayıt sayıları (version=' + version + '):', afterCounts);
    const mismatch = Object.keys(beforeCounts).filter((k) => beforeCounts[k] !== afterCounts[k]);
    if (mismatch.length) {
      console.warn('UYARI: Sayılar tutmuyor ->', mismatch);
    } else {
      console.log('Doğrulama OK: tüm tablo sayıları eşleşiyor.');
    }
  } finally {
    verifyClient.release();
    await pool.end();
  }
}

function countRows(state) {
  const keys = ['transactions', 'checks', 'projects', 'costs', 'cards', 'cardCharges', 'partners', 'salaryPayments', 'customers', 'customerEntries', 'transfers', 'bankAccounts', 'loans', 'loanPayments'];
  const out = {};
  for (const k of keys) out[k] = Array.isArray(state[k]) ? state[k].length : 0;
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
