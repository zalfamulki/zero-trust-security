const { withinAccessHours } = require('../../shared/time');

// Daftar endpoint yang dikenal. Selain ini: default deny.
const ROUTES = [
  { name: 'POST /transkrip/sinkron', method: 'POST', re: /^\/transkrip\/sinkron$/ },
  { name: 'GET /nilai', method: 'GET', re: /^\/nilai$/ },
  { name: 'PUT /nilai/:id', method: 'PUT', re: /^\/nilai\/(\d+)$/ },
  { name: 'POST /kelas/:id/finalisasi', method: 'POST', re: /^\/kelas\/(\d+)\/finalisasi$/ },
  { name: 'GET /transkrip/:nim', method: 'GET', re: /^\/transkrip\/([A-Za-z0-9_-]+)$/ },
];

function matchRoute(method, path) {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(clean);
    if (m) return { name: r.name, params: m.slice(1) };
  }
  return null;
}

const allow = (reason) => ({ allow: true, reason, status: 200 });
const deny = (reason, status = 403) => ({ allow: false, reason, status });

/**
 * Policy Engine (PE/PA). Gateway (PEP) menanyakan keputusan ke fungsi decide().
 * Keputusan memakai atribut dari database, bukan hanya isi token:
 * kepemilikan nilai, kelas yang diampu, status final, device terdaftar, dan jam akses.
 */
function createPolicy({ db, config }) {
  const q = {
    user: db.prepare('SELECT id, username, role, nim FROM users WHERE id = ?'),
    device: db.prepare('SELECT 1 AS ok FROM devices WHERE user_id = ? AND device_id = ?'),
    klass: db.prepare('SELECT id, lecturer_id FROM classes WHERE id = ?'),
    grade: db.prepare(
      'SELECT g.id, g.is_final, c.lecturer_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?'
    ),
  };

  function decide({ identity, method, path, query = {}, deviceId, now = new Date() }) {
    const route = matchRoute(method, path);

    // --- Token service: hanya boleh sinkron transkrip ---
    if (identity.kind === 'service') {
      if (identity.role !== 'service' || identity.sub !== config.serviceClientId) {
        return deny('token service tidak berasal dari Service Nilai');
      }
      if (!route || route.name !== 'POST /transkrip/sinkron') {
        return deny('token service hanya boleh memanggil POST /transkrip/sinkron');
      }
      return allow('token service valid untuk sinkronisasi transkrip');
    }

    // --- Token user: verifikasi atribut akun dan konteks ---
    const user = q.user.get(identity.sub);
    if (!user) return deny('akun pada token tidak ditemukan');
    if (user.role !== identity.role) return deny('role pada token tidak sesuai dengan database');

    if (!deviceId) return deny('header X-Device-ID tidak ada');
    if (!q.device.get(user.id, deviceId)) return deny('device tidak terdaftar untuk user ini');

    if (!route) return deny('endpoint tidak dikenal (default deny)', 404);

    switch (route.name) {
      case 'POST /transkrip/sinkron':
        return deny('token user ditolak: sinkronisasi hanya untuk token service');

      case 'GET /nilai': {
        if (user.role === 'mahasiswa') return allow('mahasiswa: hanya nilai miliknya');
        if (user.role !== 'dosen') return deny(`role ${user.role} tidak boleh melihat nilai`);
        if (query.class_id !== undefined) {
          const classId = Number(query.class_id);
          const klass = Number.isInteger(classId) ? q.klass.get(classId) : null;
          if (!klass) return deny('kelas tidak ditemukan', 404);
          if (klass.lecturer_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
        }
        return allow('dosen: hanya kelas yang diampu');
      }

      case 'PUT /nilai/:id': {
        if (user.role !== 'dosen') return deny(`role ${user.role} tidak boleh mengubah nilai`);
        const grade = q.grade.get(Number(route.params[0]));
        if (!grade) return deny('data nilai tidak ditemukan', 404);
        if (grade.lecturer_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
        if (grade.is_final) return deny('nilai sudah final dan tidak dapat diubah');
        if (!withinAccessHours(now, config.access)) return deny('di luar jam akses perubahan nilai');
        return allow('dosen pengampu, nilai belum final, dalam jam akses');
      }

      case 'POST /kelas/:id/finalisasi': {
        if (user.role !== 'dosen') return deny(`role ${user.role} tidak boleh memfinalisasi nilai`);
        const klass = q.klass.get(Number(route.params[0]));
        if (!klass) return deny('kelas tidak ditemukan', 404);
        if (klass.lecturer_id !== user.id) return deny('kelas bukan yang diampu dosen ini');
        if (!withinAccessHours(now, config.access)) return deny('di luar jam akses finalisasi nilai');
        return allow('dosen pengampu dan dalam jam akses');
      }

      case 'GET /transkrip/:nim': {
        if (user.role === 'admin') return allow('admin: boleh melihat transkrip semua NIM');
        if (user.role === 'mahasiswa') {
          if (user.nim && user.nim === route.params[0]) return allow('mahasiswa: NIM sendiri');
          return deny('mahasiswa hanya boleh melihat transkrip NIM sendiri');
        }
        return deny(`role ${user.role} tidak boleh melihat transkrip`);
      }

      default:
        return deny('endpoint tidak dikenal (default deny)', 404);
    }
  }

  return { decide };
}

module.exports = { createPolicy, matchRoute };
