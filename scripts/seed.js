import { openDatabase, seedEmployees } from '../src/db.js';

const db = openDatabase();
try {
  const added = seedEmployees(db);
  console.log(`Database ready: ${added} sample employees added; ${db.prepare('SELECT count(*) AS total FROM employees').get().total} employees stored.`);
} finally {
  db.close();
}
