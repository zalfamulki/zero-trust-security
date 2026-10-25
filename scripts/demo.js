// Skrip demo untuk video: menjalankan skenario berhasil dan gagal terhadap server yang sedang berjalan.
//   npm run demo          -> seluruh skenario (jalankan setelah: npm run seed && npm start)
//   npm run demo -- jam   -> hanya uji jam akses (set ACCESS_START=00:00 ACCESS_END=00:00 di .env, restart gateway)
const { loadConfig } = require('../shared/config');
const { DEMO_USERS } = require('../shared/seed');

const config = loadConfig();
const GW = config.urls.gateway;
const NILAI = config.urls.nilai;
const TRANSKRIP = config.urls.transkrip;
const user = (n) => DEMO_USERS.find((u) => u.username === n);

const c = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[90m', b: '\x1b[1m', r: '\x1b[0m' };
let failures = 0;

async function http(base, method, url, { token, device, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (device) h['X-Device-ID'] = device;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* kosong */ }
  return { status: res.status, body: json };
}

function show(title, expectStatus, res, extra = '') {
  const pass = Array.isArray(expectStatus) ? expectStatus.includes(res.status) : res.status === expectStatus;
  if (!pass) failures++;
  const mark = pass ? `${c.ok}OK  ` : `${c.bad}GAGAL`;
  const msg = res.body && (res.body.message || res.body.error) ? ` ${c.dim}${res.body.message || res.body.error}${c.r}` : '';
  console.log(`${mark}${c.r} [${res.status}] ${title}${msg}${extra ? ' ' + c.dim + extra + c.r : ''}`);
}

const section = (t) => console.log(`\n${c.b}== ${t} ==${c.r}`);

async function login(name) {
  const u = user(name);
  const r = await http(GW, 'POST', '/auth/login', { device: u.device, body: { username: u.username, password: u.password } });
  return { ...r, access: r.body && r.body.access_token, refresh: r.body && r.body.refresh_token, device: u.device };
}

async function jamAkses() {
  section('Uji jam akses (gateway harus dijalankan dengan jendela jam tertutup)');
  const d1 = await login('dosen1');
  const list = await http(GW, 'GET', '/nilai', { token: d1.access, device: d1.device });
  const g = list.body.data.find((x) => !x.is_final);
  show('Dosen mengubah nilai di luar jam akses -> harus ditolak', 403, await http(GW, 'PUT', `/nilai/${g.id}`, { token: d1.access, device: d1.device, body: { grade_value: 50 } }));
  show('Dosen finalisasi di luar jam akses -> harus ditolak', 403, await http(GW, 'POST', `/kelas/${g.class_id}/finalisasi`, { token: d1.access, device: d1.device }));
}

async function semua() {
  console.log(`${c.b}Demo Zero Trust Sistem Nilai${c.r}  gateway=${GW}  jam akses ${config.access.start}-${config.access.end} ${config.access.timezone}`);

  section('1. Login dan token');
  const m1 = await login('mhs1');
  show('Login mhs1 (kredensial + device benar)', 200, m1);
  const u = user('mhs1');
  show('Login password salah', 401, await http(GW, 'POST', '/auth/login', { device: u.device, body: { username: u.username, password: 'salah' } }));
  show('Login dengan device milik user lain', 403, await http(GW, 'POST', '/auth/login', { device: user('mhs2').device, body: { username: u.username, password: u.password } }));
  show('GET /nilai tanpa token', 401, await http(GW, 'GET', '/nilai', { device: m1.device }));
  show('GET /nilai dengan token palsu', 401, await http(GW, 'GET', '/nilai', { token: 'palsu.palsu.palsu', device: m1.device }));
  const ref = await http(GW, 'POST', '/auth/refresh', { body: { refresh_token: m1.refresh } });
  show('Refresh token aktif -> access token baru', 200, ref);
  const tmp = await login('mhs3');
  show('Logout (cabut refresh token mhs3)', 200, await http(GW, 'POST', '/auth/logout', { body: { refresh_token: tmp.refresh } }));
  show('Refresh setelah logout -> harus ditolak', 401, await http(GW, 'POST', '/auth/refresh', { body: { refresh_token: tmp.refresh } }));

  section('2. Hak akses dan kepemilikan data');
  const n1 = await http(GW, 'GET', '/nilai', { token: m1.access, device: m1.device });
  show('Mahasiswa GET /nilai (hanya miliknya)', 200, n1, `${n1.body.data.length} baris, NIM: ${[...new Set(n1.body.data.map((x) => x.nim))]}`);
  const d1 = await login('dosen1');
  const d2 = await login('dosen2');
  const nd1 = await http(GW, 'GET', '/nilai', { token: d1.access, device: d1.device });
  show('Dosen1 GET /nilai (kelas yang diampu)', 200, nd1, `kelas: ${[...new Set(nd1.body.data.map((x) => x.course_code))]}`);
  const nd2 = await http(GW, 'GET', '/nilai', { token: d2.access, device: d2.device });
  show('Dosen2 GET /nilai (kelas yang diampu)', 200, nd2, `kelas: ${[...new Set(nd2.body.data.map((x) => x.course_code))]}`);
  const own = nd1.body.data.find((x) => x.course_code === 'KP70065004');
  show('Dosen1 ubah nilai kelasnya', 200, await http(GW, 'PUT', `/nilai/${own.id}`, { token: d1.access, device: d1.device, body: { grade_value: 88 } }));
  show('Dosen2 ubah nilai kelas dosen1 -> harus ditolak', 403, await http(GW, 'PUT', `/nilai/${own.id}`, { token: d2.access, device: d2.device, body: { grade_value: 1 } }));
  const finalRow = nd1.body.data.find((x) => x.is_final);
  show('Ubah nilai yang sudah final -> harus ditolak', 403, await http(GW, 'PUT', `/nilai/${finalRow.id}`, { token: d1.access, device: d1.device, body: { grade_value: 1 } }));
  show('Mahasiswa lihat transkrip NIM sendiri', 200, await http(GW, 'GET', '/transkrip/227006001', { token: m1.access, device: m1.device }));
  show('Mahasiswa lihat transkrip NIM lain -> harus ditolak', 403, await http(GW, 'GET', '/transkrip/227006002', { token: m1.access, device: m1.device }));
  const a = await login('admin');
  show('Admin lihat transkrip NIM mana pun', 200, await http(GW, 'GET', '/transkrip/227006002', { token: a.access, device: a.device }));

  section('3. Konteks: device terdaftar');
  show('Request dengan device milik user lain -> harus ditolak', 403, await http(GW, 'GET', '/nilai', { token: m1.access, device: user('mhs2').device }));
  show('Request tanpa X-Device-ID -> harus ditolak', 403, await http(GW, 'GET', '/nilai', { token: m1.access }));

  section('4. Token service dan finalisasi + sinkronisasi lewat gateway');
  show('Token user (admin) ke /transkrip/sinkron -> harus ditolak', 403, await http(GW, 'POST', '/transkrip/sinkron', { token: a.access, device: a.device, body: { class_id: 1, items: [] } }));
  show('Minta token service dengan secret salah', 401, await http(GW, 'POST', '/auth/service', { body: { client_id: config.serviceClientId, client_secret: 'salah' } }));
  const svc = await http(GW, 'POST', '/auth/service', { body: { client_id: config.serviceClientId, client_secret: config.serviceClientSecret } });
  show('Minta token service dengan kredensial valid', 200, svc);
  const fin = await http(GW, 'POST', `/kelas/${own.class_id}/finalisasi`, { token: d1.access, device: d1.device });
  show('Dosen1 finalisasi kelas -> sinkron ke transkrip', [200, 409], fin, fin.status === 409 ? '(sudah final: jalankan npm run seed untuk reset)' : '');
  show('Transkrip NIM 227006001 setelah sinkron', 200, await http(GW, 'GET', '/transkrip/227006001', { token: a.access, device: a.device }));

  section('5. Pertahanan service (assume breach)');
  show('Langsung ke Service Nilai tanpa secret', 403, await http(NILAI, 'GET', '/nilai', { token: m1.access, device: m1.device }));
  show('Langsung ke Service Transkrip tanpa secret', 403, await http(TRANSKRIP, 'GET', '/transkrip/227006001', { token: a.access }));
  const sec = { 'X-Gateway-Secret': config.gatewaySecret };
  show('Secret benar, tanpa token', 401, await http(NILAI, 'GET', '/nilai', { headers: sec }));
  show('Secret benar, token palsu', 401, await http(TRANSKRIP, 'GET', '/transkrip/227006001', { token: 'x.y.z', headers: sec }));
  show('Secret benar, token user ke /transkrip/sinkron', 403, await http(TRANSKRIP, 'POST', '/transkrip/sinkron', { token: a.access, headers: sec, body: { class_id: 1, items: [] } }));

  console.log(`\n${c.dim}Lihat audit log: npm run audit${c.r}`);
}

(async () => {
  try {
    if (process.argv[2] === 'jam') await jamAkses();
    else await semua();
  } catch (err) {
    console.error('Demo gagal. Pastikan server berjalan (npm start) dan database sudah di-seed:', err.message);
    process.exit(1);
  }
  if (failures) {
    console.log(`${c.bad}${failures} skenario tidak sesuai harapan${c.r}`);
    process.exit(1);
  }
  console.log(`${c.ok}Semua skenario sesuai harapan${c.r}`);
})();
