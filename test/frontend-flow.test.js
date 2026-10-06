import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createAdministrator } from '../src/admin.js';

test('finished frontend: real desktop/mobile flows and final regression checks', {
  skip: !process.env.BYTE_PLAYWRIGHT_MODULE && 'Set BYTE_PLAYWRIGHT_MODULE to an existing Playwright index.mjs.',
  timeout: 180_000,
}, async (t) => {
  const { chromium } = await import(pathToFileURL(resolve(process.env.BYTE_PLAYWRIGHT_MODULE)).href);
  const db = openDatabase(':memory:');
  const admin = { email: 'polish-admin@example.com', password: 'Disposable flow password 123!' };
  await createAdministrator(db, admin.email, admin.password);
  for (const values of [
    ['Amelia Morgan', 'amelia.morgan@northstar.io', 'Engineering', 'Senior Developer'],
    ['Jonah Lee', 'jonah.lee@northstar.io', 'Design', 'Product Designer'],
    ['Sofia Khan', 'sofia.khan@northstar.io', 'People', 'HR Generalist'],
    ['Daniel Mensah', 'daniel.mensah@northstar.io', 'Operations', 'Operations Lead'],
    ['Yasmin Adel', 'yasmin.adel@northstar.io', 'Finance', 'Financial Analyst'],
  ]) db.prepare('INSERT INTO employees (name, email, department, job_title) VALUES (?, ?, ?, ?)').run(...values);
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({ db, appOrigin: origin, sessionSecret: Buffer.alloc(32, 11).toString('base64') }));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() !== 'GET' && request.url().startsWith(origin + '/api/')) writes.push(request); });
    const waitIdle = () => page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    const login = async () => {
      await page.locator('#email').fill(admin.email);
      await page.locator('#password').fill(admin.password);
      await page.locator('#sign-in').click();
      await page.locator('#directory').waitFor({ state: 'visible' });
      await waitIdle();
    };
    const logout = async () => {
      await page.locator('#account-toggle').click();
      await page.locator('#sign-out').click();
      await page.locator('#login').waitFor({ state: 'visible' });
    };
    const fill = async (values) => { for (const [key, value] of Object.entries(values)) await page.locator(`#employee-${key}`).fill(value); };
    const save = async () => {
      await page.locator('#employee-submit').click();
      await page.waitForFunction(() => !document.querySelector('#employee-submit').disabled);
    };
    const screenshot = async (name) => {
      if (!process.env.BYTE_SCREENSHOTS) return;
      await mkdir(resolve(process.env.BYTE_SCREENSHOTS), { recursive: true });
      await page.screenshot({ path: resolve(process.env.BYTE_SCREENSHOTS, name) });
    };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.goto(origin);

    for (const [size, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
      await t.test(`${size}: sign in, list, create, edit, cancel/delete, logout and unauthenticated access`, async () => {
        await page.setViewportSize({ width, height });
        await page.locator('#login').waitFor({ state: 'visible' });
        await screenshot(`sign-in-${size}.png`);
        await noOverflow();
        await page.getByRole('button', { name: 'Show password', exact: true }).click();
        assert.equal(await page.locator('#password').getAttribute('type'), 'text');
        await page.getByRole('button', { name: 'Hide password', exact: true }).click();
        await login();
        assert.equal(await page.locator('#employee-count').textContent(), '5 employees');
        assert.equal(await page.locator('#password').inputValue(), '');
        const cookie = (await page.context().cookies()).find((cookie) => cookie.name === 'byte.sid');
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'Strict');
        await screenshot(`directory-${size}.png`);
        await page.locator('#account-toggle').click();
        await screenshot(`account-${size}.png`);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'account-toggle');
        await page.locator('#add-employee').click();
        await screenshot(`add-${size}.png`);
        const values = { name: 'Nora Patel', email: `nora.${size}@example.com`, department: 'People', jobTitle: 'People Partner' };
        await fill(values);
        await save();
        assert.equal(await page.locator('#save-title').textContent(), 'Employee added');
        const row = db.prepare('SELECT * FROM employees WHERE email = ?').get(values.email);
        assert.ok(row);
        assert.equal(await page.locator('#employee-count').textContent(), '6 employees');
        await screenshot(`created-${size}.png`);
        await page.getByRole('button', { name: 'Edit Nora Patel', exact: true }).click();
        await screenshot(`edit-${size}.png`);
        await fill({ jobTitle: 'Senior People Partner' });
        await save();
        const changed = db.prepare('SELECT * FROM employees WHERE id = ?').get(row.id);
        assert.equal(changed.job_title, 'Senior People Partner');
        assert.equal(changed.created_at, row.created_at);
        assert.equal(await page.locator('#save-title').textContent(), 'Changes saved');
        await screenshot(`saved-${size}.png`);
        await page.getByRole('button', { name: 'Delete Nora Patel', exact: true }).click();
        const before = writes.length;
        await page.locator('#delete-cancel').click();
        assert.equal(writes.length, before);
        assert.ok(db.prepare('SELECT id FROM employees WHERE id = ?').get(row.id));
        await page.getByRole('button', { name: 'Delete Nora Patel', exact: true }).click();
        await screenshot(`delete-${size}.png`);
        await page.locator('#delete-submit').click();
        await page.locator('#delete-dialog').waitFor({ state: 'hidden' });
        assert.equal(db.prepare('SELECT id FROM employees WHERE id = ?').get(row.id), undefined);
        assert.equal(await page.locator('#save-title').textContent(), 'Employee deleted');
        assert.equal(await page.locator('#employee-count').textContent(), '5 employees');
        await screenshot(`deleted-${size}.png`);
        await noOverflow();
        // Reload discards the in-memory token; logout must retrieve it safely.
        await page.reload();
        await page.locator('#directory').waitFor({ state: 'visible' });
        await waitIdle();
        const deadline = (await page.context().cookies()).find((cookie) => cookie.name === 'byte.sid').expires;
        await page.request.get(origin + '/api/auth/csrf');
        assert.equal((await page.context().cookies()).find((cookie) => cookie.name === 'byte.sid').expires, deadline);
        await logout();
        assert.equal(writes.at(-1).url(), origin + '/api/auth/logout');
        assert.ok(writes.at(-1).headers()['x-csrf-token']);
        assert.match(await page.locator('#login-message').textContent(), /signed out/);
        for (const path of ['/api/auth/me', '/api/employees', '/api/employees/1']) assert.equal((await page.request.get(origin + path)).status(), 401);
        assert.equal((await page.request.delete(origin + '/api/employees/1')).status(), 401);
        await page.reload();
        await page.locator('#login').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      });
    }

    await t.test('invalid sign-in, pending duplicate prevention and Retry-After', async () => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.locator('#email').fill(admin.email);
      await page.locator('#password').fill('Wrong disposable password 123!');
      await page.locator('#sign-in').click();
      await page.waitForFunction(() => !document.querySelector('#sign-in').disabled);
      assert.match(await page.locator('#login-message').textContent(), /incorrect/);
      assert.equal(await page.locator('#password').inputValue(), 'Wrong disposable password 123!');
      await screenshot('invalid-sign-in-desktop.png');
      let release;
      const gate = new Promise((done) => { release = done; });
      const heldLogin = async (route) => { await gate; await route.fulfill({ status: 429, headers: { 'Retry-After': '42' }, json: { error: { code: 'RATE_LIMITED' } } }); };
      await page.route('**/api/auth/login', heldLogin);
      const before = writes.length;
      await page.locator('#sign-in').click();
      await page.waitForFunction(() => document.querySelector('#sign-in').disabled);
      assert.equal(await page.locator('#sign-in').textContent(), 'Signing in…');
      await page.locator('#login-form').evaluate((form) => form.requestSubmit());
      release();
      await page.waitForFunction(() => !document.querySelector('#sign-in').disabled);
      assert.equal(writes.length, before + 1);
      assert.match(await page.locator('#login-message').textContent(), /42 seconds/);
      await page.unroute('**/api/auth/login', heldLogin);
    });

    await t.test('initial list loading, load failure/retry and failed refresh preserve records', async () => {
      const failedList = async (route) => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
      await page.route('**/api/employees', failedList);
      await login();
      assert.equal(await page.locator('#employee-count').textContent(), 'Records unavailable');
      await screenshot('load-error-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('load-error-mobile.png');
      assert.equal(await page.locator('.state-panel button').isEnabled(), true);
      await page.unroute('**/api/employees', failedList);
      let release;
      const gate = new Promise((done) => { release = done; });
      const heldList = async (route) => { await gate; await route.continue(); };
      await page.route('**/api/employees', heldList);
      await page.locator('.state-panel button').click();
      await page.waitForFunction(() => document.querySelector('#refresh').disabled);
      assert.equal(await page.locator('.skeleton').isVisible(), true);
      assert.equal(await page.locator('#employee-content').getAttribute('aria-busy'), 'true');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.skeleton-row span').first().evaluate((node) => getComputedStyle(node).animationName), 'none');
      release();
      await waitIdle();
      await page.unroute('**/api/employees', heldList);
      await page.route('**/api/employees', failedList);
      await page.locator('#refresh').click();
      await waitIdle();
      assert.equal(await page.locator('.employee-card').count(), 5);
      assert.match(await page.locator('#directory-message').textContent(), /Previously loaded/);
      await page.unroute('**/api/employees', failedList);
      await page.locator('#refresh').click();
      await waitIdle();
    });

    await t.test('account Escape stays in the editor; malformed/failed logout never claims success', async () => {
      await page.locator('#add-employee').click();
      await fill({ name: 'Kept draft', email: 'kept@example.com', department: 'People', jobTitle: 'Partner' });
      await page.locator('#account-toggle').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#employee-dialog').isVisible(), true);
      assert.equal(await page.locator('#account-panel').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'account-toggle');
      for (const status of [200, 500]) {
        const failLogout = async (route) => route.fulfill({ status, json: status === 200 ? { data: null } : { error: { code: 'INTERNAL_ERROR' } } });
        await page.route('**/api/auth/logout', failLogout);
        await page.locator('#account-toggle').click();
        await page.locator('#sign-out').click();
        await page.waitForFunction(() => !document.querySelector('#sign-out').disabled);
        assert.equal(await page.locator('#employee-dialog').isVisible(), true);
        assert.equal(await page.locator('#employee-name').inputValue(), 'Kept draft');
        assert.match(await page.locator('#employee-message').textContent(), /Could not sign out/);
        assert.equal((await page.request.get(origin + '/api/auth/me')).status(), 200);
        await page.unroute('**/api/auth/logout', failLogout);
      }
      await page.locator('#employee-cancel').click();
    });

    await t.test('responsive layout, labels, focus, inline validation and fixed mobile actions', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#add-employee').click();
      await page.locator('#employee-jobTitle').focus();
      await page.setViewportSize({ width: 390, height: 500 });
      await page.waitForFunction(() => {
        const dialog = document.querySelector('#employee-dialog');
        const field = document.querySelector('#employee-jobTitle').getBoundingClientRect();
        const footer = document.querySelector('.editor-footer').getBoundingClientRect();
        return dialog.style.height === `${window.visualViewport.height}px` && field.bottom <= footer.top;
      });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'employee-jobTitle');
      await page.locator('#employee-cancel').click();
      for (const [width, height] of [[320, 568], [390, 500], [768, 1024], [1024, 768], [1440, 960]]) {
        await page.setViewportSize({ width, height });
        await noOverflow();
        await page.locator('#add-employee').click();
        assert.equal(await page.getByLabel('Full name', { exact: true }).isVisible(), true);
        assert.equal(await page.getByLabel('Work email', { exact: true }).isVisible(), true);
        await fill({ name: ' ', email: 'invalid', department: ' ', jobTitle: ' ' });
        const before = writes.length;
        await save();
        assert.equal(writes.length, before);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'employee-name');
        assert.equal(await page.locator('#employee-name').getAttribute('aria-invalid'), 'true');
        assert.equal(await page.locator('#employee-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
        await page.locator('#employee-jobTitle').focus();
        if (width < 768) {
          const field = await page.locator('#employee-jobTitle').boundingBox();
          const footer = await page.locator('.editor-footer').boundingBox();
          assert.ok(field.y + field.height <= footer.y);
          assert.ok(footer.y + footer.height <= height);
        }
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          assert.ok(await page.evaluate(() => !document.hasFocus() || document.querySelector('#employee-dialog').contains(document.activeElement)));
        }
        await page.locator('#employee-cancel').focus();
        assert.equal(await page.locator('#employee-cancel').evaluate((node) => getComputedStyle(node).outlineStyle), 'solid');
        await screenshot(`validation-${width}.png`);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'add-employee');
      }
      const assets = await page.locator('img').evaluateAll((images) => images.map((img) => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth, height: img.naturalHeight })));
      for (const asset of assets) assert.ok(asset.loaded, `Asset not loaded: ${asset.src}`);
      for (const [src, size] of [['/assets/orbit.svg', 270], ['/assets/orbit-inner.svg', 174], ['/assets/orbit-accent.svg', 16], ['/assets/admin-avatar.svg', 38], ['/assets/delete-symbol.svg', 48]]) {
        const asset = assets.find((asset) => asset.src === src);
        assert.equal(asset.width, size);
        assert.equal(asset.height, size);
      }
    });

    await t.test('actual session expiry retains draft; CSRF warning keeps values and permits explicit retry', async () => {
      await page.locator('#add-employee').click();
      const values = { name: 'Nora Patel', email: 'recovered@example.com', department: 'People', jobTitle: 'People Partner' };
      await fill(values);
      const session = db.prepare('SELECT sid, data FROM sessions WHERE data LIKE ?').get('%userId%');
      const data = JSON.parse(session.data);
      data.authExpiresAt = Date.now() - 1;
      db.prepare('UPDATE sessions SET data = ? WHERE sid = ?').run(JSON.stringify(data), session.sid);
      await save();
      await page.locator('#login').waitFor({ state: 'visible' });
      await screenshot('session-expired-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('session-expired-mobile.png');
      await page.setViewportSize({ width: 1440, height: 960 });
      await login();
      assert.equal(await page.locator('#employee-email').inputValue(), values.email);
      const current = db.prepare('SELECT sid, data FROM sessions WHERE data LIKE ?').get('%userId%');
      const renewed = JSON.parse(current.data);
      renewed.csrfToken = 'c'.repeat(64);
      db.prepare('UPDATE sessions SET data = ? WHERE sid = ?').run(JSON.stringify(renewed), current.sid);
      await save();
      assert.equal(await page.locator('#employee-message').getAttribute('data-warning'), '');
      assert.equal(await page.locator('#employee-message').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(255, 247, 224)');
      assert.equal(await page.locator('#employee-email').inputValue(), values.email);
      await screenshot('request-rejected-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('request-rejected-mobile.png');
      await page.setViewportSize({ width: 1440, height: 960 });
      await save();
      assert.equal(await page.locator('#employee-dialog').isVisible(), false);
      assert.ok(db.prepare('SELECT id FROM employees WHERE email = ?').get(values.email));
      await page.locator('#add-employee').click();
      await fill(values);
      await save();
      assert.equal(await page.locator('#employee-email-error').textContent(), 'This email is already in use.');
      await screenshot('duplicate-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('duplicate-mobile.png');
      const failedSave = async (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } }) : route.continue();
      await page.route('**/api/employees', failedSave);
      await fill({ email: 'failed-save@example.com' });
      await save();
      assert.equal(await page.locator('#employee-name').inputValue(), values.name);
      assert.equal(await page.locator('#save-confirmation').isVisible(), false);
      await screenshot('save-failure-mobile.png');
      await page.setViewportSize({ width: 1440, height: 960 });
      await screenshot('save-failure-desktop.png');
      await page.unroute('**/api/employees', failedSave);
      await page.locator('#employee-cancel').click();
      const failedDelete = async (route) => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
      await page.route('**/api/employees/1', failedDelete);
      await page.getByRole('button', { name: 'Delete Amelia Morgan', exact: true }).click();
      await page.locator('#delete-submit').click();
      await page.waitForFunction(() => !document.querySelector('#delete-submit').disabled);
      assert.equal(await page.locator('#delete-email').textContent(), 'amelia.morgan@northstar.io');
      assert.equal(await page.locator('#save-confirmation').isVisible(), false);
      await screenshot('delete-failure-desktop.png');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('delete-failure-mobile.png');
      await page.unroute('**/api/employees/1', failedDelete);
      await page.locator('#delete-cancel').click();
    });

    await t.test('empty directory uses the Figma state, startup network failure retries safely', async () => {
      // Only this disposable in-memory database is modified.
      db.prepare('DELETE FROM employees').run();
      await page.locator('#refresh').click();
      await waitIdle();
      await screenshot('empty-mobile.png');
      await page.setViewportSize({ width: 1440, height: 960 });
      await screenshot('empty-desktop.png');
      assert.equal(await page.locator('.state-icon img').evaluate((img) => img.complete && img.naturalWidth === 92 && img.naturalHeight === 92), true);
      assert.equal(await page.locator('#add-employee').isVisible(), false);
      await page.getByRole('button', { name: 'Add first employee', exact: true }).click();
      await page.keyboard.press('Escape');
      await logout();
      const failedStartup = async (route) => route.abort('failed');
      await page.route('**/api/auth/me', failedStartup);
      await page.reload();
      await page.locator('#startup-retry').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#directory').isVisible(), false);
      await page.unroute('**/api/auth/me', failedStartup);
      await page.locator('#startup-retry').click();
      await page.locator('#login').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
    db.close();
  }
});
