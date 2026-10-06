import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { openDatabase, seedEmployees } from '../src/db.js';
import { createAdministrator } from '../src/admin.js';

test('employee deletion: confirmed writes, recovery and responsive accessibility', {
  skip: !process.env.BYTE_PLAYWRIGHT_MODULE && 'Set BYTE_PLAYWRIGHT_MODULE to an existing Playwright index.mjs.',
  timeout: 180_000,
}, async (t) => {
  const { chromium } = await import(pathToFileURL(resolve(process.env.BYTE_PLAYWRIGHT_MODULE)).href);
  const db = openDatabase(':memory:');
  const admin = { email: 'delete-admin@example.com', password: 'Disposable deletion password 123!' };
  await createAdministrator(db, admin.email, admin.password);
  seedEmployees(db);
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp({ db, appOrigin: origin, sessionSecret: Buffer.alloc(32, 8).toString('base64') }));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.method() === 'DELETE') writes.push(request); });
    const waitIdle = () => page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    const login = async () => {
      await page.locator('#email').fill(admin.email);
      await page.locator('#password').fill(admin.password);
      await page.locator('#sign-in').click();
      await page.locator('#directory').waitFor({ state: 'visible' });
      await waitIdle();
    };
    const refresh = async () => { await page.locator('#refresh').click(); await waitIdle(); };
    const open = async () => {
      const selector = (await page.viewportSize()).width < 768 ? '.employee-cards' : '.table-wrap';
      await page.locator(`${selector} .delete-action`).first().click();
      await page.locator('#delete-dialog').waitFor({ state: 'visible' });
    };
    const submit = async () => { await page.locator('#delete-submit').click(); await page.waitForFunction(() => !document.querySelector('#delete-submit').disabled); };
    const count = () => db.prepare('SELECT count(*) AS n FROM employees').get().n;
    const screenshot = async (name) => {
      if (!process.env.BYTE_SCREENSHOTS) return;
      await mkdir(resolve(process.env.BYTE_SCREENSHOTS), { recursive: true });
      await page.screenshot({ path: resolve(process.env.BYTE_SCREENSHOTS, name) });
    };
    await page.goto(origin);
    await login();

    await t.test('cancel, focus containment, desktop geometry and real bodyless deletion', async () => {
      await open();
      const box = await page.locator('#delete-dialog').boundingBox();
      assert.equal(box.width, 620);
      assert.equal(box.x, 510);
      assert.equal(box.y, 324);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'delete-cancel');
      assert.equal(await page.locator('.delete-symbol img').evaluate((img) => img.complete && img.naturalWidth === 48 && img.naturalHeight === 48), true);
      await screenshot('delete-desktop.png');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(i < 4 ? 'Tab' : 'Shift+Tab');
        assert.ok(await page.evaluate(() => !document.hasFocus() || document.querySelector('#delete-dialog').contains(document.activeElement)));
      }
      await page.keyboard.press('Escape');
      assert.equal(count(), 5);
      assert.equal(writes.length, 0);
      assert.ok(await page.evaluate(() => document.activeElement.classList.contains('delete-action')));
      await open();
      await page.locator('#delete-cancel').click();
      assert.equal(writes.length, 0);
      await open();
      const sessionToken = JSON.parse(db.prepare('SELECT data FROM sessions').get().data).csrfToken;
      await submit();
      assert.equal(count(), 4);
      assert.equal(await page.locator('#employee-count').textContent(), '4 employees');
      assert.equal(await page.locator('#save-title').textContent(), 'Employee deleted');
      assert.equal(await page.locator('#delete-dialog').isVisible(), false);
      assert.equal(writes.at(-1).postData(), null);
      assert.equal(writes.at(-1).headers()['content-type'], undefined);
      assert.equal(writes.at(-1).headers()['x-csrf-token'], sessionToken);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'directory-title');
      await screenshot('deleted-desktop.png');
    });

    await t.test('500, network, unexpected success and 404 preserve context without success', async () => {
      for (const failure of [500, 'network', 'unexpected', 404]) {
        await open();
        const email = await page.locator('#delete-email').textContent();
        const before = count();
        const intercept = async (route) => {
          if (route.request().method() !== 'DELETE') return route.continue();
          if (failure === 'network') return route.abort('failed');
          return route.fulfill({ status: failure === 'unexpected' ? 200 : failure, contentType: 'application/json', body: failure === 'unexpected' ? '{"data":null}' : '{"error":{"code":"FAILURE"}}' });
        };
        await page.route('**/api/employees/*', intercept);
        await submit();
        assert.equal(count(), before);
        assert.equal(await page.locator('#delete-dialog').isVisible(), true);
        assert.equal(await page.locator('#delete-email').textContent(), email);
        assert.equal(await page.locator('#save-confirmation').isVisible(), false);
        assert.match(await page.locator('#delete-message').textContent(), failure === 404 ? /no longer available/ : /confirm this deletion/);
        await screenshot(`delete-failure-${failure}.png`);
        await page.unroute('**/api/employees/*', intercept);
        await page.locator('#delete-cancel').click();
      }
    });

    await t.test('real missing employee keeps the prompt and does not claim success', async () => {
      const result = db.prepare('INSERT INTO employees (name, email, department, job_title) VALUES (?, ?, ?, ?)').run('Removed elsewhere', 'missing@example.com', 'Operations', 'Coordinator');
      await refresh();
      await page.getByRole('button', { name: 'Delete Removed elsewhere', exact: true }).click();
      db.prepare('DELETE FROM employees WHERE id = ?').run(result.lastInsertRowid);
      await submit();
      assert.match(await page.locator('#delete-message').textContent(), /no longer available/);
      assert.equal(await page.locator('#delete-email').textContent(), 'missing@example.com');
      assert.equal(await page.locator('#save-confirmation').isVisible(), false);
      await page.locator('#delete-cancel').click();
      await refresh();
    });

    await t.test('genuine stale CSRF rejection and explicit retry', async () => {
      await open();
      const session = db.prepare('SELECT sid, data FROM sessions').get();
      const data = JSON.parse(session.data);
      data.csrfToken = 'b'.repeat(64);
      db.prepare('UPDATE sessions SET data = ? WHERE sid = ?').run(JSON.stringify(data), session.sid);
      const before = count();
      await submit();
      assert.equal(count(), before);
      assert.match(await page.locator('#delete-message').textContent(), /rejected/);
      await submit();
      assert.equal(count(), before - 1);
      assert.equal(writes.at(-1).headers()['x-csrf-token'], data.csrfToken);
    });

    await t.test('expired session restores selection without automatic deletion', async () => {
      await open();
      const email = await page.locator('#delete-email').textContent();
      db.prepare('DELETE FROM sessions').run();
      const before = count();
      await submit();
      await page.locator('#login').waitFor({ state: 'visible' });
      assert.equal(count(), before);
      const attempts = writes.length;
      await login();
      await page.locator('#delete-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#delete-email').textContent(), email);
      assert.equal(writes.length, attempts);
      assert.equal(count(), before);
      await page.locator('#delete-cancel').click();
    });

    await t.test('pending blocks dismissal and duplicates; stale list cannot restore deleted employee', async () => {
      const old = (await page.request.get(`${origin}/api/employees`)).json();
      let releaseList;
      let releaseDelete;
      const listGate = new Promise((done) => { releaseList = done; });
      const deleteGate = new Promise((done) => { releaseDelete = done; });
      const heldList = async (route) => { await listGate; await route.fulfill({ json: await old }); };
      const heldDelete = async (route) => { await deleteGate; await route.continue(); };
      await page.route('**/api/employees', heldList);
      await page.route('**/api/employees/*', heldDelete);
      await page.locator('#refresh').click();
      await open();
      const before = writes.length;
      await page.locator('#delete-submit').click();
      await page.waitForFunction(() => document.querySelector('#delete-submit').disabled);
      assert.equal(await page.locator('#delete-submit').textContent(), 'Deleting…');
      await page.keyboard.press('Escape');
      await page.locator('#delete-form').evaluate((form) => form.requestSubmit());
      assert.equal(await page.locator('#delete-dialog').isVisible(), true);
      assert.equal(await page.locator('#delete-cancel').isDisabled(), true);
      assert.equal(await page.locator('#save-confirmation').isVisible(), false);
      releaseDelete();
      await page.locator('#delete-dialog').waitFor({ state: 'hidden' });
      assert.equal(writes.length, before + 1);
      const expected = count();
      const response = page.waitForResponse((response) => response.url() === `${origin}/api/employees`);
      releaseList();
      await (await response).finished();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.equal(await page.locator('#employee-count').textContent(), `${expected} employees`);
      await page.unroute('**/api/employees', heldList);
      await page.unroute('**/api/employees/*', heldDelete);
    });

    await t.test('mobile sheet, long identity, narrow/short viewport, reduced motion and empty directory', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open();
      const box = await page.locator('#delete-dialog').boundingBox();
      assert.equal(box.x, 12);
      assert.equal(box.width, 366);
      assert.equal(box.y + box.height, 826);
      await screenshot('delete-mobile.png');
      const fail = (route) => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
      await page.route('**/api/employees/*', fail);
      await submit();
      await screenshot('delete-failure-mobile.png');
      await page.unroute('**/api/employees/*', fail);
      await page.locator('#delete-cancel').click();
      await open();
      await submit();
      await screenshot('deleted-mobile.png');
      const row = db.prepare('SELECT id FROM employees LIMIT 1').get();
      db.prepare('UPDATE employees SET name = ?, email = ? WHERE id = ?').run('Long '.repeat(20), `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.example.com`, row.id);
      await refresh();
      await page.setViewportSize({ width: 320, height: 568 });
      await open();
      assert.equal(await page.locator('#delete-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth), true);
      await page.locator('#delete-submit').focus();
      const button = await page.locator('#delete-submit').boundingBox();
      assert.ok(button.y >= 0 && button.y + button.height <= 568);
      await screenshot('delete-narrow.png');
      await page.setViewportSize({ width: 390, height: 400 });
      await page.locator('#delete-submit').focus();
      await page.locator('#delete-submit').scrollIntoViewIfNeeded();
      const shortButton = await page.locator('#delete-submit').boundingBox();
      assert.ok(shortButton.y >= 0 && shortButton.y + shortButton.height <= 400);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('#delete-submit').evaluate((node) => getComputedStyle(node).transitionDuration), '0s');
      await submit();
      assert.equal(count(), 0);
      assert.equal(await page.locator('#employee-count').textContent(), '0 employees');
      assert.equal(await page.locator('.state-panel h2').textContent(), 'No employees yet');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
    db.close();
  }
});
