import { hashPassword, isValidEmail, validatePassword } from './passwords.js';

export async function createAdministrator(db, email, password) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
      db.exec('ROLLBACK');
      return false;
    }
    const normalizedEmail = email?.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) throw new TypeError('Set a valid ADMIN_EMAIL.');
    const passwordError = validatePassword(password);
    if (passwordError) throw new TypeError(`ADMIN_PASSWORD ${passwordError.toLowerCase()}`);
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(normalizedEmail, passwordHash);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
