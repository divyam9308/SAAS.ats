'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defaults } = require('../../../shared/ats-config.cjs');
const { openDatabase, seedCompany } = require('./database');

test('production-style bootstrap creates configured users without demo operational records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-clean-seed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(path.join(directory, 'platform.sqlite'));
  t.after(() => db.close());
  const config = defaults('agency');
  seedCompany(db, 'local-company', config, { seedDemo: false });

  assert.equal(db.prepare('SELECT count(*) AS count FROM platform_config').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM platform_users').get().count, config.users.length);
  assert.equal(db.prepare('SELECT count(*) AS count FROM platform_records').get().count, 0);
});
