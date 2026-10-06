import { createServer } from 'node:http';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

let db;
try {
  db = openDatabase();
} catch (error) {
  console.error('Could not open the SQLite database. Check DB_PATH and directory permissions.');
  console.error(error.message);
  process.exit(1);
}

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer from 0 to 65535.');
  db.close();
  process.exit(1);
}

let app;
try {
  app = createApp({ db, sessionSecret: process.env.SESSION_SECRET });
} catch (error) {
  console.error(error.message);
  db.close();
  process.exit(1);
}

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  console.warn('No administrator account exists. Configure ADMIN_EMAIL and ADMIN_PASSWORD, then run npm run admin:create.');
}

const server = createServer(app);
server.on('error', (error) => {
  console.error(`Could not start the server: ${error.code || 'unknown error'}. Check HOST and PORT.`);
  db.close();
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Employee API listening at http://${host}:${server.address().port}`);
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
