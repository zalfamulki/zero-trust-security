const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
// Variabel yang sudah ada di environment proses tidak ditimpa oleh .env
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('ganti-dengan')) {
    throw new Error(
      `Environment ${name} belum diatur. Jalankan "npm run setup" lalu periksa file .env`
    );
  }
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Environment ${name} harus berupa bilangan bulat`);
  return n;
}

function loadConfig() {
  const host = process.env.HOST || '127.0.0.1';
  const ports = {
    gateway: int('PORT_GATEWAY', 3000),
    nilai: int('PORT_NILAI', 3001),
    transkrip: int('PORT_TRANSKRIP', 3002),
  };
  return {
    host,
    ports,
    urls: {
      gateway: process.env.GATEWAY_URL || `http://127.0.0.1:${ports.gateway}`,
      nilai: process.env.SERVICE_NILAI_URL || `http://127.0.0.1:${ports.nilai}`,
      transkrip: process.env.SERVICE_TRANSKRIP_URL || `http://127.0.0.1:${ports.transkrip}`,
    },
    jwtSecret: required('JWT_SECRET'),
    gatewaySecret: required('GATEWAY_SECRET'),
    serviceClientId: required('SERVICE_CLIENT_ID'),
    serviceClientSecret: required('SERVICE_CLIENT_SECRET'),
    access: {
      start: process.env.ACCESS_START || '07:00',
      end: process.env.ACCESS_END || '21:00',
      timezone: process.env.ACCESS_TZ || 'Asia/Jakarta',
    },
    dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/sistem-nilai.db'),
  };
}

module.exports = { loadConfig, ROOT };
