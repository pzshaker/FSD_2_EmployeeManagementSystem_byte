import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

test('frontend routes and assets are served while API errors remain JSON', async () => {
  const db = openDatabase(':memory:');
  const server = createServer(createApp({ db, sessionSecret: Buffer.alloc(32, 9).toString('base64') }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/login']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(await response.text(), /id="login-form"/);
    }
    for (const path of ['/app.js', '/styles.css', '/assets/orbit.svg', '/assets/orbit-inner.svg', '/assets/orbit-accent.svg', '/assets/admin-avatar.svg', '/assets/delete-symbol.svg', '/assets/empty-symbol.svg']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 0);
    }
    const missing = await fetch(origin + '/api/missing');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
    assert.equal((await fetch(origin + '/employees/new')).status, 404);
    assert.equal((await fetch(origin + '/api/employees')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
