import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { openDatabase, seedEmployees } from '../src/db.js';
import { createAdministrator } from '../src/admin.js';

// Optional browser tooling; the application has no new dependency.
test('employee forms: real saves, recovery, responsive layout and keyboard access', {
  skip: !process.env.BYTE_PLAYWRIGHT_MODULE && 'Set BYTE_PLAYWRIGHT_MODULE to an existing Playwright index.mjs to run browser checks.',
  timeout: 180_000,
}, async (t) => {
  const { chromium } = await import(pathToFileURL(resolve(process.env.BYTE_PLAYWRIGHT_MODULE)).href);
  const db = openDatabase(':memory:');
  const admin = { email: 'browser-admin@example.com', password: 'Disposable browser password 123!' };
  await createAdministrator(db, admin.email, admin.password);
  seedEmployees(db);
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({ db, appOrigin: origin, sessionSecret: Buffer.alloc(32, 7).toString('base64') }));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = [];
    page.on('request', (request) => {
      if (/\/api\/employees(?:\/\d+)?$/.test(request.url()) && ['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request);
    });
    const visible = (selector) => page.locator(selector).waitFor({ state: 'visible' });
    const hidden = (selector) => page.locator(selector).waitFor({ state: 'hidden' });
    const fill = async (values) => {
      for (const [key, value] of Object.entries(values)) await page.locator(`#employee-${key}`).fill(value);
    };
    const submit = async () => {
      await page.locator('#employee-submit').click();
      await page.waitForFunction(() => !document.querySelector('#employee-submit').disabled);
    };
    const login = async () => {
      await visible('#login');
      await page.locator('#email').fill(admin.email);
      await page.locator('#password').fill(admin.password);
      await page.locator('#sign-in').click();
      await visible('#directory');
      await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    };
    const screenshot = async (name) => {
      if (!process.env.BYTE_SCREENSHOTS) return;
      await mkdir(resolve(process.env.BYTE_SCREENSHOTS), { recursive: true });
      await page.screenshot({ path: resolve(process.env.BYTE_SCREENSHOTS, name) });
    };
    const count = () => db.prepare('SELECT count(*) AS count FROM employees').get().count;
    const normal = { name: 'Nora Patel', email: 'nora.patel@example.com', department: 'Engineering', jobTitle: 'Product Designer' };
    await page.goto(origin);
    await login();

    await t.test('desktop create, trim/lowercase, CSRF, confirmation and enabled Delete', async () => {
      await page.locator('#add-employee').click();
      await screenshot('add-desktop.png');
      const box = await page.locator('#employee-dialog').boundingBox();
      assert.equal(box.width, 666);
      assert.equal(box.x, 487);
      await fill({ ...normal, name: '  Nora Patel  ', email: '  NORA.PATEL@EXAMPLE.COM  ' });
      await submit();
      await hidden('#employee-dialog');
      await visible('#save-confirmation');
      assert.equal(await page.locator('#save-title').textContent(), 'Employee added');
      assert.equal(await page.locator('#employee-count').textContent(), '6 employees');
      assert.equal(count(), 6);
      const request = writes.at(-1);
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers()['content-type'], 'application/json');
      assert.ok(request.headers()['x-csrf-token']);
      assert.deepEqual(request.postDataJSON(), normal);
      assert.equal(await page.locator('.table-wrap button:has-text("Delete"):enabled').count(), 6);
      await screenshot('created-desktop.png');
    });

    await t.test('desktop edit preserves ID and creation date, safely renders employee text', async () => {
      const before = db.prepare('SELECT * FROM employees WHERE email = ?').get(normal.email);
      await page.getByRole('button', { name: 'Edit Nora Patel', exact: true }).click();
      assert.equal(await page.locator('#employee-name').inputValue(), normal.name);
      assert.match(await page.locator('#employee-metadata').textContent(), new RegExp(`Employee ID #${before.id}`));
      await screenshot('edit-desktop.png');
      await fill({ jobTitle: '<b>Senior Designer</b>' });
      await submit();
      await visible('#save-confirmation');
      assert.equal(await page.locator('#save-title').textContent(), 'Changes saved');
      const after = db.prepare('SELECT * FROM employees WHERE id = ?').get(before.id);
      assert.equal(after.created_at, before.created_at);
      assert.equal(after.job_title, '<b>Senior Designer</b>');
      assert.equal(writes.at(-1).method(), 'PATCH');
      assert.deepEqual(Object.keys(writes.at(-1).postDataJSON()).sort(), ['department', 'email', 'jobTitle', 'name']);
      assert.equal(await page.locator('#employee-content b').count(), 0);
      await screenshot('saved-desktop.png');
    });

    await t.test('required, email and Unicode length validation stops writes', async () => {
      await page.locator('#add-employee').click();
      const start = writes.length;
      await fill({ ...normal, name: '  ', email: 'invalid' });
      await submit();
      assert.equal(writes.length, start);
      assert.equal(await page.locator('#employee-name').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'employee-name');
      assert.equal(await page.locator('#employee-email').getAttribute('aria-invalid'), 'true');
      for (const key of Object.keys(normal)) {
        await fill({ ...normal, [key]: '  ' });
        await submit();
        assert.equal(writes.length, start);
        assert.equal(await page.locator(`#employee-${key}`).getAttribute('aria-invalid'), 'true');
      }
      for (const key of ['name', 'department', 'jobTitle']) {
        await fill({ ...normal, [key]: '😀'.repeat(101) });
        await submit();
        assert.equal(writes.length, start);
        assert.equal(await page.locator(`#employee-${key}`).getAttribute('aria-invalid'), 'true');
      }
      await fill({ ...normal, email: `${'a'.repeat(249)}@x.com` });
      await submit();
      assert.equal(writes.length, start);
      await fill({ name: '😀'.repeat(100), email: `${'a'.repeat(248)}@x.com`, department: '😀'.repeat(100), jobTitle: '😀'.repeat(100) });
      await submit();
      await hidden('#employee-dialog');
      assert.equal(count(), 7);
    });

    await t.test('real duplicate email preserves every entered value', async () => {
      await page.locator('#add-employee').click();
      await fill(normal);
      await submit();
      assert.equal(await page.locator('#employee-email-error').textContent(), 'This email is already in use.');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'employee-email');
      for (const [key, value] of Object.entries(normal)) assert.equal(await page.locator(`#employee-${key}`).inputValue(), value);
      assert.equal(count(), 7);
      assert.equal(await page.locator('#save-confirmation').isVisible(), false);
      await screenshot('duplicate-desktop.png');
    });

    await t.test('HTTP, network and malformed-response failures retain forms without success', async () => {
      const scenarios = [[400, 'INVALID_EMAIL', 'entered values'], [403, 'INVALID_CSRF_TOKEN', 'rejected'], [404, 'EMPLOYEE_NOT_FOUND', 'no longer available'], [413, 'BODY_TOO_LARGE', 'too large'], [415, 'UNSUPPORTED_MEDIA_TYPE', 'request format'], [429, 'RATE_LIMITED', '42 seconds'], [500, 'INTERNAL_ERROR', 'confirm this save'], [0, '', 'confirm this save'], [200, '', 'confirm this save']];
      for (const [status, code, expected] of scenarios) {
        const route = async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          if (status === 0) return route.abort('failed');
          await route.fulfill({ status, contentType: 'application/json', headers: { 'Retry-After': '42' }, body: JSON.stringify(status === 200 ? { data: { id: 1 } } : { error: { code, message: '<script>unsafe arbitrary server text</script>' } }) });
        };
        await page.route('**/api/employees', route);
        await fill({ ...normal, email: 'failure@example.com' });
        await submit();
        assert.match(await page.locator('#employee-message').textContent(), new RegExp(expected));
        assert.equal(await page.locator('#employee-dialog').isVisible(), true);
        assert.equal(await page.locator('#employee-name').inputValue(), normal.name);
        assert.equal(await page.locator('#save-confirmation').isVisible(), false);
        assert.equal(count(), 7);
        await page.unroute('**/api/employees', route);
      }
      await screenshot('failure-desktop.png');
      await page.locator('#employee-cancel').click();
    });

    await t.test('expired session retains draft in memory and restores after login', async () => {
      await page.locator('#add-employee').click();
      await fill({ ...normal, email: 'resumed@example.com' });
      db.prepare('DELETE FROM sessions').run();
      await submit();
      await visible('#login');
      await login();
      await visible('#employee-dialog');
      assert.equal(await page.locator('#employee-email').inputValue(), 'resumed@example.com');
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      assert.equal(await page.evaluate(() => sessionStorage.length), 0);
      await submit();
      await hidden('#employee-dialog');
      assert.equal(count(), 8);
      // Reload loses the token; the next write must retrieve it again.
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#directory').hidden && !document.querySelector('#refresh').disabled);
    });

    await t.test('pending save rejects duplicates and dismissal; refresh failure reports confirmed write', async () => {
      await page.locator('#add-employee').click();
      await fill({ ...normal, email: 'slow@example.com' });
      let release;
      const gate = new Promise((done) => { release = done; });
      const delay = async (route) => { if (route.request().method() === 'POST') await gate; await route.continue(); };
      await page.route('**/api/employees', delay);
      const before = writes.length;
      await page.locator('#employee-submit').click();
      await page.waitForFunction(() => document.querySelector('#employee-submit').disabled);
      assert.equal(await page.locator('#employee-submit').textContent(), 'Creating…');
      assert.equal(await page.locator('#employee-name').getAttribute('readonly'), '');
      await page.keyboard.press('Escape');
      await page.locator('#employee-form').evaluate((form) => form.requestSubmit());
      assert.equal(await page.locator('#employee-dialog').isVisible(), true);
      release();
      await visible('#save-confirmation');
      assert.equal(writes.length, before + 1);
      await page.unroute('**/api/employees', delay);
      const failRefresh = async (route) => route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL_ERROR"}}' }) : route.continue();
      await page.route('**/api/employees', failRefresh);
      await page.locator('#add-employee').click();
      await fill({ ...normal, email: 'refresh-failure@example.com' });
      await submit();
      await visible('#save-confirmation');
      assert.match(await page.locator('#save-detail').textContent(), /Saved successfully.*could not refresh/);
      assert.equal(count(), 10);
      await page.unroute('**/api/employees', failRefresh);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelector('#employee-count').textContent === '10 employees');
    });

    await t.test('older directory response cannot overwrite the post-save refresh', async () => {
      const old = db.prepare('SELECT * FROM employees').all().map((row) => ({ id: row.id, name: row.name, email: row.email, department: row.department, jobTitle: row.job_title, createdAt: row.created_at, updatedAt: row.updated_at }));
      let release;
      const gate = new Promise((done) => { release = done; });
      let first = true;
      const staleList = async (route) => {
        if (route.request().method() === 'GET' && first) { first = false; await gate; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: old }) }); }
        return route.continue();
      };
      await page.route('**/api/employees', staleList);
      await page.locator('#refresh').click();
      await page.locator('#add-employee').click();
      await fill({ ...normal, email: 'race@example.com' });
      await submit();
      await visible('#save-confirmation');
      assert.equal(await page.locator('#employee-count').textContent(), '11 employees');
      const response = page.waitForResponse((response) => response.url() === `${origin}/api/employees` && response.request().method() === 'GET');
      release();
      await (await response).finished();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.equal(await page.locator('#employee-count').textContent(), '11 employees');
      await page.unroute('**/api/employees', staleList);
    });

    await t.test('real missing employee update retains values and offers return to directory', async () => {
      const row = db.prepare('SELECT id FROM employees WHERE email = ?').get('race@example.com');
      await page.getByRole('button', { name: 'Edit Nora Patel', exact: true }).last().click();
      db.prepare('DELETE FROM employees WHERE id = ?').run(row.id);
      await fill({ name: 'Kept draft' });
      await submit();
      assert.match(await page.locator('#employee-message').textContent(), /no longer available/);
      assert.equal(await page.locator('#employee-name').inputValue(), 'Kept draft');
      await page.locator('#employee-cancel').click();
      await page.locator('#refresh').click();
      await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    });

    await t.test('mobile create/edit, footer, focus containment, narrow width and reduced motion', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#add-employee').click();
      await screenshot('add-mobile.png');
      const avatar = await page.locator('#editor-account .admin-avatar').boundingBox();
      assert.ok(Math.abs(avatar.width - 32) < .1);
      assert.ok(Math.abs(avatar.x - 342) < .1);
      assert.equal(await page.locator('#editor-account img').evaluate((image) => image.complete && image.naturalWidth === 38 && image.naturalHeight === 38), true);
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
        const focus = await page.locator('#employee-dialog').evaluate((dialog) => ({ inside: dialog.contains(document.activeElement), pageFocused: document.hasFocus(), active: document.activeElement.tagName + '#' + document.activeElement.id }));
        assert.ok(focus.inside || !focus.pageFocused, `Tab step ${i}: ${focus.active}`);
      }
      await fill({ ...normal, email: 'mobile@example.com' });
      await submit();
      await visible('#save-confirmation');
      assert.equal(await page.locator('#save-title').textContent(), 'Employee added');
      assert.match(await page.locator('.employee-cards .employee-card').evaluateAll((cards) => cards.toSorted((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order))[0].textContent), /mobile@example.com/);
      await screenshot('created-mobile.png');
      await page.locator('.employee-card').filter({ hasText: 'mobile@example.com' }).getByRole('button', { name: 'Edit Nora Patel', exact: true }).click();
      await screenshot('edit-mobile.png');
      const footer = await page.locator('.editor-footer').boundingBox();
      assert.equal(footer.y, 724);
      await fill({ jobTitle: 'Mobile editor' });
      await submit();
      await visible('#save-confirmation');
      assert.equal(await page.locator('#save-title').textContent(), 'Changes saved');
      await screenshot('saved-mobile.png');
      await page.locator('#add-employee').click();
      await fill(normal);
      await submit();
      assert.equal(await page.locator('#employee-email-error').textContent(), 'This email is already in use.');
      await screenshot('duplicate-mobile.png');
      const failMobile = async (route) => route.request().method() === 'POST' ? route.abort('failed') : route.continue();
      await page.route('**/api/employees', failMobile);
      await fill({ ...normal, email: 'mobile-failure@example.com' });
      await submit();
      assert.match(await page.locator('#employee-message').textContent(), /confirm this save/);
      assert.equal(await page.locator('#employee-email').inputValue(), 'mobile-failure@example.com');
      await screenshot('failure-mobile.png');
      await page.unroute('**/api/employees', failMobile);
      const failLogout = async (route) => route.abort('failed');
      await page.route('**/api/auth/logout', failLogout);
      await page.locator('#account-toggle').click();
      await page.locator('#sign-out').click();
      await page.waitForFunction(() => document.querySelector('#employee-message').textContent.includes('Could not sign out'));
      assert.equal(await page.locator('#employee-email').inputValue(), 'mobile-failure@example.com');
      await page.unroute('**/api/auth/logout', failLogout);
      await page.setViewportSize({ width: 390, height: 500 });
      await page.waitForFunction(() => document.querySelector('#employee-dialog').style.height === `${window.visualViewport.height}px`);
      await page.locator('#employee-jobTitle').focus();
      const compactInput = await page.locator('#employee-jobTitle').boundingBox();
      const compactBar = await page.locator('.editor-footer').boundingBox();
      assert.ok(compactInput.y + compactInput.height <= compactBar.y);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForFunction(() => document.querySelector('#employee-dialog').style.height === `${window.visualViewport.height}px`);
      await fill({ ...normal, name: 'x'.repeat(101), email: 'invalid' });
      await submit();
      assert.equal(await page.locator('#employee-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
      await page.locator('#employee-jobTitle').focus();
      const input = await page.locator('#employee-jobTitle').boundingBox();
      const bar = await page.locator('.editor-footer').boundingBox();
      assert.ok(input.y + input.height <= bar.y);
      await screenshot('validation-320.png');
      await page.keyboard.press('Escape');
      await hidden('#employee-dialog');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'add-employee');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#add-employee').evaluate((node) => getComputedStyle(node).transitionDuration), '0s');
    });

    await t.test('empty directory Add and CSRF recovery after a genuine rejection', async () => {
      if (await page.locator('#employee-dialog').isVisible()) await page.locator('#employee-cancel').click();
      db.prepare('DELETE FROM employees').run();
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.querySelector('#employee-count').textContent === '0 employees');
      await page.locator('.state-panel').getByRole('button', { name: 'Add first employee' }).click();
      await fill({ ...normal, email: 'empty@example.com' });
      // Rotate the server token while leaving the browser's in-memory token stale.
      const session = db.prepare('SELECT sid, data FROM sessions').get();
      const data = JSON.parse(session.data);
      data.csrfToken = 'a'.repeat(64);
      db.prepare('UPDATE sessions SET data = ? WHERE sid = ?').run(JSON.stringify(data), session.sid);
      await submit();
      assert.match(await page.locator('#employee-message').textContent(), /rejected/);
      assert.equal(count(), 0);
      await submit();
      await hidden('#employee-dialog');
      assert.equal(count(), 1);
      assert.equal(writes.at(-1).headers()['x-csrf-token'], data.csrfToken);
      assert.equal(await page.locator('#employee-count').textContent(), '1 employee');
      assert.equal(writes.some((request) => request.method() === 'DELETE'), false);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
    db.close();
  }
});
