import express from 'express';
import { fileURLToPath } from 'node:url';
import { checkOrigin, createAuthRouter, createSessionMiddleware, requireAdministrator, validateSessionSecret } from './auth.js';
import { createEmployeeRouter, employeeErrorHandler } from './employees.js';

export function createApp({ db, sessionSecret, appOrigin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000', trustProxy = false }) {
  if (!db) throw new TypeError('Application requires a database.');
  validateSessionSecret(sessionSecret);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', checkOrigin(appOrigin));
  app.use('/api/auth', createSessionMiddleware({ db, secret: sessionSecret }));
  app.use('/api/employees', createSessionMiddleware({ db, secret: sessionSecret }));
  app.use('/api/auth', createAuthRouter({ db }));
  app.use('/api/employees', createEmployeeRouter({ db, authorize: requireAdministrator(db) }));
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });
  const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
  app.use(express.static(publicPath, { index: false }));
  app.get(['/', '/login'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(`${publicPath}index.html`);
  });
  app.use(employeeErrorHandler);
  return app;
}
