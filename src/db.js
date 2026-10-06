import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const schema = `
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
    email TEXT NOT NULL UNIQUE CHECK(length(email) BETWEEN 3 AND 254 AND email = lower(trim(email))),
    department TEXT NOT NULL CHECK(length(trim(department)) BETWEEN 1 AND 100),
    job_title TEXT NOT NULL CHECK(length(trim(job_title)) BETWEEN 1 AND 100),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE CHECK(length(email) BETWEEN 3 AND 254 AND email = lower(trim(email))),
    password_hash TEXT NOT NULL CHECK(length(trim(password_hash)) > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`;

const defaultPath = fileURLToPath(new URL('../data/employees.sqlite', import.meta.url));

export function openDatabase(path = process.env.DB_PATH || defaultPath) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  // ponytail: synchronous queries suit this small admin app; revisit for high concurrent traffic.
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec(schema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export const seedRecords = [
  ['Alex Morgan', 'alex.morgan@example.com', 'Engineering', 'Frontend Developer'],
  ['Sam Taylor', 'sam.taylor@example.com', 'Engineering', 'Backend Developer'],
  ['Jordan Lee', 'jordan.lee@example.com', 'Design', 'Product Designer'],
  ['نور أحمد', 'nour.ahmed@example.com', 'Operations', 'Operations Coordinator'],
  ['Casey Brown', 'casey.brown@example.com', 'Human Resources', 'HR Specialist'],
];

export function seedEmployees(db) {
  const insert = db.prepare(`
    INSERT INTO employees (name, email, department, job_title) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `);

  db.exec('BEGIN');
  try {
    let added = 0;
    for (const employee of seedRecords) added += insert.run(...employee).changes;
    db.exec('COMMIT');
    return added;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
