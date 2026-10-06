import { createClient } from '@libsql/client';
import { schema } from './db.js';

// Keep the existing SQL and local SQLite path; only remote queries are asynchronous.
export async function openRemoteDatabase({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  if (!url || !authToken) throw new Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  const client = createClient({ url, authToken, intMode: 'number' });
  try {
    await client.executeMultiple(schema);
  } catch (error) {
    client.close();
    throw error;
  }
  return {
    prepare(sql) {
      const execute = (...args) => client.execute({ sql, args });
      return {
        async get(...args) { return (await execute(...args)).rows[0]; },
        async all(...args) { return (await execute(...args)).rows; },
        async run(...args) {
          const result = await execute(...args);
          return { changes: result.rowsAffected, lastInsertRowid: Number(result.lastInsertRowid) };
        },
      };
    },
    close() { client.close(); },
  };
}
