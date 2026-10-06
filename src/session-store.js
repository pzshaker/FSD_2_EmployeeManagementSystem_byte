import session from 'express-session';

export class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  async get(sid, callback) {
    try {
      const row = await this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.destroy(sid, (error) => callback(error, null));
        return;
      }
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, value, callback = () => {}) {
    try {
      const cookieExpiry = Date.parse(value.cookie?.expires ?? '');
      const expiresAt = value.authExpiresAt ?? (Number.isFinite(cookieExpiry) ? cookieExpiry : Date.now() + 15 * 60 * 1000);
      await this.db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`)
        .run(sid, JSON.stringify(value), expiresAt);
      await this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, value, callback = () => {}) {
    try {
      const cookieExpiry = Date.parse(value.cookie?.expires ?? '');
      const expiresAt = value.authExpiresAt ?? (Number.isFinite(cookieExpiry) ? cookieExpiry : Date.now() + 15 * 60 * 1000);
      await this.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ? AND expires_at > ?')
        .run(expiresAt, sid, Date.now());
      await this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}
