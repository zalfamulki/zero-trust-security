const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  JWT_ISSUER,
  ACCESS_TOKEN_TTL,
  SERVICE_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
} = require('../../../shared/constants');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function issueAccessToken(config, user) {
  return jwt.sign({ role: user.role, username: user.username, typ: 'access' }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: JWT_ISSUER,
  });
}

function issueServiceToken(config) {
  return jwt.sign({ role: 'service', typ: 'service' }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: config.serviceClientId,
    expiresIn: SERVICE_TOKEN_TTL,
    issuer: JWT_ISSUER,
  });
}

// Refresh token acak; yang disimpan di database hanya hash-nya.
function createRefreshToken(db, user) {
  const raw = crypto.randomBytes(48).toString('base64url');
  db.prepare(
    'INSERT INTO refresh_tokens (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, sha256(raw), new Date().toISOString(), Date.now() + REFRESH_TOKEN_TTL_MS);
  return raw;
}

// Mengembalikan { ok, reason, row }. row berisi data refresh token + user.
function lookupRefreshToken(db, raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'refresh token tidak ada' };
  const row = db
    .prepare(
      `SELECT r.id, r.user_id, r.expires_at, r.revoked_at, u.username, u.role
         FROM refresh_tokens r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ?`
    )
    .get(sha256(raw));
  if (!row) return { ok: false, reason: 'refresh token tidak dikenal' };
  if (row.revoked_at) return { ok: false, reason: 'refresh token sudah dicabut', row };
  if (row.expires_at <= Date.now()) return { ok: false, reason: 'refresh token kedaluwarsa', row };
  return { ok: true, row };
}

function revokeRefreshToken(db, id) {
  return db
    .prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), id).changes;
}

module.exports = {
  issueAccessToken,
  issueServiceToken,
  createRefreshToken,
  lookupRefreshToken,
  revokeRefreshToken,
};
