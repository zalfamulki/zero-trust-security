// Integration test: menjalankan tiga proses nyata (gateway, service nilai, service transkrip)
// di port khusus tes (13000-13002) dengan database sementara. Nomor tes mengikuti matriks pengujian.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { openDb } = require('../shared/db');
const { resetAndSeed, DEMO_USERS } = require('../shared/seed');

const ROOT = path.join(__dirname, '..');
const P = { gw: 13000, nilai: 13001, transkrip: 13002, gwClosed: 14000 };
const GW = `http://127.0.0.1:${P.gw}`;
const GW_CLOSED = `http://127.0.0.1:${P.gwClosed}`; // gateway dengan jam akses selalu tertutup
const NILAI = `http://127.0.0.1:${P.nilai}`;
const TRANSKRIP = `http://127.0.0.1:${P.transkrip}`;
const S = {
  jwt: 'test-jwt-secret-0123456789abcdef',
  gateway: 'test-gateway-secret-0123456789',
  clientId: 'service-nilai',
  clientSecret: 'test-client-secret-0123456789',
};

let tmp;
let dbFile;
let db;
const procs = [];

const user = (name) => DEMO_USERS.find((u) => u.username === name);

async function call(base, method, url, { token, device, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* body kosong */ }
  return { status: res.status, body: json };
}

async function login(name, base = GW) {
  const u = user(name);
  const r = await call(base, 'POST', '/auth/login', { device: u.device, body: { username: u.username, password: u.password } });
  assert.equal(r.status, 200, `login ${name} gagal: ${JSON.stringify(r.body)}`);
  return { access: r.body.access_token, refresh: r.body.refresh_token, device: u.device };
}

function startProc(file, extraEnv) {
  const env = {
    ...process.env,
    JWT_SECRET: S.jwt,
    GATEWAY_SECRET: S.gateway,
    SERVICE_CLIENT_ID: S.clientId,
    SERVICE_CLIENT_SECRET: S.clientSecret,
    DB_PATH: dbFile,
    HOST: '127.0.0.1',
    PORT_GATEWAY: String(P.gw),
    PORT_NILAI: String(P.nilai),
    PORT_TRANSKRIP: String(P.transkrip),
    GATEWAY_URL: GW,
    SERVICE_NILAI_URL: NILAI,
    SERVICE_TRANSKRIP_URL: TRANSKRIP,
    ACCESS_START: '00:00',
    ACCESS_END: '24:00',
    ACCESS_TZ: 'Asia/Jakarta',
    ...extraEnv,
  };
  const child = spawn(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, env, stdio: 'ignore' });
  procs.push(child);
  return child;
}

async function waitHealthy(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`tidak siap: ${url}`);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-test-'));
  dbFile = path.join(tmp, 'test.db');
  db = openDb(dbFile);
  resetAndSeed(db);

  startProc('gateway/src/app.js');
  startProc('service-nilai/src/app.js');
  startProc('service-transkrip/src/app.js');
  // gateway kedua: jendela jam akses kosong (start == end) untuk menguji penolakan di luar jam
  startProc('gateway/src/app.js', { PORT_GATEWAY: String(P.gwClosed), ACCESS_START: '00:00', ACCESS_END: '00:00' });

  await waitHealthy(`${GW}/health`);
  await waitHealthy(`${GW_CLOSED}/health`);
  await waitHealthy(`${NILAI}/health`).catch(() => {}); // service butuh secret; 403 tetap berarti hidup
  await waitHealthy(`${TRANSKRIP}/health`).catch(() => {});
});

