import { createApp } from '../src/app.js';
import { openRemoteDatabase } from '../src/remote-db.js';

let application;
export default async function handler(req, res) {
  try {
    application ??= openRemoteDatabase().then((db) => createApp({
      db, sessionSecret: process.env.SESSION_SECRET,
      appOrigin: process.env.APP_ORIGIN, trustProxy: 1,
    }));
    const app = await application;
    return app(req, res);
  } catch {
    application = undefined;
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: { code: 'SERVER_UNAVAILABLE', message: 'The server is unavailable. Please try again.' } });
  }
}
