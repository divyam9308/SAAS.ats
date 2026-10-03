'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

class RuntimeLockError extends Error { constructor(message) { super(message); this.name = 'RuntimeLockError'; } }
const lockPathFor = dbPath => `${path.resolve(dbPath)}.runtime-lock.json`;
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function readLock(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && Number.isSafeInteger(value.pid) && typeof value.token === 'string' && typeof value.host === 'string' ? value : { malformed: true };
  } catch (error) { return error.code === 'ENOENT' ? null : { malformed: true }; }
}
function isStaleLocal(lock) { return !!lock && !lock.malformed && lock.host === os.hostname() && !processIsAlive(lock.pid); }
function isTrustedSystemAlias(candidate, stats) {
  if (process.platform !== 'darwin' || !stats.isSymbolicLink()) return false;
  const expectedTarget = candidate === '/var' ? '/private/var' : candidate === '/tmp' ? '/private/tmp' : '';
  if (!expectedTarget) return false;
  try { return stats.uid === 0 && fs.realpathSync.native(candidate) === expectedTarget; }
  catch { return false; }
}
function assertNoSymlinkAncestors(target) {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink() && !isTrustedSystemAlias(current, stats)) throw new RuntimeLockError(`Runtime lock path contains a symlink: ${current}`);
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; break; }
  }
}
function assertPlatformRuntimeStopped(dbPath) {
  assertNoSymlinkAncestors(path.resolve(dbPath));
  const file = lockPathFor(dbPath);
  const lock = readLock(file);
  if (!lock) return true;
  if (lock.malformed || lock.host !== os.hostname()) throw new RuntimeLockError('Runtime lock is malformed or belongs to another host; refusing offline operation');
  if (processIsAlive(lock.pid)) throw new RuntimeLockError(`Local ATS runtime appears active (PID ${lock.pid}); stop it before backing up or restoring`);
  throw new RuntimeLockError(`A stale runtime lock remains for PID ${lock.pid}; verify no ATS process is using this database, then remove ${file}`);
}
function generationLockPathFor(dbPath) {
  const absolute = path.resolve(dbPath);
  const workspace = path.resolve(path.dirname(absolute), '..', '..');
  const instance = path.dirname(workspace);
  return path.join(path.dirname(instance), '.locks', `${path.basename(instance)}.lock`);
}
function assertNoConcurrentGeneration(dbPath, allowGenerationLock) {
  const marker = generationLockPathFor(dbPath);
  assertNoSymlinkAncestors(marker);
  let lock;
  try { lock = JSON.parse(fs.readFileSync(marker, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw new RuntimeLockError(`Generation lock is unreadable; refusing runtime start (${marker})`); }
  if (!allowGenerationLock) throw new RuntimeLockError(`ATS generation for this instance is in progress (lock: ${marker})`);
}
function acquirePlatformRuntimeLock(dbPath, { allowGenerationLock = false } = {}) {
  let file = lockPathFor(dbPath);
  assertNoSymlinkAncestors(path.resolve(dbPath));
  assertNoConcurrentGeneration(dbPath, allowGenerationLock);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomUUID();
  const data = { pid: process.pid, token, host: os.hostname(), startedAt: new Date().toISOString() };
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(data)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const release = relocatedDbPath => {
        if (relocatedDbPath) file = lockPathFor(relocatedDbPath);
        const current = readLock(file);
        if (current?.token === token) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      };
      try { assertNoConcurrentGeneration(dbPath, allowGenerationLock); }
      catch (error) { release(); throw error; }
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = readLock(file);
      if (!current) throw new RuntimeLockError('Runtime lock changed during acquisition; retry after checking active processes');
      if (current.malformed || current.host !== os.hostname()) throw new RuntimeLockError('Runtime lock is malformed or belongs to another host; refusing operation');
      if (isStaleLocal(current)) throw new RuntimeLockError(`A stale runtime lock remains for PID ${current.pid}; verify no ATS process is using this database, then remove ${file}`);
      throw new RuntimeLockError(`Another local ATS runtime owns this database (PID ${current.pid})`);
    }
}
module.exports = { RuntimeLockError, lockPathFor, generationLockPathFor, acquirePlatformRuntimeLock, assertPlatformRuntimeStopped, isTrustedSystemAlias };
