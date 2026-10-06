import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createAdministrator } from '../src/admin.js';
import { createApp } from '../src/app.js';
import { openDatabase, seedEmployees } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';

const sessionSecret = Buffer.alloc(32, 7).toString('base64');
const adminEmail = 'admin@example.com';
const adminPassword = '  Correct Horse Battery Staple  ';

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function createClient(baseUrl) {
  let cookie = '';
  let csrfToken = '';
  return {
    get csrf() { return csrfToken; },
    get cookie() { return cookie; },
    restore(savedCookie, savedCsrfToken) { cookie = savedCookie; csrfToken = savedCsrfToken; },
    async request(route, options = {}, { csrf = true, origin = 'http://127.0.0.1:3000' } = {}) {
      const headers = new Headers(options.headers);
      if (cookie) headers.set('Cookie', cookie);
      if (csrf && ['POST', 'PATCH', 'DELETE'].includes(options.method)) headers.set('X-CSRF-Token', csrfToken);
      if (origin !== null) headers.set('Origin', origin);
      const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
      for (const value of response.headers.getSetCookie()) cookie = value.split(';', 1)[0];
      if (route === '/api/auth/csrf' && response.ok) csrfToken = (await response.clone().json()).data.csrfToken;
      if (route === '/api/auth/login' && response.ok) csrfToken = (await response.clone().json()).data.csrfToken;
      return response;
    },
    async login({ email = adminEmail, password = adminPassword } = {}) {
      const beforeCookie = cookie;
      const response = await this.request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      return { response, beforeCookie };
    },
  };
}

