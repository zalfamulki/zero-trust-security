const jwt = require('jsonwebtoken');
const { JWT_ISSUER } = require('../../../shared/constants');

/**
 * Memverifikasi Bearer token (tanda tangan, masa berlaku, issuer).
 * Hasil: req.identity (atau null + req.authError). Keputusan allow/deny tetap di Policy Engine.
 */
function authenticate(config) {
  return (req, res, next) => {
    req.identity = null;
    req.authError = null;

    const rawHeader = req.get('Authorization');
    if (!rawHeader) {
      req.authError = 'access token tidak ada';
      return next();
    }
    // Jika terdapat header duplikat (misal dari Auth tab + Headers tab di client), ambil token pertama
    const header = rawHeader.split(',')[0].trim();
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) {
      req.authError = 'format header Authorization salah';
      return next();
    }
    try {
      const p = jwt.verify(m[1], config.jwtSecret, { algorithms: ['HS256'], issuer: JWT_ISSUER });
      if (p.typ === 'access' && Number.isInteger(Number(p.sub))) {
        req.identity = { kind: 'user', sub: Number(p.sub), role: p.role, username: p.username };
      } else if (p.typ === 'service') {
        req.identity = { kind: 'service', sub: p.sub, role: p.role };
      } else {
        req.authError = 'jenis token tidak dikenal';
      }
    } catch (err) {
      req.authError = err.name === 'TokenExpiredError' ? 'token kedaluwarsa' : 'token tidak valid';
    }
    next();
  };
}

module.exports = { authenticate };
