// Menampilkan audit log terbaru: npm run audit -- 30
const { loadConfig } = require('../shared/config');
const { openDb, assertSeeded } = require('../shared/db');

const config = loadConfig();
const db = openDb(config.dbPath);
assertSeeded(db);

const limit = Math.max(1, Number(process.argv[2]) || 20);
const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit).reverse();

const fmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: config.access.timezone,
  dateStyle: 'short',
  timeStyle: 'medium',
});

for (const r of rows) {
  const time = fmt.format(new Date(r.occurred_at));
  console.log(
    `${time} | ${r.decision.toUpperCase().padEnd(5)} | ${String(r.status_code).padEnd(3)} | ${r.subject} | ` +
      `${r.http_method} ${r.endpoint} | device=${r.device_id} | ${r.reason}`
  );
}
console.log(`\n${rows.length} baris terakhir dari ${config.dbPath}`);
