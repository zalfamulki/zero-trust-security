const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Data demo. Password hanya untuk demo lokal.
const DEMO_USERS = [
  { username: 'admin', name: 'Admin Akademik', role: 'admin', nim: null, password: 'admin123', device: 'DEV-ADMIN-01', label: 'Laptop Admin' },
  { username: 'dosen1', name: 'Dr. Budi Santoso', role: 'dosen', nim: null, password: 'dosen123', device: 'DEV-DSN1-01', label: 'Laptop Dosen 1' },
  { username: 'dosen2', name: 'Dr. Siti Rahma', role: 'dosen', nim: null, password: 'dosen123', device: 'DEV-DSN2-01', label: 'Laptop Dosen 2' },
  { username: 'mhs1', name: 'Andi Pratama', role: 'mahasiswa', nim: '227006001', password: 'mhs123', device: 'DEV-MHS1-01', label: 'HP Andi' },
  { username: 'mhs2', name: 'Rina Sari', role: 'mahasiswa', nim: '227006002', password: 'mhs123', device: 'DEV-MHS2-01', label: 'HP Rina' },
  { username: 'mhs3', name: 'Dimas Putra', role: 'mahasiswa', nim: '227006003', password: 'mhs123', device: 'DEV-MHS3-01', label: 'HP Dimas' },
];

// Kelas 1 dan 2 diampu dosen berbeda dan belum final.
// Kelas 3 sudah final (sudah ada di transkrip) untuk menguji penolakan ubah nilai setelah finalisasi.
const DEMO_CLASSES = [
  { code: 'KP70065004', name: 'Keamanan Informasi', lecturer: 'dosen1', final: false, grades: { mhs1: 85, mhs2: 78, mhs3: 90 } },
  { code: 'KP70012003', name: 'Jaringan Komputer', lecturer: 'dosen2', final: false, grades: { mhs1: 80, mhs2: 88, mhs3: 72 } },
  { code: 'KP70011001', name: 'Algoritma dan Pemrograman', lecturer: 'dosen1', final: true, grades: { mhs1: 90, mhs2: 82, mhs3: 76 } },
];

const DROP_ORDER = ['audit_logs', 'transcripts', 'grades', 'classes', 'refresh_tokens', 'devices', 'users'];

function resetAndSeed(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const now = new Date().toISOString();

  db.transaction(() => {
    for (const t of DROP_ORDER) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec(schema);

    const insUser = db.prepare('INSERT INTO users (username, name, nim, password_hash, role) VALUES (?, ?, ?, ?, ?)');
    const insDevice = db.prepare('INSERT INTO devices (user_id, device_id, label) VALUES (?, ?, ?)');
    const ids = {};
    for (const u of DEMO_USERS) {
      const hash = bcrypt.hashSync(u.password, 10);
      ids[u.username] = Number(insUser.run(u.username, u.name, u.nim, hash, u.role).lastInsertRowid);
      insDevice.run(ids[u.username], u.device, u.label);
    }

    const insClass = db.prepare('INSERT INTO classes (course_code, course_name, lecturer_id) VALUES (?, ?, ?)');
    const insGrade = db.prepare('INSERT INTO grades (class_id, student_id, grade_value, is_final, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insTranscript = db.prepare('INSERT INTO transcripts (student_id, class_id, grade_value, synced_at) VALUES (?, ?, ?, ?)');
    for (const c of DEMO_CLASSES) {
      const classId = Number(insClass.run(c.code, c.name, ids[c.lecturer]).lastInsertRowid);
      for (const [username, value] of Object.entries(c.grades)) {
        insGrade.run(classId, ids[username], value, c.final ? 1 : 0, now);
        if (c.final) insTranscript.run(ids[username], classId, value, now);
      }
    }
  })();
}

module.exports = { resetAndSeed, DEMO_USERS, DEMO_CLASSES };

if (require.main === module) {
  const { loadConfig } = require('./config');
  const { openDb } = require('./db');
  const config = loadConfig();
  const db = openDb(config.dbPath);
  resetAndSeed(db);
  db.close();
  console.log(`Database di-reset dan diisi data demo: ${config.dbPath}`);
  console.log('\nAkun demo (username / password / X-Device-ID):');
  for (const u of DEMO_USERS) {
    console.log(`  ${u.role.padEnd(10)} ${u.username.padEnd(7)} ${u.password.padEnd(9)} ${u.device}${u.nim ? '  NIM ' + u.nim : ''}`);
  }
}
