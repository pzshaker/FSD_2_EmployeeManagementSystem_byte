import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, seedEmployees } from '../src/db.js';

test('database persists records, seeds safely, and enforces constraints', () => {
  const directory = mkdtempSync(join(tmpdir(), 'byte-db-test-'));
  const path = join(directory, 'nested', 'test.sqlite');
  let db;
  try {
    db = openDatabase(path);
    assert.equal(seedEmployees(db), 5);
    db.prepare('UPDATE employees SET job_title = ? WHERE email = ?').run('Senior Developer', 'alex.morgan@example.com');
    assert.equal(seedEmployees(db), 0);
    assert.equal(db.prepare('SELECT job_title FROM employees WHERE email = ?').get('alex.morgan@example.com').job_title, 'Senior Developer');
    const insert = db.prepare('INSERT INTO employees (name, email, department, job_title) VALUES (?, ?, ?, ?)');
    assert.throws(() => insert.run('Duplicate', 'alex.morgan@example.com', 'Engineering', 'Developer'), /UNIQUE/);
    assert.throws(() => insert.run(null, 'missing@example.com', 'Engineering', 'Developer'), /NOT NULL/);
    assert.throws(() => insert.run('   ', 'blank@example.com', 'Engineering', 'Developer'), /CHECK/);
    assert.throws(() => insert.run('A'.repeat(101), 'long@example.com', 'Engineering', 'Developer'), /CHECK/);
    assert.throws(() => insert.run('Test', 'UPPER@example.com', 'Engineering', 'Developer'), /CHECK/);
    assert.throws(() => db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('admin@example.com', ''), /CHECK/);
    insert.run("O'Brien'); DROP TABLE employees; --", 'safe@example.com', 'Engineering', 'Developer');
    assert.equal(db.prepare('SELECT count(*) AS total FROM users').get().total, 0);
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT count(*) AS total FROM employees').get().total, 6);
    assert.equal(db.prepare('SELECT job_title FROM employees WHERE email = ?').get('alex.morgan@example.com').job_title, 'Senior Developer');
    assert.ok(db.prepare('SELECT name FROM employees WHERE email = ?').get('nour.ahmed@example.com').name.includes('نور'));
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
