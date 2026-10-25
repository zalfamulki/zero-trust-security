const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withinAccessHours } = require('../shared/time');
const { matchRoute } = require('../gateway/src/policy');

const jakarta = { start: '07:00', end: '21:00', timezone: 'Asia/Jakarta' };
// Asia/Jakarta = UTC+7 (tanpa DST). 07:00 WIB = 00:00 UTC.
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 25, h - 7, m));

test('jam akses 07.00-21.00 WIB: batas bawah dan atas', () => {
  assert.equal(withinAccessHours(at(6, 59), jakarta), false);
  assert.equal(withinAccessHours(at(7, 0), jakarta), true);
  assert.equal(withinAccessHours(at(12, 0), jakarta), true);
  assert.equal(withinAccessHours(at(20, 59), jakarta), true);
  assert.equal(withinAccessHours(at(21, 0), jakarta), false);
  assert.equal(withinAccessHours(at(23, 30), jakarta), false);
  assert.equal(withinAccessHours(at(3, 0), jakarta), false);
});

test('jam akses memakai zona waktu yang dikonfigurasi, bukan zona server', () => {
  const utc = { start: '07:00', end: '21:00', timezone: 'UTC' };
  const instant = new Date(Date.UTC(2026, 9, 25, 22, 0)); // 22:00 UTC = 05:00 WIB hari berikutnya
  assert.equal(withinAccessHours(instant, utc), false);
  assert.equal(withinAccessHours(instant, jakarta), false);
  const noon = new Date(Date.UTC(2026, 9, 25, 5, 0)); // 05:00 UTC (di luar), 12:00 WIB (di dalam)
  assert.equal(withinAccessHours(noon, utc), false);
  assert.equal(withinAccessHours(noon, jakarta), true);
});

test('konfigurasi jam dapat diubah untuk demo', () => {
  const always = { start: '00:00', end: '24:00', timezone: 'Asia/Jakarta' };
  const never = { start: '00:00', end: '00:00', timezone: 'Asia/Jakarta' };
  assert.equal(withinAccessHours(at(3, 0), always), true);
  assert.equal(withinAccessHours(at(23, 59), always), true);
  assert.equal(withinAccessHours(at(12, 0), never), false);
  const overnight = { start: '22:00', end: '06:00', timezone: 'Asia/Jakarta' };
  assert.equal(withinAccessHours(at(23, 0), overnight), true);
  assert.equal(withinAccessHours(at(5, 0), overnight), true);
  assert.equal(withinAccessHours(at(12, 0), overnight), false);
});

test('format jam tidak valid ditolak', () => {
  assert.throws(() => withinAccessHours(new Date(), { start: '7am', end: '21:00', timezone: 'Asia/Jakarta' }));
  assert.throws(() => withinAccessHours(new Date(), { start: '07:00', end: '25:00', timezone: 'Asia/Jakarta' }));
});

test('pencocokan route: endpoint tidak dikenal tidak cocok (default deny)', () => {
  assert.equal(matchRoute('GET', '/nilai').name, 'GET /nilai');
  assert.equal(matchRoute('PUT', '/nilai/7').params[0], '7');
  assert.equal(matchRoute('POST', '/kelas/2/finalisasi').params[0], '2');
  assert.equal(matchRoute('GET', '/transkrip/227006001').params[0], '227006001');
  assert.equal(matchRoute('POST', '/transkrip/sinkron').name, 'POST /transkrip/sinkron');
  assert.equal(matchRoute('DELETE', '/nilai/1'), null);
  assert.equal(matchRoute('PUT', '/nilai/abc'), null);
  assert.equal(matchRoute('GET', '/admin'), null);
});
