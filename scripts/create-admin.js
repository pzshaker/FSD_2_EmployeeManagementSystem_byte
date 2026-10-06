import { openDatabase } from '../src/db.js';
import { createAdministrator } from '../src/admin.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const db = openDatabase();
try {
  const created = await createAdministrator(db, email, password);
  if (!created) {
    console.log('An administrator already exists; existing credentials were preserved.');
  } else {
    console.log(`Administrator ${email} created. Remove ADMIN_PASSWORD from .env now.`);
  }
} catch (error) {
  console.error(`${error instanceof TypeError ? error.message : 'Could not create administrator. Check database access and configuration.'}`);
  process.exitCode = 1;
} finally {
  db.close();
}
