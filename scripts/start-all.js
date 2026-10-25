// Menjalankan gateway, service nilai, dan service transkrip sebagai tiga proses terpisah.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const apps = [
  ['gateway', 'gateway/src/app.js'],
  ['service-nilai', 'service-nilai/src/app.js'],
  ['service-transkrip', 'service-transkrip/src/app.js'],
];

const children = apps.map(([name, file]) => {
  const child = spawn(process.execPath, [path.join(root, file)], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code) console.error(`[${name}] berhenti dengan kode ${code}`);
  });
  return child;
});

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
