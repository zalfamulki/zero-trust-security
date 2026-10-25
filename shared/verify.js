const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_ISSUER } = require('./constants');

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) {
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

/**
 * Verifikasi ulang di sisi service (assume breach).
 *  - requireGatewaySecret: tolak request yang tidak membawa X-Gateway-Secret yang benar
 *  - authorize: verifikasi tanda tangan, masa berlaku, jenis token, role (dan subject) JWT
 * Gateway secret saja tidak cukup; kedua pemeriksaan wajib lolos.
 */
function createVerifier(config) {
  function requireGatewaySecret(req, res, next) {
    const given = req.get('X-Gateway-Secret');
    if (!given || !safeEqual(given, config.gatewaySecret)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Akses langsung ditolak: X-Gateway-Secret tidak ada atau salah',
      });
    }
    next();
  }

  function authorize({ types, roles, subject }) {
    return (req, res, next) => {
      const header = req.get('Authorization') || '';
      const m = /^Bearer\s+(\S+)$/i.exec(header);
      if (!m) {
        return res.status(401).json({ error: 'unauthorized', message: 'Bearer token tidak ada' });
      }
      let payload;
      try {
        payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ['HS256'], issuer: JWT_ISSUER });
      } catch (err) {
        const message = err.name === 'TokenExpiredError' ? 'Token kedaluwarsa' : 'Token tidak valid';
        return res.status(401).json({ error: 'unauthorized', message });
      }
      if (!types.includes(payload.typ)) {
        return res.status(403).json({ error: 'forbidden', message: 'Jenis token tidak diizinkan untuk endpoint ini' });
      }
      if (roles && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'forbidden', message: `Role ${payload.role} tidak diizinkan` });
      }
      if (subject && payload.sub !== subject) {
        return res.status(403).json({ error: 'forbidden', message: 'Subject token tidak diizinkan' });
      }
      let userId = null;
      if (payload.typ === 'access') {
        userId = Number(payload.sub);
        if (!Number.isInteger(userId)) {
          return res.status(401).json({ error: 'unauthorized', message: 'Token tidak valid' });
        }
      }
      req.auth = { typ: payload.typ, sub: payload.sub, userId, role: payload.role, username: payload.username };
      next();
    };
  }

  return { requireGatewaySecret, authorize };
}

module.exports = { createVerifier, safeEqual };
