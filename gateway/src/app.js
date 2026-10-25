const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const { loadConfig } = require('../../shared/config');
const { openDb, assertSeeded } = require('../../shared/db');
const { createPolicy } = require('./policy');
const { auditMiddleware, setAudit } = require('./middleware/audit');
const { authenticate } = require('./middleware/authenticate');
const { protect } = require('./middleware/protect');
const { createAuthRouter } = require('./routes/auth.routes');

function createApp(config, db) {
  const app = express();
  app.disable('x-powered-by');

  // Health check operasional (tidak dicatat di audit log)
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

  app.use(auditMiddleware(db));
  app.use(express.json({ limit: '100kb' }));

  // Endpoint /auth/* ditangani gateway sendiri (Policy Engine / Policy Administrator)
  app.use('/auth', createAuthRouter({ config, db }));

  // Semua endpoint lain: verifikasi token -> keputusan Policy Engine -> audit -> teruskan
  app.use(authenticate(config));
  app.use(protect(createPolicy({ config, db })));

  // Hanya request yang lolos policy yang sampai ke sini. Gateway menimpa X-Gateway-Secret
  // (nilai dari client tidak pernah dipercaya) dan meneruskan Authorization apa adanya.
  // Proxy dipasang di root dengan pathFilter agar path asli tidak terpotong oleh app.use(prefix).
  const forward = (target, pathFilter) =>
    createProxyMiddleware({
      target,
      pathFilter,
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader('X-Gateway-Secret', config.gatewaySecret);
          fixRequestBody(proxyReq, req);
        },
        error: (err, req, res) => {
          if (res.writeHead && !res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad_gateway', message: 'Service tidak dapat dihubungi' }));
        },
      },
    });

  app.use(forward(config.urls.nilai, ['/nilai', '/kelas']));
  app.use(forward(config.urls.transkrip, ['/transkrip']));

  app.use((req, res) => {
    setAudit(req, { decision: 'deny', reason: 'endpoint tidak ditemukan' });
    res.status(404).json({ error: 'not_found', message: 'Endpoint tidak ditemukan', request_id: req.id });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const tooLarge = err.type === 'entity.too.large';
    const badJson = err.type === 'entity.parse.failed';
    const status = tooLarge ? 413 : badJson ? 400 : 500;
    setAudit(req, {
      decision: 'deny',
      reason: tooLarge ? 'body terlalu besar' : badJson ? 'body JSON tidak valid' : 'kesalahan internal gateway',
    });
    if (status === 500) console.error('[gateway]', err);
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'bad_request', message: 'Request tidak dapat diproses', request_id: req.id });
  });

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  assertSeeded(db);
  createApp(config, db).listen(config.ports.gateway, config.host, () => {
    console.log(`[gateway] PEP aktif di http://${config.host}:${config.ports.gateway}`);
    console.log(`[gateway] jam akses ${config.access.start}-${config.access.end} (${config.access.timezone})`);
  });
}
