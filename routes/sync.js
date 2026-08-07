const express = require('express');
const pool = require('../db/pool');
const { insertRow, KNOWN_KEYS, ORDER } = require('../db/replaceState');

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
//
// Güvenilirlik notu: her kayıt kendi SAVEPOINT'i içinde denenir. Böylece
// aramızdan biri artık var olmayan bir müşteriye/projeye bağlı bozuk/eski
// bir kayıt gönderse bile (örn. o müşteri başka biri tarafından silinmiş),
// SADECE o kayıt reddedilir — pakette birlikte gelen diğer geçerli
// kayıtlar yine de kaydedilir. Aksi halde (tek transaction, tek hata =
// hepsi rollback) bozuk bir kayıt o cihazın senkronunu sonsuza dek
// tıkayabilirdi (istemci her denemede aynı bozuk kaydı da göndermeye
// devam eder).
router.post('/sync/push', async (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Geçersiz gövde: records (dizi) gerekli.' });
  }
  if (records.length === 0) {
    return res.json({ ok: true, inserted: 0, failed: [] });
  }
  if (records.length > 500) {
    return res.status(400).json({ error: 'Tek seferde en fazla 500 kayıt gönderilebilir.' });
  }

  for (const r of records) {
    if (!r || !KNOWN_KEYS.includes(r.table) || !r.data || !r.data.id) {
      return res.status(400).json({ error: 'Geçersiz kayıt: her öğede geçerli bir "table" ve id\'li "data" olmalı.', record: r });
    }
  }

  // Kayıtları istemcinin gönderdiği sırada değil, ORDER'a (parent->child)
  // göre işle — offline'da eklenen bir "yeni müşteri" ve o müşteriye bağlı
  // "yeni gelir" aynı pakette gelirse, foreign key hatası almadan müşteri
  // önce eklenmeli.
  const rank = Object.fromEntries(ORDER.map((k, i) => [k, i]));
  const sorted = [...records].sort((a, b) => (rank[a.table] ?? 999) - (rank[b.table] ?? 999));

  const client = await pool.connect();
  let inserted = 0;
  const failed = [];
  try {
    await client.query('BEGIN');
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const sp = 'sp_' + i;
      try {
        await client.query(`SAVEPOINT ${sp}`);
        await insertRow(client, r.table, r.data, { ignoreConflict: true });
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        inserted++;
      } catch (rowErr) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        console.error('Senkron kaydı reddedildi:', r.table, r.data.id, rowErr.message);
        failed.push({ table: r.table, id: r.data.id, error: rowErr.message });
      }
    }
    // En az bir şey değiştiyse (eklendiyse) version'ı ilerlet.
    if (inserted > 0) {
      await client.query('UPDATE app_state_meta SET version = version + 1, updated_at = now() WHERE id = TRUE');
    }
    const versionRes = await client.query('SELECT version FROM app_state_meta WHERE id = TRUE');
    await client.query('COMMIT');
    res.json({ ok: true, inserted, failed, version: versionRes.rows[0].version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/sync/push hatası:', err);
    res.status(500).json({ error: 'Senkronizasyon başarısız.' });
  } finally {
    client.release();
  }
});

module.exports = router;
