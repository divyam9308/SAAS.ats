'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup: sqliteBackup } = require('node:sqlite');
const { acquirePlatformRuntimeLock, isTrustedSystemAlias } = require('./runtime-lock');

const FORMAT = 'ats-local-backup';
const VERSION = 1;
const MANIFEST = 'manifest.json';

class BackupError extends Error { constructor(message) { super(message); this.name = 'BackupError'; } }
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const overlaps = (left, right) => left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
function realDirectory(p, label) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new BackupError(`${label} must be a real directory, not a symlink`);
}
function safeRelative(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !path.posix.isAbsolute(name)
    && name.split('/').every(part => part && part !== '.' && part !== '..');
}
function listFiles(root) {
  const output = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new BackupError(`Symlink found in document storage: ${relative}`);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) output.push({ path: relative, size: fs.statSync(full).size, sha256: digest(fs.readFileSync(full)) });
      else throw new BackupError(`Unsupported filesystem entry in document storage: ${relative}`);
    }
  }
  if (exists(root)) { realDirectory(root, 'Document storage'); walk(root); }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}
function assertOwnedDocumentStorage(root) {
  realDirectory(root, 'Document target');
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    // The local ATS writes one UUID-named document per storage item. Rejecting
    // arbitrary contents prevents --replace from adopting broad user folders.
    if (!entry.isFile() || entry.isSymbolicLink() || !/^document_[0-9a-f-]{36}(?:\.[a-z0-9]{1,12})?$/i.test(entry.name)) {
      throw new BackupError(`Existing document target does not look like local ATS document storage: ${root}`);
    }
  }
}
function assertDatabase(dbPath, { quickCheck = true } = {}) {
  if (!exists(dbPath)) throw new BackupError(`SQLite database not found: ${dbPath}`);
  const st = fs.lstatSync(dbPath);
  if (!st.isFile() || st.isSymbolicLink()) throw new BackupError('Database path must be a regular file, not a symlink');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!names.has('platform_records') || !names.has('platform_config')) throw new BackupError('Database is not a recognized local ATS database');
    if (quickCheck) {
      const integrity = db.prepare('PRAGMA quick_check').get();
      if (!integrity || integrity.quick_check !== 'ok') throw new BackupError('SQLite database failed its integrity check');
    }
  } finally { db.close(); }
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function ensureNoSymlinkAncestors(p) {
  const resolved = path.resolve(p);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!exists(current)) break;
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink() && !isTrustedSystemAlias(current, stats)) throw new BackupError(`Path contains a symlink: ${current}`);
  }
}

