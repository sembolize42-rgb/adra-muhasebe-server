const express = require('express');
const pool = require('../db/pool');
const { readState } = require('../db/readState');
const { replaceState } = require('../db/replaceState');

const router = express.Router();

// GET /api/state -> { state, version }
router.get('/state', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await readState(client);
    res.json(result);
  } catch (err) {
    console.error('GET /api/state hatası:', err);
    res.status(500).json({ error: 'Veri okunamadı.' });
  } finally {
    client.release();
  }
});

// PUT /api/state  body: { state, baseVersion }
// baseVersion, istemcinin en son GET ile aldığı version. Bu arada başka biri
// kaydettiyse (version ilerlediyse) 409 döner — istemci en güncel veriyi
// çekip kullanıcıyı uyarmalı. Bu, iki kişinin aynı anda üzerine yazmasını
// (sessiz veri kaybını) engelleyen basit iyimser eşzamanlılık kontrolüdür.
router.put('/state', async (req, res) => {
  const { state, baseVersion } = req.body || {};
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Geçersiz gövde: state gerekli.' });
  }
  if (typeof baseVersion !== 'number') {
    return res.status(400).json({ error: 'Geçersiz gövde: baseVersion (number) gerekli.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT version FROM app_state_meta WHERE id = TRUE FOR UPDATE');
    const currentVersion = cur.rows[0].version;
    if (currentVersion !== baseVersion) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Çakışma: veri başka biri tarafından güncellendi. Sayfayı yenileyip tekrar dene.',
        currentVersion
      });
    }
    await replaceState(client, state, { bumpVersion: true });
    const updated = await client.query('SELECT version FROM app_state_meta WHERE id = TRUE');
    await client.query('COMMIT');
    res.json({ ok: true, version: updated.rows[0].version });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/state hatası:', err);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  } finally {
    client.release();
  }
});

module.exports = router;
