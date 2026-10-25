const express = require('express');
const { loadConfig } = require('../../shared/config');
const { openDb, assertSeeded } = require('../../shared/db');
const { createVerifier } = require('../../shared/verify');

function createApp(config, db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '500kb' }));

  const { requireGatewaySecret, authorize } = createVerifier(config);

  // Lapis 1: semua request (termasuk /health) wajib membawa X-Gateway-Secret yang benar
  app.use(requireGatewaySecret);
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'service-transkrip' }));

  const q = {
    selfNim: db.prepare('SELECT nim FROM users WHERE id = ?'),
    student: db.prepare("SELECT id, name, nim FROM users WHERE nim = ? AND role = 'mahasiswa'"),
    transcript: db.prepare(
      `SELECT c.course_code, c.course_name, t.grade_value, t.synced_at
         FROM transcripts t JOIN classes c ON c.id = t.class_id
        WHERE t.student_id = ? ORDER BY c.course_code`
    ),
    finalGrade: db.prepare('SELECT grade_value, is_final FROM grades WHERE class_id = ? AND student_id = ?'),
    upsert: db.prepare(
      `INSERT INTO transcripts (student_id, class_id, grade_value, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (student_id, class_id) DO UPDATE SET grade_value = excluded.grade_value, synced_at = excluded.synced_at`
    ),
  };

  // POST /transkrip/sinkron: HANYA token service dari Service Nilai (token user apa pun ditolak)
  app.post(
    '/transkrip/sinkron',
    authorize({ types: ['service'], roles: ['service'], subject: config.serviceClientId }),
    (req, res) => {
      const { class_id: classId, items } = req.body || {};
      if (!Number.isInteger(classId) || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'bad_request', message: 'class_id dan items wajib diisi' });
      }
      for (const it of items) {
        if (!it || !Number.isInteger(it.student_id) || typeof it.grade_value !== 'number') {
          return res.status(400).json({ error: 'bad_request', message: 'format items tidak valid' });
        }
      }
      // Sinkronisasi harus mengacu pada nilai yang sudah final di database
      for (const it of items) {
        const g = q.finalGrade.get(classId, it.student_id);
        if (!g || !g.is_final || g.grade_value !== it.grade_value) {
          return res.status(409).json({ error: 'conflict', message: 'Data sinkron tidak sesuai nilai final di database' });
        }
      }
      const now = new Date().toISOString();
      db.transaction(() => {
        for (const it of items) q.upsert.run(it.student_id, classId, it.grade_value, now);
      })();
      res.json({ synced: items.length, class_id: classId });
    }
  );

  // GET /transkrip/:nim: mahasiswa hanya NIM sendiri, admin semua NIM (dicek ulang di service)
  app.get('/transkrip/:nim', authorize({ types: ['access'], roles: ['mahasiswa', 'admin'] }), (req, res) => {
    const { nim } = req.params;
    if (req.auth.role === 'mahasiswa') {
      const self = q.selfNim.get(req.auth.userId);
      if (!self || self.nim !== nim) {
        return res.status(403).json({ error: 'forbidden', message: 'Mahasiswa hanya boleh melihat transkrip NIM sendiri' });
      }
    }
    const student = q.student.get(nim);
    if (!student) return res.status(404).json({ error: 'not_found', message: 'NIM tidak ditemukan' });
    res.json({ nim: student.nim, nama: student.name, transkrip: q.transcript.all(student.id) });
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Endpoint tidak ditemukan' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const bad = err.type === 'entity.parse.failed';
    if (!bad) console.error('[service-transkrip]', err);
    res.status(bad ? 400 : 500).json({ error: bad ? 'bad_request' : 'internal_error', message: 'Request tidak dapat diproses' });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  assertSeeded(db);
  createApp(config, db).listen(config.ports.transkrip, config.host, () =>
    console.log(`[service-transkrip] aktif di http://${config.host}:${config.ports.transkrip}`)
  );
}
