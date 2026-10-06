import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openRemoteDatabase } from '../src/remote-db.js';
import { hashPassword } from '../src/passwords.js';
import { createApp } from '../src/app.js';

test('asynchronous SQLite adapter supports sessions, CSRF, CRUD and duplicate mapping', async () => {
  const db = await openRemoteDatabase({ url: ':memory:', authToken: 'test' });
  await db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('admin@example.com', await hashPassword('Correct Horse Battery Staple'));
  const server = createServer(createApp({ db, sessionSecret: Buffer.alloc(32, 8).toString('base64') }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let cookie = '', token = '';
  const request = async (path, method = 'GET', body) => {
    const headers = { Cookie: cookie, 'X-CSRF-Token': token };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const value of response.headers.getSetCookie()) cookie = value.split(';')[0];
    return response;
  };
  try {
    assert.equal((await request('employees')).status, 401);
    token = (await (await request('auth/csrf')).json()).data.csrfToken;
    const login = await request('auth/login', 'POST', { email: 'admin@example.com', password: 'Correct Horse Battery Staple' });
    assert.equal(login.status, 200);
    token = (await login.json()).data.csrfToken;
    const record = { name: 'Remote test', email: 'remote@example.com', department: 'QA', jobTitle: 'Tester' };
    const created = await request('employees', 'POST', record);
    assert.equal(created.status, 201);
    const id = (await created.json()).data.id;
    assert.equal((await request('employees', 'POST', record)).status, 409);
    assert.equal((await request(`employees/${id}`, 'PATCH', { name: 'Updated' })).status, 200);
    const removed = await request(`employees/${id}`, 'DELETE');
    assert.equal(removed.status, 204);
    assert.equal(await removed.text(), '');
    assert.equal((await request(`employees/${id}`)).status, 404);
    assert.equal((await request('auth/logout', 'POST')).status, 204);
    assert.equal((await request('employees')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