async function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), 'byte-api-test-'));
  const path = join(directory, 'nested', 'api.sqlite');
  let db = openDatabase(path);
  try {
    await run({ db, path, directory, replaceDatabase: (nextDb) => { db = nextDb; } });
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('administrator setup validates credentials, hashes passwords, and preserves existing account', async () => {
  await withDatabase(async ({ db }) => {
    await assert.rejects(createAdministrator(db, 'bad-email', adminPassword), /valid ADMIN_EMAIL/);
    await assert.rejects(createAdministrator(db, adminEmail, 'short'), /15 to 128/);
    assert.equal(await createAdministrator(db, ' ADMIN@EXAMPLE.COM ', adminPassword), true);
    const first = db.prepare('SELECT email, password_hash FROM users').get();
    assert.equal(first.email, adminEmail);
    assert.notEqual(first.password_hash, adminPassword);
    assert.match(first.password_hash, /^scrypt\$131072\$8\$1\$/);
    assert.equal(await verifyPassword(adminPassword, first.password_hash), true);
    assert.equal(await verifyPassword('incorrect password entirely', first.password_hash), false);
    const [hashA, hashB] = await Promise.all([hashPassword(adminPassword), hashPassword(adminPassword)]);
    assert.notEqual(hashA, hashB, 'same password should have different salted hashes');
    assert.equal(await createAdministrator(db, 'replacement@example.com', 'Another Valid Password Here'), false);
    assert.equal(await createAdministrator(db, undefined, undefined), false, 'repeat setup must work after the password is removed from .env');
    assert.deepEqual(db.prepare('SELECT email, password_hash FROM users').get(), first);
  });
});

test('admin:create CLI creates once and does not print the supplied password', () => {
  const directory = mkdtempSync(join(tmpdir(), 'byte-admin-cli-'));
  const env = {
    ...process.env,
    DB_PATH: join(directory, 'admin.sqlite'),
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
  };
  try {
    const first = spawnSync(process.execPath, ['scripts/create-admin.js'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /created/);
    assert.ok(!first.stdout.includes(adminPassword));
    const repeat = spawnSync(process.execPath, ['scripts/create-admin.js'], { cwd: process.cwd(), env, encoding: 'utf8' });
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /credentials were preserved/);
    const placeholder = spawnSync(process.execPath, ['scripts/create-admin.js'], {
      cwd: process.cwd(), env: { ...env, DB_PATH: join(directory, 'placeholder.sqlite'), ADMIN_EMAIL: 'REPLACE_WITH_ADMIN_EMAIL', ADMIN_PASSWORD: 'REPLACE_WITH_ADMIN_PASSWORD' }, encoding: 'utf8',
    });
    assert.notEqual(placeholder.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normal server requires login and CSRF before employee API access', async () => {
  await withDatabase(async ({ db }) => {
    const { server, baseUrl } = await listen(createApp({ db, sessionSecret }));
    try {
      const paths = [
        ['/api/employees', {}], ['/api/employees/1', {}],
        ['/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
        ['/api/employees/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
        ['/api/employees/1', { method: 'DELETE' }],
      ];
      for (const [route, options] of paths) {
        const response = await fetch(`${baseUrl}${route}`, options);
        assert.equal(response.status, 401);
        assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
      }
      const unknown = await fetch(`${baseUrl}/api/missing`);
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
      const wrongOrigin = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Origin: 'https://evil.example' } });
      assert.equal(wrongOrigin.status, 403);
      assert.equal((await wrongOrigin.json()).error.code, 'INVALID_ORIGIN');
    } finally {
      await close(server);
    }
  });
});

test('login, CSRF, CRUD, validation, logout, and persisted sessions work together', async () => {
  await withDatabase(async ({ db, path, replaceDatabase }) => {
    assert.equal(await createAdministrator(db, adminEmail, adminPassword), true);
    seedEmployees(db);
    const firstServer = await listen(createApp({ db, sessionSecret }));
    let client = createClient(firstServer.baseUrl);
    const secondClient = createClient(firstServer.baseUrl);
    try {
      let response = await client.request('/api/auth/csrf');
      assert.equal(response.status, 200);
      const preLoginToken = client.csrf;
      assert.equal(preLoginToken.length, 43);
      assert.match(response.headers.getSetCookie()[0], /byte\.sid=.*HttpOnly/i);
      assert.match(response.headers.getSetCookie()[0], /SameSite=Strict/i);
      assert.match(response.headers.getSetCookie()[0], /Path=\//i);
      assert.equal(response.headers.get('cache-control'), 'no-store');

      const wrongToken = await client.request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }, { csrf: false });
      assert.equal(wrongToken.status, 403);
      assert.equal((await wrongToken.json()).error.code, 'INVALID_CSRF_TOKEN');

      response = await secondClient.request('/api/auth/csrf');
      assert.equal(response.status, 200);
      const crossSession = await client.request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': secondClient.csrf },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      }, { csrf: false });
      assert.equal(crossSession.status, 403);

      const failedUnknown = await client.login({ email: 'missing@example.com' });
      const failedPassword = await client.login({ password: '  Wrong Password Totally  ' });
      assert.equal(failedUnknown.response.status, 401);
      assert.equal(failedPassword.response.status, 401);
      assert.deepEqual(await failedUnknown.response.json(), await failedPassword.response.json());

      const { response: loginResponse, beforeCookie } = await client.login();
      assert.equal(loginResponse.status, 200);
      const login = (await loginResponse.json()).data;
      assert.equal(login.user.email, adminEmail);
      assert.equal(login.csrfToken.length, 43);
      assert.notEqual(login.csrfToken, preLoginToken);
      assert.notEqual(client.cookie, beforeCookie, 'session ID should rotate at login');
      assert.ok(Date.parse(login.expiresAt) - Date.now() <= 8 * 60 * 60 * 1000);
      assert.ok(Date.parse(login.expiresAt) - Date.now() > 7 * 60 * 60 * 1000);
      assert.equal(loginResponse.headers.get('cache-control'), 'no-store');

      const tamperedClient = createClient(firstServer.baseUrl);
      tamperedClient.restore(`${client.cookie}x`, client.csrf);
      response = await tamperedClient.request('/api/auth/me');
      assert.equal(response.status, 401, 'tampered signed cookie must be rejected');

      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', email: 'missing-csrf@example.com', department: 'Engineering', jobTitle: 'Developer' }),
      }, { csrf: false });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'INVALID_CSRF_TOKEN');

      response = await client.request('/api/auth/me');
      assert.deepEqual((await response.json()).data, { user: { id: login.user.id, email: adminEmail } });
      response = await client.request('/api/employees');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.length, 5);

      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' نور أحمد ', email: ' NOUR.AHMED@example.com ', department: ' Operations ', jobTitle: ' Coordinator ' }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'DUPLICATE_EMAIL');

      const invalidBodies = [
        [{ name: 'Only name' }, 'REQUIRED_FIELDS'],
        [{ name: ' ', email: 'a@b.co', department: 'D', jobTitle: 'T' }, 'INVALID_FIELD'],
        [{ name: 'A', email: 'invalid', department: 'D', jobTitle: 'T' }, 'INVALID_EMAIL'],
        [{ name: 'A', email: 'a@b', department: 'D', jobTitle: 'T' }, 'INVALID_EMAIL'],
        [{ name: 'A', email: 'a@b.co', department: 'D', jobTitle: 'T', extra: 'x' }, 'UNKNOWN_FIELD'],
        [{ name: 'A', email: 'a@b.co', department: 'D', jobTitle: 7 }, 'INVALID_FIELD'],
        [null, 'INVALID_BODY'],
        [[{ name: 'A' }], 'INVALID_BODY'],
        [{ name: 'A'.repeat(101), email: 'a@b.co', department: 'D', jobTitle: 'T' }, 'INVALID_FIELD'],
        [{ name: 'A', email: 'a@b.co', department: 'D'.repeat(101), jobTitle: 'T' }, 'INVALID_FIELD'],
        [{ name: 'A', email: 'a@b.co', department: 'D', jobTitle: 'T'.repeat(101) }, 'INVALID_FIELD'],
        [{ name: 'A', email: 'x'.repeat(243) + '@example.com', department: 'D', jobTitle: 'T' }, 'INVALID_FIELD'],
      ];
      for (const [body, code] of invalidBodies) {
        response = await client.request('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, code);
      }
      response = await client.request('/api/employees', { method: 'POST', body: '{}' });
      assert.equal(response.status, 415);
      response = await client.request('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(response.status, 400);
      response = await client.request('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(17 * 1024) });
      assert.equal(response.status, 413);
      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Valid', email: 'valid@example.com', department: 'Engineering', jobTitle: 'Developer' }),
      }, { origin: 'null' });
      assert.equal(response.status, 403);
      response = await client.request('/api/employees/0');
      assert.equal(response.status, 400);
      response = await client.request('/api/employees/9007199254740992');
      assert.equal(response.status, 400);
      response = await client.request('/api/employees/999999');
      assert.equal(response.status, 404);

      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' Taylor Reed ', email: ' NEW@example.com ', department: ' Design ', jobTitle: ' Designer ' }),
      });
      assert.equal(response.status, 201);
      const created = (await response.json()).data;
      assert.equal(created.name, 'Taylor Reed');
      assert.equal(created.email, 'new@example.com');
      assert.match(response.headers.get('location'), new RegExp(`/api/employees/${created.id}$`));
      assert.match(created.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: "O'Brien'); DROP TABLE employees; --", email: 'sql@example.com', department: 'Engineering', jobTitle: 'Developer' }),
      });
      assert.equal(response.status, 201);
      response = await client.request(`/api/employees/${created.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobTitle: 'Senior Designer' }),
      });
      const updated = (await response.json()).data;
      assert.equal(updated.name, created.name);
      assert.equal(updated.createdAt, created.createdAt);
      assert.ok(updated.updatedAt >= created.updatedAt);
      response = await client.request(`/api/employees/${created.id}`, { method: 'DELETE' });
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      response = await client.request(`/api/employees/${created.id}`);
      assert.equal(response.status, 404);

      const oldToken = preLoginToken;
      response = await client.request('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': oldToken },
        body: JSON.stringify({ name: 'Valid', email: 'valid@example.com', department: 'Engineering', jobTitle: 'Developer' }),
      }, { csrf: false });
      assert.equal(response.status, 403);

      await close(firstServer.server);
      db.close();
      db = openDatabase(path);
      replaceDatabase(db);
      const secondServer = await listen(createApp({ db, sessionSecret }));
      const savedCookie = client.cookie;
      const savedCsrfToken = client.csrf;
      client = createClient(secondServer.baseUrl);
      client.restore(savedCookie, savedCsrfToken);
      try {
        response = await client.request('/api/auth/me');
        assert.equal(response.status, 200, 'authenticated session should survive app restart');

        const sessionRow = db.prepare('SELECT sid, data FROM sessions').all()
          .find((row) => JSON.parse(row.data).userId === login.user.id);
        assert.ok(sessionRow);
        const stored = JSON.parse(sessionRow.data);
        stored.authExpiresAt = Date.now() - 1;
        db.prepare('UPDATE sessions SET data = ?, expires_at = ? WHERE sid = ?').run(JSON.stringify(stored), Date.now() + 60_000, sessionRow.sid);
        response = await client.request('/api/employees');
        assert.equal(response.status, 401, 'expired absolute deadline must reject an otherwise-live store row');
        await client.request('/api/auth/csrf');
        const loginAgain = await client.login();
        assert.equal(loginAgain.response.status, 200);

        db.prepare('DELETE FROM users WHERE id = ?').run(login.user.id);
        response = await client.request('/api/employees');
        assert.equal(response.status, 401, 'deleted administrator must lose access');

        response = await client.request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': client.csrf } }, { csrf: false });
        assert.equal(response.status, 204);
        assert.match(response.headers.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/i);
        response = await client.request('/api/auth/me');
        assert.equal(response.status, 401);
      } finally {
        await close(secondServer.server);
      }

      const reopened = openDatabase(path);
      try {
        assert.equal(reopened.prepare('SELECT count(*) AS total FROM employees').get().total, 6);
        assert.equal(reopened.prepare('SELECT name FROM employees WHERE email = ?').get('sql@example.com').name, "O'Brien'); DROP TABLE employees; --");
      } finally {
        reopened.close();
      }
    } finally {
      if (firstServer.server.listening) await close(firstServer.server);
    }
  });
});

test('login rate limit blocks the sixth failed attempt and emits Retry-After', async () => {
  await withDatabase(async ({ db }) => {
    await createAdministrator(db, adminEmail, adminPassword);
    const { server, baseUrl } = await listen(createApp({ db, sessionSecret }));
    const client = createClient(baseUrl);
    try {
      await client.request('/api/auth/csrf');
      for (let i = 0; i < 6; i += 1) {
        const { response } = await client.login();
        assert.equal(response.status, 200, 'successful logins do not consume the failed-attempt allowance');
      }
      for (let i = 0; i < 5; i += 1) {
        const { response } = await client.login({ password: '  Wrong Password Totally  ' });
        assert.equal(response.status, 401);
      }
      const { response } = await client.login({ password: '  Wrong Password Totally  ' });
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get('retry-after')) > 0);
      assert.equal((await response.json()).error.code, 'RATE_LIMITED');

      for (let i = 1; i < 60; i += 1) {
        const csrfResponse = await client.request('/api/auth/csrf');
        assert.equal(csrfResponse.status, 200);
      }
      const blockedCsrf = await client.request('/api/auth/csrf');
      assert.equal(blockedCsrf.status, 429);
      assert.ok(Number(blockedCsrf.headers.get('retry-after')) > 0);
    } finally {
      await close(server);
    }
  });
});
