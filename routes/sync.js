const express = require('express');
const pool = require('../db/pool');
const { insertRow, KNOWN_KEYS } = require('../db/replaceState');

const router = express.Router();

// POST /api/sync/push
// body: { records: [ { table: 'transactions', data: {...} }, ... ] }
//
// Masaüstü uygulamasının offline'ken biriktirdiği "yeni kayıt" kuyruğunu
// (outbox) sunucuya gönderir. Sadece EKLEME yapar — var olan bir kaydı
// güncellemez/silmez, bu yüzden iki cihaz aynı anda senkronize olsa bile
// çakışma riski yoktur (her kayıt kendi benzersiz id'siyle gelir).
// ON CONFLICT (id) DO NOTHING sayesinde aynı kayıt iki kez gönderilirse
// (ör. istemci zaman aşımında tekrar dener) sorun çıkmaz.
router.post('/sync/push', async (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Geçersiz gövde: records (dizi) gerekli.' });
  }
  if (records.length === 0) {
    return res.json({ ok: true, inserted: 0 });
  }
  if (records.length > 500) {
    return res.status(400).json({ error: 'Tek seferde en fazla 500 kayıt gönderilebilir.' });
  }

  for (const r of records) {
    if (!r || !KNOWN_KEYS.includes(r.table) || !r.data || !r.data.id) {
      return res.status(400).json({ error: 'Geçersiz kayıt: her öğede geçerli bir "table" ve id\'li "data" olmalı.', record: r });
    }
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of records) {
      await insertRow(client, r.table, r.data, { ignoreConflict: true });
      inserted++;
    }
    await client.query('UPDATE app_state_meta SET version = version + 1, updated_at = now() WHERE id = TRUE');
    const versionRes = await client.query('SELECT version FROM app_state_meta WHERE id = TRUE');
    await client.query('COMMIT');
    res.json({ ok: true, inserted, version: versionRes.rows[0].version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/sync/push hatası:', err);
    res.status(500).json({ error: 'Senkronizasyon başarısız.' });
  } finally {
    client.release();
  }
});

module.exports = router;
