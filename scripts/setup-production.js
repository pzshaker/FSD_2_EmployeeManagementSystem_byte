import { openDatabase, seedRecords } from '../src/db.js';
import { openRemoteDatabase } from '../src/remote-db.js';

// Run explicitly once: never bootstrap credentials or restore deleted rows on requests.
const local = openDatabase();
const remote = await openRemoteDatabase();
try {
  const user = local.prepare('SELECT email, password_hash FROM users LIMIT 1').get();
  if (!user) throw new Error('Create the local administrator before setting up production.');
  if (!await remote.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    await remote.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(user.email, user.password_hash);
    console.log('Production administrator created with the existing local credentials.');
  } else {
    console.log('Existing production administrator preserved.');
  }

  for (const employee of seedRecords) {
    await remote.prepare('INSERT INTO employees (name, email, department, job_title) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING').run(...employee);
  }
  console.log('Production seed completed; existing employee records preserved.');
} finally {
  local.close();
  remote.close();
}
