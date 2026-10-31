const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // tiga proses berbagi satu database
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

function assertSeeded(db) {
  const requiredTables = ['users', 'devices', 'classes', 'grades', 'transcripts', 'audit_logs', 'refresh_tokens'];
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN (" +
      requiredTables.map(() => '?').join(',') + ')')
    .all(...requiredTables)
    .map((row) => row.name);

  const missingTables = requiredTables.filter((name) => !tables.includes(name));
  if (missingTables.length > 0) {
    console.error(`Database belum siap: tabel ${missingTables.join(', ')} tidak ditemukan. Jalankan: npm run seed`);
    process.exit(1);
  }

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
      (SELECT COUNT(*) FROM users WHERE role = 'dosen') AS lecturers,
      (SELECT COUNT(*) FROM users WHERE role = 'mahasiswa') AS students,
      (SELECT COUNT(*) FROM classes) AS classes,
      (SELECT COUNT(*) FROM users u
         WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id)) AS users_without_device,
      (SELECT COUNT(*) FROM classes c
         LEFT JOIN users u ON u.id = c.lecturer_id
         WHERE u.role != 'dosen' OR u.id IS NULL) AS classes_without_lecturer
  `).get();

  const problems = [];
  if (counts.admins < 1) problems.push('minimal 1 admin');
  if (counts.lecturers < 2) problems.push('minimal 2 dosen');
  if (counts.students < 3) problems.push('minimal 3 mahasiswa');
  if (counts.classes < 2) problems.push('minimal 2 kelas');
  if (counts.users_without_device > 0) problems.push('setiap user harus memiliki device terdaftar');
  if (counts.classes_without_lecturer > 0) problems.push('setiap kelas harus memiliki dosen pengampu');

  if (problems.length > 0) {
    console.error(`Data demo belum lengkap: ${problems.join('; ')}. Jalankan: npm run seed`);
    process.exit(1);
  }
}

module.exports = { openDb, assertSeeded };
