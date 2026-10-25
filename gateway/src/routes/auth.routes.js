const express = require('express');
const bcrypt = require('bcryptjs');
const { safeEqual } = require('../../../shared/verify');
const { setAudit } = require('../middleware/audit');
const {
  issueAccessToken,
  issueServiceToken,
  createRefreshToken,
  lookupRefreshToken,
  revokeRefreshToken,
} = require('../services/token.service');

// Hash palsu agar waktu respons login tidak membedakan "user tidak ada" dan "password salah"
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

function createAuthRouter({ config, db }) {
  const router = express.Router();
  const findUser = db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?');
  const findDevice = db.prepare('SELECT 1 AS ok FROM devices WHERE user_id = ? AND device_id = ?');

  const reject = (req, res, status, reason, message, patch = {}) => {
    setAudit(req, { decision: 'deny', reason, ...patch });
    return res.status(status).json({ error: status === 401 ? 'unauthorized' : status === 400 ? 'bad_request' : 'forbidden', message, request_id: req.id });
  };

  // POST /auth/login: kredensial valid DAN device terdaftar untuk user tersebut
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const deviceId = req.get('X-Device-ID') || '-';
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reject(req, res, 400, 'username/password tidak lengkap', 'username dan password wajib diisi', {
        subject: 'anonymous',
        device: deviceId,
      });
    }
    const subject = `user:${username.slice(0, 50)}`;
    const user = findUser.get(username);
    const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      return reject(req, res, 401, 'kredensial salah', 'Kredensial tidak valid', { subject, device: deviceId });
    }
    const who = `user:${user.username}(${user.role})`;
    if (deviceId === '-' || !findDevice.get(user.id, deviceId)) {
      return reject(req, res, 403, 'device tidak terdaftar untuk user ini', 'Device tidak terdaftar untuk user ini', {
        subject: who,
        device: deviceId,
      });
    }
    const accessToken = issueAccessToken(config, user);
    const refreshToken = createRefreshToken(db, user);
    setAudit(req, { subject: who, device: deviceId, decision: 'allow', reason: 'kredensial dan device valid' });
    res.json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 600 });
  });

  // POST /auth/refresh: refresh token valid dan belum dicabut -> access token baru
  router.post('/refresh', (req, res) => {
    const deviceId = req.get('X-Device-ID') || '-';
    const found = lookupRefreshToken(db, (req.body || {}).refresh_token);
    if (!found.ok) {
      const subject = found.row ? `user:${found.row.username}(${found.row.role})` : 'anonymous';
      return reject(req, res, 401, found.reason, 'Refresh token tidak valid', { subject, device: deviceId });
    }
    const { row } = found;
    const user = { id: row.user_id, username: row.username, role: row.role };
    setAudit(req, {
      subject: `user:${row.username}(${row.role})`,
      device: deviceId,
      decision: 'allow',
      reason: 'refresh token valid',
    });
    res.json({ access_token: issueAccessToken(config, user), token_type: 'Bearer', expires_in: 600 });
  });

  // POST /auth/logout: mencabut refresh token (pemakaian ulang ditolak)
  router.post('/logout', (req, res) => {
    const deviceId = req.get('X-Device-ID') || '-';
    const found = lookupRefreshToken(db, (req.body || {}).refresh_token);
    if (!found.ok) {
      const subject = found.row ? `user:${found.row.username}(${found.row.role})` : 'anonymous';
      return reject(req, res, 401, found.reason, 'Refresh token tidak valid', { subject, device: deviceId });
    }
    revokeRefreshToken(db, found.row.id);
    setAudit(req, {
      subject: `user:${found.row.username}(${found.row.role})`,
      device: deviceId,
      decision: 'allow',
      reason: 'refresh token dicabut (logout)',
    });
    res.json({ message: 'Logout berhasil, refresh token dicabut' });
  });

  // POST /auth/service: hanya Service Nilai dengan client ID + secret valid -> token service 5 menit
  router.post('/service', (req, res) => {
    const { client_id: clientId, client_secret: clientSecret } = req.body || {};
    const subject = `service:${String(clientId || '?').slice(0, 50)}`;
    const idOk = typeof clientId === 'string' && safeEqual(clientId, config.serviceClientId);
    const secretOk = typeof clientSecret === 'string' && safeEqual(clientSecret, config.serviceClientSecret);
    if (!idOk || !secretOk) {
      return reject(req, res, 401, 'client ID atau secret service salah', 'Kredensial service tidak valid', {
        subject,
        device: 'service',
      });
    }
    setAudit(req, { subject, device: 'service', decision: 'allow', reason: 'kredensial service valid' });
    res.json({ access_token: issueServiceToken(config), token_type: 'Bearer', expires_in: 300 });
  });

  return router;
}

module.exports = { createAuthRouter };