after(async () => {
  await Promise.all(
    procs.map(
      (p) =>
        new Promise((resolve) => {
          if (p.exitCode !== null) return resolve();
          const timer = setTimeout(resolve, 3000);
          timer.unref();
          p.once('exit', () => { clearTimeout(timer); resolve(); });
          p.kill();
        })
    )
  );
  try { db.close(); } catch { /* ignore */ }
  // Windows: handle file SQLite/proses bisa belum dilepas tepat setelah exit -> coba ulang.
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i >= 19) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

// ---------- Autentikasi ----------

test('01 login kredensial dan device benar: access token 10 menit + refresh token', async () => {
  const u = user('mhs1');
  const r = await call(GW, 'POST', '/auth/login', { device: u.device, body: { username: u.username, password: u.password } });
  assert.equal(r.status, 200);
  const claims = jwt.decode(r.body.access_token);
  assert.equal(claims.role, 'mahasiswa');
  assert.ok(claims.sub);
  assert.equal(claims.exp - claims.iat, 600);
  assert.ok(r.body.refresh_token.length > 30);
  const row = db.prepare('SELECT * FROM refresh_tokens ORDER BY id DESC LIMIT 1').get();
  assert.notEqual(row.token_hash, r.body.refresh_token, 'refresh token tidak boleh disimpan polos');
  assert.ok(Math.abs(row.expires_at - Date.now() - 86400000) < 10000, 'refresh token berlaku 1 hari');
});

test('02 login password salah ditolak', async () => {
  const r = await call(GW, 'POST', '/auth/login', { device: user('mhs1').device, body: { username: 'mhs1', password: 'salah' } });
  assert.equal(r.status, 401);
});

test('03 login dengan device tidak terdaftar / milik user lain ditolak', async () => {
  const u = user('mhs1');
  const unknown = await call(GW, 'POST', '/auth/login', { device: 'DEV-TIDAK-ADA', body: { username: u.username, password: u.password } });
  assert.equal(unknown.status, 403);
  const other = await call(GW, 'POST', '/auth/login', { device: user('mhs2').device, body: { username: u.username, password: u.password } });
  assert.equal(other.status, 403);
  const none = await call(GW, 'POST', '/auth/login', { body: { username: u.username, password: u.password } });
  assert.equal(none.status, 403);
});

test('04 endpoint terproteksi tanpa access token ditolak', async () => {
  const r = await call(GW, 'GET', '/nilai', { device: user('mhs1').device });
  assert.equal(r.status, 401);
});

test('05 JWT tidak valid, kedaluwarsa, atau ditandatangani kunci lain ditolak', async () => {
  const d = user('mhs1').device;
  assert.equal((await call(GW, 'GET', '/nilai', { token: 'bukan.jwt.valid', device: d })).status, 401);
  const id = db.prepare("SELECT id FROM users WHERE username='mhs1'").get().id;
  const claims = { role: 'mahasiswa', username: 'mhs1', typ: 'access' };
  const opts = { subject: String(id), issuer: 'sistem-nilai-gateway' };
  const expired = jwt.sign(claims, S.jwt, { ...opts, expiresIn: -10 });
  const expiredRes = await call(GW, 'GET', '/nilai', { token: expired, device: d });
  assert.equal(expiredRes.status, 401);
  assert.match(expiredRes.body.message, /kedaluwarsa/);
  const wrongKey = jwt.sign(claims, 'kunci-lain-kunci-lain-kunci-lain', { ...opts, expiresIn: '10m' });
  assert.equal((await call(GW, 'GET', '/nilai', { token: wrongKey, device: d })).status, 401);
  const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: String(id), role: 'admin', typ: 'access' })).toString('base64url')}.`;
  assert.equal((await call(GW, 'GET', '/nilai', { token: noneAlg, device: d })).status, 401);
});

test('06 refresh dengan token aktif menghasilkan access token baru', async () => {
  const s = await login('mhs1');
  const r = await call(GW, 'POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
  assert.equal(r.status, 200);
  assert.equal((await call(GW, 'GET', '/nilai', { token: r.body.access_token, device: s.device })).status, 200);
});

test('07 refresh setelah dicabut atau kedaluwarsa ditolak', async () => {
  const s = await login('mhs2');
  db.prepare("UPDATE refresh_tokens SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE username='mhs2')").run(Date.now() - 1000);
  const r = await call(GW, 'POST', '/auth/refresh', { body: { refresh_token: s.refresh } });
  assert.equal(r.status, 401);
  assert.equal((await call(GW, 'POST', '/auth/refresh', { body: { refresh_token: 'acak' } })).status, 401);
});

test('08 logout mencabut refresh token; pemakaian ulang ditolak', async () => {
  const s = await login('mhs3');
  assert.equal((await call(GW, 'POST', '/auth/logout', { body: { refresh_token: s.refresh } })).status, 200);
  assert.equal((await call(GW, 'POST', '/auth/refresh', { body: { refresh_token: s.refresh } })).status, 401);
  assert.equal((await call(GW, 'POST', '/auth/logout', { body: { refresh_token: s.refresh } })).status, 401);
  const row = db.prepare('SELECT revoked_at FROM refresh_tokens ORDER BY id DESC LIMIT 1').get();
  assert.ok(row.revoked_at);
});

// ---------- Kebijakan akses ----------

test('09 mahasiswa GET /nilai hanya melihat nilai miliknya', async () => {
  const s = await login('mhs1');
  const r = await call(GW, 'GET', '/nilai', { token: s.access, device: s.device });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 3);
  assert.ok(r.body.data.every((g) => g.nim === '227006001'));
});

test('10 dosen GET /nilai hanya kelas yang diampu', async () => {
  const d2 = await login('dosen2');
  const r2 = await call(GW, 'GET', '/nilai', { token: d2.access, device: d2.device });
  assert.equal(r2.status, 200);
  assert.deepEqual([...new Set(r2.body.data.map((g) => g.course_code))], ['KP70012003']);
  const d1 = await login('dosen1');
  const r1 = await call(GW, 'GET', '/nilai', { token: d1.access, device: d1.device });
  assert.deepEqual([...new Set(r1.body.data.map((g) => g.course_code))].sort(), ['KP70011001', 'KP70065004']);
  // filter ke kelas dosen lain ditolak
  const class2 = db.prepare("SELECT id FROM classes WHERE course_code='KP70012003'").get().id;
  const other = await call(GW, 'GET', `/nilai?class_id=${class2}`, { token: d1.access, device: d1.device });
  assert.equal(other.status, 403);
  // admin tidak boleh melihat nilai
  const a = await login('admin');
  assert.equal((await call(GW, 'GET', '/nilai', { token: a.access, device: a.device })).status, 403);
});

test('11 dosen mengubah nilai kelasnya (belum final, dalam jam akses) berhasil', async () => {
  const d1 = await login('dosen1');
  const list = await call(GW, 'GET', '/nilai', { token: d1.access, device: d1.device });
  const target = list.body.data.find((g) => g.course_code === 'KP70065004' && !g.is_final);
  const r = await call(GW, 'PUT', `/nilai/${target.id}`, { token: d1.access, device: d1.device, body: { grade_value: 95 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.grade_value, 95);
  const bad = await call(GW, 'PUT', `/nilai/${target.id}`, { token: d1.access, device: d1.device, body: { grade_value: 150 } });
  assert.equal(bad.status, 400);
});

test('12 dosen mengubah nilai kelas dosen lain ditolak', async () => {
  const d2 = await login('dosen2');
  const gradeOfClass1 = db.prepare("SELECT g.id FROM grades g JOIN classes c ON c.id=g.class_id WHERE c.course_code='KP70065004' LIMIT 1").get();
  const before = db.prepare('SELECT grade_value FROM grades WHERE id=?').get(gradeOfClass1.id).grade_value;
  const r = await call(GW, 'PUT', `/nilai/${gradeOfClass1.id}`, { token: d2.access, device: d2.device, body: { grade_value: 1 } });
  assert.equal(r.status, 403);
  assert.equal(db.prepare('SELECT grade_value FROM grades WHERE id=?').get(gradeOfClass1.id).grade_value, before);
  // mahasiswa tidak boleh mengubah nilai
  const m = await login('mhs1');
  assert.equal((await call(GW, 'PUT', `/nilai/${gradeOfClass1.id}`, { token: m.access, device: m.device, body: { grade_value: 100 } })).status, 403);
});

test('13 mengubah nilai yang sudah final ditolak', async () => {
  const d1 = await login('dosen1');
  const finalGrade = db.prepare("SELECT g.id FROM grades g JOIN classes c ON c.id=g.class_id WHERE c.course_code='KP70011001' LIMIT 1").get();
  const r = await call(GW, 'PUT', `/nilai/${finalGrade.id}`, { token: d1.access, device: d1.device, body: { grade_value: 100 } });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /final/);
});

test('14 ubah nilai dan finalisasi di luar jam akses ditolak', async () => {
  const d1 = await login('dosen1', GW_CLOSED);
  const grade = db.prepare("SELECT g.id, g.grade_value FROM grades g JOIN classes c ON c.id=g.class_id WHERE c.course_code='KP70065004' LIMIT 1").get();
  const put = await call(GW_CLOSED, 'PUT', `/nilai/${grade.id}`, { token: d1.access, device: d1.device, body: { grade_value: 11 } });
  assert.equal(put.status, 403);
  assert.match(put.body.message, /jam akses/);
  assert.equal(db.prepare('SELECT grade_value FROM grades WHERE id=?').get(grade.id).grade_value, grade.grade_value);
  const class1 = db.prepare("SELECT id FROM classes WHERE course_code='KP70065004'").get().id;
  const fin = await call(GW_CLOSED, 'POST', `/kelas/${class1}/finalisasi`, { token: d1.access, device: d1.device });
  assert.equal(fin.status, 403);
  assert.match(fin.body.message, /jam akses/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM grades WHERE class_id=? AND is_final=1').get(class1).n, 0);
});

test('15-17 transkrip: mahasiswa NIM sendiri ok, NIM lain ditolak, admin boleh semua', async () => {
  const m = await login('mhs1');
  const own = await call(GW, 'GET', '/transkrip/227006001', { token: m.access, device: m.device });
  assert.equal(own.status, 200);
  assert.equal(own.body.nim, '227006001');
  assert.equal(own.body.transkrip.length, 1); // baru kelas final seed
  const other = await call(GW, 'GET', '/transkrip/227006002', { token: m.access, device: m.device });
  assert.equal(other.status, 403);
  const a = await login('admin');
  for (const nim of ['227006001', '227006002', '227006003']) {
    assert.equal((await call(GW, 'GET', `/transkrip/${nim}`, { token: a.access, device: a.device })).status, 200);
  }
  // dosen tidak boleh melihat transkrip
  const d = await login('dosen1');
  assert.equal((await call(GW, 'GET', '/transkrip/227006001', { token: d.access, device: d.device })).status, 403);
});

test('device milik user lain pada request terproteksi ditolak', async () => {
  const m = await login('mhs1');
  const r = await call(GW, 'GET', '/nilai', { token: m.access, device: user('mhs2').device });
  assert.equal(r.status, 403);
  assert.equal((await call(GW, 'GET', '/nilai', { token: m.access })).status, 403);
  assert.equal((await call(GW, 'GET', '/nilai', { token: m.access, device: 'DEV-TIDAK-ADA' })).status, 403);
});

// ---------- Token service dan sinkronisasi ----------

test('18 Service Nilai meminta token service dengan kredensial valid (role service, 5 menit)', async () => {
  const ok = await call(GW, 'POST', '/auth/service', { body: { client_id: S.clientId, client_secret: S.clientSecret } });
  assert.equal(ok.status, 200);
  const claims = jwt.decode(ok.body.access_token);
  assert.equal(claims.role, 'service');
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal((await call(GW, 'POST', '/auth/service', { body: { client_id: S.clientId, client_secret: 'salah' } })).status, 401);
  assert.equal((await call(GW, 'POST', '/auth/service', { body: { client_id: 'lain', client_secret: S.clientSecret } })).status, 401);
});

test('19 token user (termasuk admin) memanggil /transkrip/sinkron ditolak; token service lain endpoint ditolak', async () => {
  const body = { class_id: 1, items: [{ student_id: 4, grade_value: 85 }] };
  for (const name of ['admin', 'dosen1', 'mhs1']) {
    const s = await login(name);
    const r = await call(GW, 'POST', '/transkrip/sinkron', { token: s.access, device: s.device, body });
    assert.equal(r.status, 403, `${name} harus ditolak`);
  }
  const svc = await call(GW, 'POST', '/auth/service', { body: { client_id: S.clientId, client_secret: S.clientSecret } });
  const svcToken = svc.body.access_token;
  assert.equal((await call(GW, 'GET', '/nilai', { token: svcToken })).status, 403);
  assert.equal((await call(GW, 'GET', '/transkrip/227006001', { token: svcToken })).status, 403);
  // token user langsung ke Service Transkrip (secret benar) tetap ditolak oleh service sendiri
  const a = await login('admin');
  const direct = await call(TRANSKRIP, 'POST', '/transkrip/sinkron', { token: a.access, body, headers: { 'X-Gateway-Secret': S.gateway } });
  assert.equal(direct.status, 403);
});

test('20 finalisasi valid: nilai final dan tersinkron ke transkrip melalui gateway', async () => {
  const d1 = await login('dosen1');
  const class1 = db.prepare("SELECT id FROM classes WHERE course_code='KP70065004'").get().id;
  const fin = await call(GW, 'POST', `/kelas/${class1}/finalisasi`, { token: d1.access, device: d1.device });
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.finalized, true);
  assert.equal(fin.body.synced, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM grades WHERE class_id=? AND is_final=1').get(class1).n, 3);
  const a = await login('admin');
  const tr = await call(GW, 'GET', '/transkrip/227006001', { token: a.access, device: a.device });
  const codes = tr.body.transkrip.map((t) => t.course_code);
  assert.ok(codes.includes('KP70065004'));
  // nilai yang diubah di tes 11 (95) ikut tersinkron
  assert.equal(tr.body.transkrip.find((t) => t.course_code === 'KP70065004').grade_value, 95);
  // sinkron lewat gateway: ada audit allow untuk subjek service
  const log = db.prepare("SELECT * FROM audit_logs WHERE endpoint='/transkrip/sinkron' AND decision='allow'").get();
  assert.ok(log, 'audit log sinkron antar-service harus ada');
  assert.match(log.subject, /^service:/);
  // finalisasi ulang ditolak
  assert.equal((await call(GW, 'POST', `/kelas/${class1}/finalisasi`, { token: d1.access, device: d1.device })).status, 409);
  // dosen lain tidak boleh memfinalisasi kelas ini
  const d2 = await login('dosen2');
  assert.equal((await call(GW, 'POST', `/kelas/${class1}/finalisasi`, { token: d2.access, device: d2.device })).status, 403);
});

// ---------- Pertahanan service ----------

test('21 request langsung ke service tanpa/ dengan gateway secret salah ditolak', async () => {
  for (const base of [NILAI, TRANSKRIP]) {
    assert.equal((await call(base, 'GET', '/nilai')).status, 403);
    assert.equal((await call(base, 'GET', '/health')).status, 403);
    assert.equal((await call(base, 'GET', '/transkrip/227006001', { headers: { 'X-Gateway-Secret': 'salah' } })).status, 403);
  }
  const m = await login('mhs1');
  const r = await call(NILAI, 'GET', '/nilai', { token: m.access, device: m.device });
  assert.equal(r.status, 403, 'token valid tanpa gateway secret tetap ditolak');
});

test('22 gateway secret benar tetapi token tidak ada/tidak valid tetap ditolak', async () => {
  const h = { 'X-Gateway-Secret': S.gateway };
  assert.equal((await call(NILAI, 'GET', '/nilai', { headers: h })).status, 401);
  assert.equal((await call(NILAI, 'GET', '/nilai', { token: 'x.y.z', headers: h })).status, 401);
  assert.equal((await call(TRANSKRIP, 'GET', '/transkrip/227006001', { headers: h })).status, 401);
  const wrongKey = jwt.sign({ role: 'admin', username: 'admin', typ: 'access' }, 'kunci-lain-kunci-lain-kunci-lain', { subject: '1', issuer: 'sistem-nilai-gateway', expiresIn: '5m' });
  assert.equal((await call(TRANSKRIP, 'GET', '/transkrip/227006001', { token: wrongKey, headers: h })).status, 401);
  const wrongKeySvc = jwt.sign({ role: 'service', typ: 'service' }, 'kunci-lain-kunci-lain-kunci-lain', { subject: S.clientId, issuer: 'sistem-nilai-gateway', expiresIn: '5m' });
  assert.equal((await call(TRANSKRIP, 'POST', '/transkrip/sinkron', { token: wrongKeySvc, headers: h, body: { class_id: 1, items: [] } })).status, 401);
  // gateway tidak mempercayai X-Gateway-Secret dari client: tetap harus lolos policy
  const spoof = await call(GW, 'GET', '/nilai', { headers: h });
  assert.equal(spoof.status, 401);
});

test('23 audit log mencatat waktu, subjek, endpoint, device, hasil, alasan; tanpa rahasia', async () => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
  assert.ok(rows.length > 20);
  assert.ok(rows.some((r) => r.decision === 'allow'));
  assert.ok(rows.some((r) => r.decision === 'deny'));
  for (const r of rows) {
    assert.ok(r.occurred_at && !Number.isNaN(Date.parse(r.occurred_at)), 'waktu');
    assert.ok(r.subject, 'subjek');
    assert.ok(r.endpoint, 'endpoint');
    assert.ok(r.device_id, 'device');
    assert.ok(['allow', 'deny'].includes(r.decision), 'hasil');
    assert.ok(r.reason, 'alasan');
  }
  const dump = JSON.stringify(rows);
  for (const secret of [S.jwt, S.gateway, S.clientSecret, 'eyJ', 'mhs123', 'dosen123', 'admin123']) {
    assert.ok(!dump.includes(secret), `audit log tidak boleh memuat "${secret}"`);
  }
  assert.ok(rows.some((r) => r.reason.includes('device tidak terdaftar')));
  assert.ok(rows.some((r) => r.reason.includes('jam akses')));
});