async function createBackupUnlocked({ dbPath, documentsPath, destination }) {
  dbPath = path.resolve(dbPath); documentsPath = path.resolve(documentsPath); destination = path.resolve(destination);
  if (overlaps(destination, dbPath) || overlaps(destination, documentsPath)) throw new BackupError('Backup destination must be separate from the database and document storage paths');
  ensureNoSymlinkAncestors(dbPath); ensureNoSymlinkAncestors(documentsPath);
  assertDatabase(dbPath);
  ensureNoSymlinkAncestors(destination);
  if (exists(destination)) throw new BackupError(`Backup destination already exists: ${destination}`);
  const parent = path.dirname(destination); fs.mkdirSync(parent, { recursive: true });
  const stage = path.join(parent, `.${path.basename(destination)}.tmp-${crypto.randomUUID()}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  try {
    fs.mkdirSync(path.join(stage, 'documents'));
    const sourceDb = new DatabaseSync(dbPath, { readOnly: true });
    try { await sqliteBackup(sourceDb, path.join(stage, 'database.sqlite')); } finally { sourceDb.close(); }
    // The bundle is a standalone file; remove WAL sidecars before hashing it.
    const snapshotDb = new DatabaseSync(path.join(stage, 'database.sqlite'));
    try { snapshotDb.exec('PRAGMA journal_mode = DELETE'); } finally { snapshotDb.close(); }
    const documentFiles = listFiles(documentsPath);
    for (const item of documentFiles) {
      const from = path.join(documentsPath, ...item.path.split('/'));
      const to = path.join(stage, 'documents', ...item.path.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (digest(fs.readFileSync(to)) !== item.sha256) throw new BackupError(`Document changed while being backed up: ${item.path}`);
    }
    const dbBytes = fs.readFileSync(path.join(stage, 'database.sqlite'));
    const manifest = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), database: { path: 'database.sqlite', size: dbBytes.length, sha256: digest(dbBytes) }, documents: documentFiles };
    writeJson(path.join(stage, MANIFEST), manifest);
    fs.renameSync(stage, destination);
    return manifest;
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}
async function createBackup(options) {
  const release = acquirePlatformRuntimeLock(options.dbPath);
  try { return await createBackupUnlocked(options); } finally { release(); }
}

function validateBackup(bundlePath) {
  bundlePath = path.resolve(bundlePath); ensureNoSymlinkAncestors(bundlePath); realDirectory(bundlePath, 'Backup bundle');
  if (fs.lstatSync(path.join(bundlePath, MANIFEST)).isSymbolicLink()) throw new BackupError('Manifest may not be a symlink');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(bundlePath, MANIFEST), 'utf8')); } catch { throw new BackupError('Backup manifest is missing or invalid JSON'); }
  if (manifest.format !== FORMAT || manifest.version !== VERSION || manifest.database?.path !== 'database.sqlite' || !Array.isArray(manifest.documents)) throw new BackupError('Unsupported or malformed backup manifest');
  const listed = new Set(['manifest.json', 'database.sqlite', 'documents']);
  const seen = new Set();
  const dbFile = path.join(bundlePath, 'database.sqlite');
  if (fs.lstatSync(dbFile).isSymbolicLink() || !fs.statSync(dbFile).isFile()) throw new BackupError('Backup database must be a regular file');
  const dbBytes = fs.readFileSync(dbFile);
  if (dbBytes.length !== manifest.database.size || digest(dbBytes) !== manifest.database.sha256) throw new BackupError('Backup database checksum mismatch');
  assertDatabase(dbFile);
  const documentRoot = path.join(bundlePath, 'documents');
  realDirectory(documentRoot, 'Backup documents directory');
  for (const item of manifest.documents) {
    if (!safeRelative(item.path) || seen.has(item.path)) throw new BackupError(`Unsafe or duplicate document path: ${item.path}`);
    seen.add(item.path);
    const file = path.join(documentRoot, ...item.path.split('/'));
    let current = documentRoot;
    for (const part of item.path.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new BackupError(`Symlink in backup document path: ${item.path}`); }
    const st = fs.statSync(file);
    if (!st.isFile()) throw new BackupError(`Backup document is not a regular file: ${item.path}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== item.size || digest(bytes) !== item.sha256) throw new BackupError(`Backup document checksum mismatch: ${item.path}`);
  }
  function inspect(dir, prefix = '') {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new BackupError(`Symlink in backup bundle: ${rel}`);
      if (e.isDirectory()) inspect(path.join(dir, e.name), rel);
      else if (!e.isFile() || (rel.startsWith('documents/') ? !seen.has(rel.slice(10)) : !listed.has(rel))) throw new BackupError(`Unexpected backup bundle entry: ${rel}`);
    }
  }
  inspect(bundlePath);
  return { manifest, bundlePath, databasePath: dbFile, documentsPath: path.join(bundlePath, 'documents') };
}

function previewBackup(bundlePath) {
  const checked = validateBackup(bundlePath);
  const db = new DatabaseSync(checked.databasePath, { readOnly: true });
  try {
    const recordCount = db.prepare('SELECT count(*) AS n FROM platform_records').get().n;
    const companyCount = db.prepare('SELECT count(*) AS n FROM platform_config').get().n;
    return { createdAt: checked.manifest.createdAt, recordCount, companyCount, documentCount: checked.manifest.documents.length, documentBytes: checked.manifest.documents.reduce((n, x) => n + x.size, 0) };
  } finally { db.close(); }
}

