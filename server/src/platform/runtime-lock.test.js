'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { acquirePlatformRuntimeLock, assertPlatformRuntimeStopped, lockPathFor } = require('./runtime-lock');

test('runtime and offline operations contend on the same atomic lock', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-runtime-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'platform.sqlite');
  const release = acquirePlatformRuntimeLock(dbPath);
  assert.throws(() => acquirePlatformRuntimeLock(dbPath), /owns this database/);
  assert.throws(() => assertPlatformRuntimeStopped(dbPath), /appears active/);
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, 'runtime-lock.js'))}).acquirePlatformRuntimeLock(process.argv[1])`, dbPath]);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr.toString(), /owns this database/);
  release();
  assert.doesNotThrow(() => acquirePlatformRuntimeLock(dbPath)());
});

test('stale or malformed locks fail closed without unlinking them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-runtime-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'platform.sqlite');
  const lockPath = lockPathFor(dbPath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, token: 'stale', host: os.hostname() }));
  assert.throws(() => acquirePlatformRuntimeLock(dbPath), /stale runtime lock remains/);
  assert.throws(() => assertPlatformRuntimeStopped(dbPath), /stale runtime lock remains/);
  assert.equal(fs.existsSync(lockPath), true);
  fs.writeFileSync(lockPath, 'not-json');
  assert.throws(() => acquirePlatformRuntimeLock(dbPath), /malformed/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'not-json');
});

test('macOS system temp aliases are accepted without trusting nested symlinks', { skip: process.platform !== 'darwin' }, t => {
  const root = fs.mkdtempSync('/tmp/ats-runtime-lock-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'platform.sqlite');
  assert.doesNotThrow(() => acquirePlatformRuntimeLock(dbPath)());

  const real = path.join(root, 'real'); fs.mkdirSync(real);
  const link = path.join(root, 'linked'); fs.symlinkSync(real, link, 'dir');
  assert.throws(() => acquirePlatformRuntimeLock(path.join(link, 'platform.sqlite')), /symlink/);
});

test('lock acquisition refuses symlinked ancestors before creating a marker', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-runtime-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = path.join(root, 'real'); fs.mkdirSync(real);
  const link = path.join(root, 'linked'); fs.symlinkSync(real, link, 'dir');
  const dbPath = path.join(link, 'platform.sqlite');
  assert.throws(() => acquirePlatformRuntimeLock(dbPath), /symlink/);
  assert.equal(fs.existsSync(lockPathFor(dbPath)), false);
});
