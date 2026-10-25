const crypto = require('crypto');

/**
 * Audit log: setiap keputusan akses dicatat setelah response selesai, sehingga status HTTP ikut tercatat.
 * Yang dicatat: waktu, subjek, endpoint, device, hasil (allow/deny), alasan (+ method, request ID, status).
 * Tidak pernah mencatat password, token, atau secret.
 */
function auditMiddleware(db) {
  const insert = db.prepare(
    `INSERT INTO audit_logs
       (occurred_at, request_id, subject, http_method, endpoint, device_id, decision, reason, status_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  return (req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    req.audit = {
      subject: 'anonymous',
      device: '-',
      decision: 'deny',
      reason: 'request ditolak sebelum keputusan kebijakan',
    };
    res.on('finish', () => {
      try {
        const endpoint = (req.originalUrl || req.url).split('?')[0].slice(0, 200);
        insert.run(
          new Date().toISOString(),
          req.id,
          String(req.audit.subject).slice(0, 120),
          req.method,
          endpoint,
          String(req.audit.device || '-').slice(0, 100),
          req.audit.decision,
          req.audit.reason,
          res.statusCode
        );
      } catch (err) {
        console.error('[audit] gagal menulis log:', err.message);
      }
    });
    next();
  };
}

function setAudit(req, patch) {
  Object.assign(req.audit, patch);
}

module.exports = { auditMiddleware, setAudit };
