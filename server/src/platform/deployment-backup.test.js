'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { openDatabase } = require('./database');
const { createBackup, previewBackup, restoreBackup, validateBackup, BackupError } = require('./deployment-backup');
const { acquirePlatformRuntimeLock, assertPlatformRuntimeStopped } = require('./runtime-lock');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-backup-test-'));
  const dbPath = path.join(root, 'source', 'platform.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO platform_records(company_id,kind,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('test-company', 'jobs', 'job-1', JSON.stringify({ id: 'job-1', title: 'Backup Engineer' }), '2026-01-01', '2026-01-01');
  db.prepare('INSERT INTO platform_config(company_id,active,draft,active_version,updated_at) VALUES(?,?,?,?,?)').run('test-company', JSON.stringify({ company: 'Original' }), JSON.stringify({ company: 'Draft' }), 3, '2026-01-01');
  db.close();
  const documentsPath = path.join(root, 'source', 'documents'); fs.mkdirSync(path.join(documentsPath, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(documentsPath, 'nested', 'cv.txt'), 'private candidate document');
  return { root, dbPath, documentsPath };
}

test('creates a checksummed snapshot and restores records, active config, and local documents', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const bundle = path.join(f.root, 'backup');
  await createBackup({ ...f, destination: bundle });
  const preview = previewBackup(bundle);
  assert.match(preview.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual({ ...preview, createdAt: 'timestamp' }, { createdAt: 'timestamp', recordCount: 1, companyCount: 1, documentCount: 1, documentBytes: 26 });
  const targetDb = path.join(f.root, 'restore', 'platform.sqlite');
  const targetDocs = path.join(f.root, 'restore', 'documents');
  restoreBackup({ bundlePath: bundle, dbPath: targetDb, documentsPath: targetDocs });
  const db = openDatabase(targetDb);
  assert.equal(db.prepare('SELECT data FROM platform_records WHERE id=?').get('job-1').data, JSON.stringify({ id: 'job-1', title: 'Backup Engineer' }));
  assert.equal(JSON.parse(db.prepare('SELECT active FROM platform_config WHERE company_id=?').get('test-company').active).company, 'Original');
  db.close();
  assert.equal(fs.readFileSync(path.join(targetDocs, 'nested', 'cv.txt'), 'utf8'), 'private candidate document');
});

test('rejects corrupt and path traversal bundles before touching existing targets', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const bundle = path.join(f.root, 'backup'); await createBackup({ ...f, destination: bundle });
  const manifestPath = path.join(bundle, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.documents[0].path = '../outside.txt'; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const targetDb = path.join(f.root, 'target.sqlite'); const targetDocs = path.join(f.root, 'target-docs');
  fs.copyFileSync(f.dbPath, targetDb); fs.mkdirSync(targetDocs); fs.writeFileSync(path.join(targetDocs, 'keep.txt'), 'keep me');
  assert.throws(() => validateBackup(bundle), BackupError);
  assert.throws(() => restoreBackup({ bundlePath: bundle, dbPath: targetDb, documentsPath: targetDocs, replace: true }), BackupError);
  assert.equal(fs.readFileSync(path.join(targetDocs, 'keep.txt'), 'utf8'), 'keep me');
  assert.doesNotThrow(() => openDatabase(targetDb).close());
});

test('rejects symlinked source documents and refuses overwrite unless requested', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const outside = path.join(f.root, 'secret.txt'); fs.writeFileSync(outside, 'secret');
  fs.symlinkSync(outside, path.join(f.documentsPath, 'escape.txt'));
  await assert.rejects(createBackup({ ...f, destination: path.join(f.root, 'bad-backup') }), BackupError);
  fs.unlinkSync(path.join(f.documentsPath, 'escape.txt'));
  const bundle = path.join(f.root, 'backup'); await createBackup({ ...f, destination: bundle });
  await assert.rejects(createBackup({ ...f, destination: bundle }), BackupError);
  assert.throws(() => restoreBackup({ bundlePath: bundle, dbPath: f.dbPath, documentsPath: path.join(f.root, 'other-docs') }), /already exist/);
});

test('offline operations refuse a live cooperating runtime lock', t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const release = acquirePlatformRuntimeLock(f.dbPath);
  assert.throws(() => assertPlatformRuntimeStopped(f.dbPath), /appears active/);
  assert.throws(() => acquirePlatformRuntimeLock(f.dbPath), /owns this database/);
  release();
  assert.doesNotThrow(() => assertPlatformRuntimeStopped(f.dbPath));
});

test('replacement preserves the prior WAL state beside the saved database', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const bundle = path.join(f.root, 'backup'); await createBackup({ ...f, destination: bundle });
  const targetDb = path.join(f.root, 'replace', 'platform.sqlite');
  const targetDocs = path.join(f.root, 'replace', 'documents');
  fs.mkdirSync(path.dirname(targetDb), { recursive: true }); fs.copyFileSync(f.dbPath, targetDb); fs.mkdirSync(targetDocs);
  const child = spawnSync(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0'); db.prepare('INSERT INTO platform_records(company_id,kind,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('old-company','jobs','wal-only',JSON.stringify({id:'wal-only'}),'old','old'); process.exit(0);`, targetDb]);
  assert.equal(child.status, 0, child.stderr?.toString());
  const sidecars = ['-wal', '-shm'].filter(suffix => fs.existsSync(`${targetDb}${suffix}`));
  assert.ok(sidecars.includes('-wal'), 'abruptly closed database should leave an uncheckpointed WAL');
  const savedSidecarContents = new Map(sidecars.map(suffix => [suffix, fs.readFileSync(`${targetDb}${suffix}`)]));
  const { preserved } = restoreBackup({ bundlePath: bundle, dbPath: targetDb, documentsPath: targetDocs, replace: true });
  const oldDb = preserved.find(item => item.includes('.pre-restore-'));
  assert.ok(oldDb);
  for (const [suffix, value] of savedSidecarContents) {
    assert.equal(fs.existsSync(`${targetDb}${suffix}`), false);
    assert.equal(fs.existsSync(`${oldDb}${suffix}`), true);
    if (suffix === '-wal') assert.deepEqual(fs.readFileSync(`${oldDb}${suffix}`), value);
  }
  const db = openDatabase(targetDb);
  assert.equal(db.prepare('SELECT count(*) AS n FROM platform_records').get().n, 1);
  db.close();
});

test('rejects overlapping backup and restore paths before moving targets', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  await assert.rejects(createBackup({ ...f, destination: path.join(f.documentsPath, 'nested-backup') }), /separate from/);
  const bundle = path.join(f.root, 'backup'); await createBackup({ ...f, destination: bundle });
  assert.throws(() => restoreBackup({ bundlePath: bundle, dbPath: path.join(f.root, 'elsewhere.sqlite'), documentsPath: f.root, replace: true }), /separate from each other/);
  assert.equal(fs.existsSync(path.join(f.root, 'manifest.json')), false);
  assert.equal(fs.readFileSync(path.join(f.documentsPath, 'nested', 'cv.txt'), 'utf8'), 'private candidate document');
});
