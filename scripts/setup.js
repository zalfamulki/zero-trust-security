// Membuat .env dari .env.example dengan secret acak. Tidak menimpa .env yang sudah ada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const target = path.join(root, '.env');

if (fs.existsSync(target)) {
  console.log('.env sudah ada, tidak diubah.');
  process.exit(0);
}

const rand = () => crypto.randomBytes(32).toString('hex');
const text = fs
  .readFileSync(path.join(root, '.env.example'), 'utf8')
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${rand()}`)
  .replace(/^GATEWAY_SECRET=.*$/m, `GATEWAY_SECRET=${rand()}`)
  .replace(/^SERVICE_CLIENT_SECRET=.*$/m, `SERVICE_CLIENT_SECRET=${rand()}`);

fs.writeFileSync(target, text, { mode: 0o600 });
console.log('.env dibuat dengan secret acak. Lanjut: npm run seed');
