const express = require('express');
const { loadConfig } = require('../../shared/config');
const { openDb, assertSeeded } = require('../../shared/db');
const { createVerifier } = require('../../shared/verify');
const { withinAccessHours } = require('../../shared/time');

const GRADE_SELECT = `
  SELECT g.id, g.class_id, c.course_code, c.course_name, u.nim, u.name AS student_name,
         g.grade_value, g.is_final, g.updated_at
    FROM grades g
    JOIN classes c ON c.id = g.class_id
    JOIN users u ON u.id = g.student_id`;

function createApp(config, db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const { requireGatewaySecret, authorize } = createVerifier(config);

  // Lapis 1: semua request (termasuk /health) wajib membawa X-Gateway-Secret yang benar
  app.use(requireGatewaySecret);
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'service-nilai' }));

  const q = {
    gradeById: db.prepare(
      'SELECT g.id, g.is_final, c.lecturer_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?'
    ),
    klass: db.prepare('SELECT id, lecturer_id FROM classes WHERE id = ?'),
    pending: db.prepare('SELECT COUNT(*) AS n FROM grades WHERE class_id = ? AND is_final = 0'),
    classGrades: db.prepare('SELECT student_id, grade_value FROM grades WHERE class_id = ? ORDER BY student_id'),
    oneGrade: db.prepare(`${GRADE_SELECT} WHERE g.id = ?`),
  };

  const outsideHours = (res) =>
    res.status(403).json({ error: 'forbidden', message: 'Di luar jam akses perubahan/finalisasi nilai' });

  // GET /nilai (lapis 2: token valid; mahasiswa/dosen). Data difilter berdasarkan identitas token.
  app.get('/nilai', authorize({ types: ['access'], roles: ['mahasiswa', 'dosen'] }), (req, res) => {
    let rows;
    if (req.auth.role === 'mahasiswa') {
      rows = db.prepare(`${GRADE_SELECT} WHERE g.student_id = ? ORDER BY c.id`).all(req.auth.userId);
    } else if (req.query.class_id !== undefined) {
      const classId = Number(req.query.class_id);
      if (!Number.isInteger(classId)) return res.status(400).json({ error: 'bad_request', message: 'class_id tidak valid' });
      rows = db
        .prepare(`${GRADE_SELECT} WHERE c.lecturer_id = ? AND g.class_id = ? ORDER BY g.id`)
        .all(req.auth.userId, classId);
    } else {
      rows = db.prepare(`${GRADE_SELECT} WHERE c.lecturer_id = ? ORDER BY c.id, g.id`).all(req.auth.userId);
    }
    res.json({ data: rows.map((r) => ({ ...r, is_final: Boolean(r.is_final) })) });
  });

  // PUT /nilai/:id (dosen pengampu, belum final, dalam jam akses) - dicek ulang di service
  app.put('/nilai/:id', authorize({ types: ['access'], roles: ['dosen'] }), (req, res) => {
    const id = Number(req.params.id);
    const value = (req.body || {}).grade_value;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_request', message: 'id tidak valid' });
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return res.status(400).json({ error: 'bad_request', message: 'grade_value harus angka 0-100' });
    }
    const grade = q.gradeById.get(id);
    if (!grade) return res.status(404).json({ error: 'not_found', message: 'Data nilai tidak ditemukan' });
    if (grade.lecturer_id !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden', message: 'Kelas bukan yang diampu dosen ini' });
    }
    if (grade.is_final) return res.status(409).json({ error: 'conflict', message: 'Nilai sudah final' });
    if (!withinAccessHours(new Date(), config.access)) return outsideHours(res);

    db.prepare('UPDATE grades SET grade_value = ?, updated_at = ? WHERE id = ?').run(value, new Date().toISOString(), id);
    const row = q.oneGrade.get(id);
    res.json({ data: { ...row, is_final: Boolean(row.is_final) } });
  });

  // POST /kelas/:id/finalisasi -> kunci nilai, minta token service, sinkron transkrip LEWAT GATEWAY
  app.post('/kelas/:id/finalisasi', authorize({ types: ['access'], roles: ['dosen'] }), async (req, res) => {
    const classId = Number(req.params.id);
    if (!Number.isInteger(classId)) return res.status(400).json({ error: 'bad_request', message: 'id kelas tidak valid' });
    const klass = q.klass.get(classId);
    if (!klass) return res.status(404).json({ error: 'not_found', message: 'Kelas tidak ditemukan' });
    if (klass.lecturer_id !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden', message: 'Kelas bukan yang diampu dosen ini' });
    }
    if (!withinAccessHours(new Date(), config.access)) return outsideHours(res);

    const rows = q.classGrades.all(classId);
    if (rows.length === 0) return res.status(409).json({ error: 'conflict', message: 'Kelas belum memiliki nilai' });
    if (q.pending.get(classId).n === 0) {
      return res.status(409).json({ error: 'conflict', message: 'Kelas sudah difinalisasi' });
    }

    db.prepare('UPDATE grades SET is_final = 1, updated_at = ? WHERE class_id = ?').run(new Date().toISOString(), classId);

    try {
      // 1) token service dari gateway (client ID + secret)
      const tokenRes = await fetch(`${config.urls.gateway}/auth/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: config.serviceClientId, client_secret: config.serviceClientSecret }),
        signal: AbortSignal.timeout(5000),
      });
      if (!tokenRes.ok) throw new Error(`gateway menolak permintaan token service (HTTP ${tokenRes.status})`);
      const { access_token: serviceToken } = await tokenRes.json();

      // 2) sinkron transkrip melalui gateway (bukan langsung ke port 3002)
      const syncRes = await fetch(`${config.urls.gateway}/transkrip/sinkron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken}` },
        body: JSON.stringify({
          class_id: classId,
          items: rows.map((r) => ({ student_id: r.student_id, grade_value: r.grade_value })),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!syncRes.ok) throw new Error(`sinkronisasi transkrip gagal (HTTP ${syncRes.status})`);
      const sync = await syncRes.json();
      res.json({ class_id: classId, finalized: true, synced: sync.synced });
    } catch (err) {
      // Tanpa sinkronisasi, finalisasi dibatalkan agar nilai dan transkrip tetap konsisten
      db.prepare('UPDATE grades SET is_final = 0 WHERE class_id = ?').run(classId);
      res.status(502).json({ error: 'sync_failed', message: `Finalisasi dibatalkan: ${err.message}` });
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Endpoint tidak ditemukan' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const bad = err.type === 'entity.parse.failed';
    if (!bad) console.error('[service-nilai]', err);
    res.status(bad ? 400 : 500).json({ error: bad ? 'bad_request' : 'internal_error', message: 'Request tidak dapat diproses' });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  assertSeeded(db);
  createApp(config, db).listen(config.ports.nilai, config.host, () =>
    console.log(`[service-nilai] aktif di http://${config.host}:${config.ports.nilai}`)
  );
}
