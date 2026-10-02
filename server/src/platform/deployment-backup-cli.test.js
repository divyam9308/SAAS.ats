'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('CLI defaults match factory and generated workspace storage paths', async t => {
  const { resolveDefaults } = await import('../../../scripts/deployment-backup.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-backup-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(resolveDefaults(root, {}), {
    dbPath: path.join(root, 'server/data/platform-local.sqlite'),
    documentsPath: path.join(root, 'server/data/platform-documents'),
  });
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/platform.config.json'), '{}');
  assert.deepEqual(resolveDefaults(root, {}), {
    dbPath: path.join(root, 'server/data/platform.sqlite'),
    documentsPath: path.join(root, 'server/data/documents'),
  });
});

test('environment overrides both workspace defaults and restore requires confirmation', async t => {
  const { resolveDefaults, parse } = await import('../../../scripts/deployment-backup.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-backup-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const defaults = resolveDefaults(root, { ATS_PLATFORM_DB: '/data/custom.sqlite', ATS_PLATFORM_DATA_DIR: '/data/docs' });
  assert.deepEqual(defaults, { dbPath: '/data/custom.sqlite', documentsPath: '/data/docs' });
  assert.throws(() => parse(['restore', '--bundle', '/backup', '--replace'], defaults), /--confirm/);
  assert.deepEqual(parse(['backup', '--destination', '/backup'], defaults).options, {
    dbPath: '/data/custom.sqlite', documentsPath: '/data/docs', destination: '/backup',
  });
});
