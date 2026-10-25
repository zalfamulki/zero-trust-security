const { setAudit } = require('./audit');

/**
 * Policy Enforcement Point: meminta keputusan ke Policy Engine (token + device + kebijakan + jam akses),
 * mencatat keputusan, dan menolak request SEBELUM diteruskan ke service jika deny.
 */
function protect(policy) {
  return (req, res, next) => {
    const deviceId = req.get('X-Device-ID');

    if (!req.identity) {
      setAudit(req, {
        subject: 'anonymous',
        device: deviceId || '-',
        decision: 'deny',
        reason: req.authError || 'tidak terautentikasi',
      });
      return res.status(401).json({ error: 'unauthorized', message: req.authError, request_id: req.id });
    }

    const subject =
      req.identity.kind === 'service'
        ? `service:${req.identity.sub}`
        : `user:${req.identity.username}(${req.identity.role})`;

    const decision = policy.decide({
      identity: req.identity,
      method: req.method,
      path: req.path,
      query: req.query,
      deviceId,
      now: new Date(),
    });

    setAudit(req, {
      subject,
      device: req.identity.kind === 'service' ? 'service' : deviceId || '-',
      decision: decision.allow ? 'allow' : 'deny',
      reason: decision.reason,
    });

    if (!decision.allow) {
      return res.status(decision.status).json({ error: 'forbidden', message: decision.reason, request_id: req.id });
    }
    next();
  };
}

module.exports = { protect };