function restoreBackupUnlocked({ bundlePath, dbPath, documentsPath, replace = false }) {
  const checked = validateBackup(bundlePath); // No target is touched before full validation.
  dbPath = path.resolve(dbPath); documentsPath = path.resolve(documentsPath);
  const os = require('node:os');
  const protectedRoots = [checked.bundlePath, process.cwd(), os.homedir(), os.tmpdir()];
  if (overlaps(dbPath, documentsPath) || overlaps(dbPath, checked.bundlePath) || overlaps(documentsPath, checked.bundlePath)
    || protectedRoots.some(root => documentsPath === root || root.startsWith(`${documentsPath}${path.sep}`))) {
    throw new BackupError('Restore targets must be separate from each other, the backup bundle, the workspace, and the home directory');
  }
  ensureNoSymlinkAncestors(dbPath); ensureNoSymlinkAncestors(documentsPath);
  const targets = [dbPath, documentsPath];
  if (!replace && targets.some(exists)) throw new BackupError('Restore targets already exist; use --replace to preserve them and restore');
  if (exists(dbPath)) assertDatabase(dbPath, { quickCheck: false });
  if (exists(documentsPath)) assertOwnedDocumentStorage(documentsPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true }); fs.mkdirSync(path.dirname(documentsPath), { recursive: true });
  const token = crypto.randomUUID();
  const stagedDb = `${dbPath}.restore-${token}`; const stagedDocs = `${documentsPath}.restore-${token}`;
  const oldDb = `${dbPath}.pre-restore-${token}`; const oldDocs = `${documentsPath}.pre-restore-${token}`;
  const sidecars = ['-wal', '-shm', '-journal'];
  const oldSidecars = new Map(sidecars.map(suffix => [`${dbPath}${suffix}`, `${oldDb}${suffix}`]));
  const movedSidecars = [];
  let dbMoved = false, docsMoved = false, dbInstalled = false, docsInstalled = false;
  try {
    fs.copyFileSync(checked.databasePath, stagedDb, fs.constants.COPYFILE_EXCL);
    fs.cpSync(checked.documentsPath, stagedDocs, { recursive: true, dereference: false, errorOnExist: true });
    assertDatabase(stagedDb);
    if (replace) {
      if (exists(dbPath)) { fs.renameSync(dbPath, oldDb); dbMoved = true; }
      for (const [sidecar, preserved] of oldSidecars) {
        if (!exists(sidecar)) continue;
        const stat = fs.lstatSync(sidecar);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new BackupError(`SQLite sidecar must be a regular file: ${sidecar}`);
        fs.renameSync(sidecar, preserved); movedSidecars.push([sidecar, preserved]);
      }
      if (exists(documentsPath)) { fs.renameSync(documentsPath, oldDocs); docsMoved = true; }
    }
    fs.renameSync(stagedDb, dbPath); dbInstalled = true;
    fs.renameSync(stagedDocs, documentsPath); docsInstalled = true;
    return { preserved: [dbMoved ? oldDb : null, docsMoved ? oldDocs : null].filter(Boolean) };
  } catch (error) {
    if (docsInstalled) fs.rmSync(documentsPath, { recursive: true, force: true });
    if (dbInstalled) fs.rmSync(dbPath, { force: true });
    if (docsMoved && exists(oldDocs)) fs.renameSync(oldDocs, documentsPath);
    for (const [sidecar, preserved] of movedSidecars.reverse()) if (exists(preserved)) fs.renameSync(preserved, sidecar);
    if (dbMoved && exists(oldDb)) fs.renameSync(oldDb, dbPath);
    throw error;
  } finally {
    fs.rmSync(stagedDb, { force: true }); fs.rmSync(stagedDocs, { recursive: true, force: true });
  }
}
function restoreBackup(options) {
  const release = acquirePlatformRuntimeLock(options.dbPath);
  try { return restoreBackupUnlocked(options); } finally { release(); }
}

module.exports = { BackupError, createBackup, validateBackup, previewBackup, restoreBackup, FORMAT, VERSION };
