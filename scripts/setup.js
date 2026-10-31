// Membuat .env dengan secret acak. Tidak bergantung pada .env.example. Tidak menimpa .env yang sudah ada.
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

const text = `# Dibuat otomatis oleh: npm run setup
# JANGAN commit file .env.

PORT_GATEWAY=3000
PORT_NILAI=3001
PORT_TRANSKRIP=3002
HOST=127.0.0.1

# Kunci tanda tangan JWT (access token dan token service)
JWT_SECRET=${rand()}
# Dikirim gateway lewat header X-Gateway-Secret ke service
GATEWAY_SECRET=${rand()}
# Kredensial Service Nilai untuk POST /auth/service
SERVICE_CLIENT_ID=service-nilai
SERVICE_CLIENT_SECRET=${rand()}

# Jam akses perubahan/finalisasi nilai (format HH:MM, zona waktu ACCESS_TZ).
# Ubah saat demo, contoh ACCESS_START=00:00 dan ACCESS_END=00:00 = selalu di luar jam akses.
ACCESS_START=07:00
ACCESS_END=21:00
ACCESS_TZ=Asia/Jakarta

# Lokasi database SQLite bersama
DB_PATH=data/sistem-nilai.db

# Opsional: URL antar komponen (default memakai HOST dan port di atas)
# GATEWAY_URL=http://127.0.0.1:3000
# SERVICE_NILAI_URL=http://127.0.0.1:3001
# SERVICE_TRANSKRIP_URL=http://127.0.0.1:3002
`;

fs.writeFileSync(target, text, { mode: 0o600 });
console.log('.env dibuat dengan secret acak. Lanjut: npm run seed');
