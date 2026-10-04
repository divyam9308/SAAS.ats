#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCompanyPackage } from '../builder/generate.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { defaults } = require('../shared/ats-config.cjs')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const runId = randomUUID().slice(0, 8)
const generated = []
const childProcesses = new Set()
const counts = { generatedCi: 0, builds: 0, workspaceTests: 0, runtimeStarts: 0, runtimeAssertions: 0, backupCommands: 0 }
const PRESETS = ['corporate', 'agency', 'startup', 'campus', 'basic']
const RUNTIME_MODES = { corporate: 'corporate', agency: 'agency', startup: 'startup', campus: 'corporate', basic: 'startup' }
const MODULE_ROUTES = [
  ['agency', 'clients', config => config.modules.agency],
  ['invoices', 'invoices', config => config.modules.agency && config.modules.invoices],
  ['referrals', 'referrals', config => config.modules.referrals],
  ['talentCrm', 'talentPools', config => config.modules.talentCrm],
  ['requisitions', 'requisitions', config => config.modules.requisitions],
  ['offers', 'offers', config => config.modules.offers],
  ['onboarding', 'onboarding', config => config.modules.onboarding]
]

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || root, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    childProcesses.add(child)
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => { childProcesses.delete(child); reject(error) })
    child.once('close', (code, signal) => {
      childProcesses.delete(child)
      const result = { code, signal, stdout, stderr }
      if (code !== 0) reject(new Error(`${command} ${args.join(' ')} failed (${signal || code})\n${stderr || stdout}`))
      else resolve(result)
    })
  })
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  childProcesses.add(child)
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  child.once('close', () => childProcesses.delete(child))
  return { child, output: () => output }
}

async function stop(processInfo) {
  const { child } = processInfo
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'close'), delay(8000).then(() => { if (child.exitCode === null) child.kill('SIGKILL') })])
}

async function freePort() {
  const net = await import('node:net')
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(1800) })
  return { response, body: await response.json().catch(() => ({})) }
}

function runtimeEnv(entry, port) {
  return {
    ...process.env,
    NODE_ENV: 'development', PLATFORM_MODE: 'true', LOCAL_DEMO_MODE: 'true', PORT: String(port),
    ATS_PLATFORM_CONFIG: path.join(entry.workspaceDirectory, 'config', 'platform.config.json'),
    ATS_PLATFORM_DB: entry.dbPath,
    ATS_PLATFORM_DATA_DIR: entry.docsPath,
    ATS_PLATFORM_SEED_DEMO: 'false', PLATFORM_REMINDERS: 'false'
  }
}

async function waitForBootstrap(url, headers, processInfo) {
  let lastError
  for (let attempt = 0; attempt < 50; attempt++) {
    if (processInfo.child.exitCode !== null) throw new Error(`Generated API exited early: ${processInfo.output()}`)
    try {
      const result = await getJson(url, headers)
      if (result.response.status === 200) return result
      lastError = new Error(`Bootstrap returned ${result.response.status}: ${JSON.stringify(result.body)}`)
    } catch (error) { lastError = error }
    await delay(200)
  }
  throw new Error(`Generated API did not become ready: ${lastError?.message}\n${processInfo.output()}`)
}

function makeConfig(preset, label) {
  const config = defaults(preset)
  config.company.name = `Matrix ${label} ${runId}`
  config.company.slug = `matrix-${label}-${runId}`
  config.company.legalName = `${config.company.name} LLC`
  config.branding.productName = `${config.company.name} ATS`
  // Keep each preset's intentionally distinct terminology (notably agency mandates
  // and campus students) while giving every generated company a unique identity.
  const pipeline = config.pipelines.find(item => item.default) || config.pipelines[0]
  pipeline.name = `${label[0].toUpperCase()}${label.slice(1)} Flow ${runId}`
  return config
}

async function verifyWorkspace(entry) {
  const { workspaceDirectory: cwd, slug, preset, config } = entry
  let operationalRecordCount = 0
  await run(npm, ['ci'], { cwd }); counts.generatedCi++
  await run(npm, ['--prefix', 'server', 'ci'], { cwd }); counts.generatedCi++
  await run(npm, ['run', 'build'], { cwd }); counts.builds++
  const tests = await run(npm, ['test'], { cwd }); counts.workspaceTests++
  console.log(`${preset}: ${tests.stdout.split('\n').filter(line => /^(?:#|ℹ) (tests|pass|fail|skipped) /.test(line)).join('; ')}`)
  const port = await freePort()
  const dataRoot = path.join(root, 'generated', `.matrix-data-${runId}`, slug)
  const dbPath = path.join(dataRoot, 'platform.sqlite')
  const docsPath = path.join(dataRoot, 'documents')
  const env = {
    ...process.env,
    NODE_ENV: 'development', PLATFORM_MODE: 'true', LOCAL_DEMO_MODE: 'true', PORT: String(port),
    ATS_PLATFORM_CONFIG: path.join(cwd, 'config', 'platform.config.json'), ATS_PLATFORM_DB: dbPath,
    ATS_PLATFORM_DATA_DIR: docsPath, ATS_PLATFORM_SEED_DEMO: 'false', PLATFORM_REMINDERS: 'false'
  }
  const api = start(process.execPath, [path.join(cwd, 'server', 'server.js')], cwd, env)
  counts.runtimeStarts++
  const base = `http://127.0.0.1:${port}/api/platform`
  const auth = { 'x-demo-user': 'demo-admin' }
  try {
    const { body } = await waitForBootstrap(`${base}/bootstrap`, auth, api)
    const bootstrap = body.data
    assert.equal(bootstrap.config.company.slug, slug, `${slug}: expected generated config at bootstrap`)
    assert.equal(bootstrap.config.mode, RUNTIME_MODES[preset], `${slug}: preset should retain its documented runtime mode`)
    assert.deepEqual(bootstrap.config.modules, config.modules, `${slug}: configured module gates should survive runtime`)
    assert.equal(bootstrap.config.terminology.jobs, config.terminology.jobs, `${slug}: custom terminology should survive runtime`)
    assert.equal(bootstrap.config.terminology.candidates, config.terminology.candidates, `${slug}: candidate terminology should survive runtime`)
    const pipeline = bootstrap.config.pipelines.find(item => item.default) || bootstrap.config.pipelines[0]
    assert.deepEqual(pipeline, config.pipelines.find(item => item.default) || config.pipelines[0], `${slug}: configured stage graph should survive runtime`)
    assert.deepEqual(bootstrap.config.roles.map(role => role.id).sort(), config.roles.map(role => role.id).sort(), `${slug}: configured roles should survive runtime`)
    assert.deepEqual(bootstrap.config.users.map(user => user.id).sort(), config.users.map(user => user.id).sort(), `${slug}: configured demo personas should survive runtime`)
    assert.deepEqual(bootstrap.config.applicationForms, config.applicationForms, `${slug}: configured application forms should survive runtime`)
    const candidates = await getJson(`${base}/records/candidates`, auth)
    assert.equal(candidates.response.status, 200, `${slug}: candidate listing should be authorized`)
    assert.equal(candidates.body.data.length, 0, `${slug}: demo seeding must remain disabled`)
    const clients = await getJson(`${base}/records/clients`, auth)
    assert.equal(clients.response.status, preset === 'agency' ? 200 : 403, `${slug}: client route must follow agency capability`)
    for (const [module, kind, enabled] of MODULE_ROUTES) {
      const result = await getJson(`${base}/records/${kind}`, auth)
      assert.equal(result.response.status, enabled(config) ? 200 : 403, `${slug}: ${module} route must follow its configured module gate`)
      counts.runtimeAssertions++
    }
    const interviewer = config.users.find(user => user.roleId === 'interviewer')
    assert.ok(interviewer, `${slug}: expected a configured interviewer persona`)
    const deniedCreate = await fetch(`${base}/records/candidates`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json', 'x-demo-user': interviewer.id },
      body: JSON.stringify({ data: { name: `Denied ${slug}`, email: `denied-${slug}@example.test` } }), signal: AbortSignal.timeout(1800)
    })
    assert.equal(deniedCreate.status, 403, `${slug}: interviewer must be denied candidate creation`)
    counts.runtimeAssertions += 13
    const marker = `matrix-${slug}@example.test`
    const created = await fetch(`${base}/records/candidates`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ data: { name: `Matrix ${slug} Persistence`, email: marker } }), signal: AbortSignal.timeout(1800)
    })
    const createdBody = await created.json().catch(() => ({}))
    assert.equal(created.status, 201, `${slug}: synthetic persistence record should be created: ${JSON.stringify(createdBody)}`)
    assert.equal(createdBody.data.email, marker, `${slug}: synthetic persistence record should retain its unique marker`)
    counts.runtimeAssertions += 2
    const afterCreate = await getJson(`${base}/bootstrap`, auth)
    assert.equal(afterCreate.body.data.counts.candidates, 1, `${slug}: exactly one synthetic candidate should be persisted`)
    counts.runtimeAssertions++
  } finally {
    await stop(api)
  }

  assert.ok((await stat(dbPath)).isFile(), `${slug}: runtime should create isolated SQLite file`)
  // Bootstrap counts intentionally omit disabled or unreadable modules. The
  // offline backup includes all stored records, including audit/automation data.
  const snapshot = new (require('node:sqlite').DatabaseSync)(dbPath, { readOnly: true })
  try {
    operationalRecordCount = snapshot.prepare('SELECT COUNT(*) AS count FROM platform_records').get().count
    const candidates = snapshot.prepare("SELECT data FROM platform_records WHERE kind='candidates'").all().map(row => JSON.parse(row.data))
    assert.deepEqual(candidates.map(candidate => candidate.email), [markerFor(slug)], `${slug}: offline snapshot should contain only its own synthetic candidate`)
    counts.runtimeAssertions++
  } finally { snapshot.close() }
  await mkdir(docsPath, { recursive: true })
  return { ...entry, dbPath, docsPath, marker: `matrix-${slug}@example.test`, operationalRecordCount }
}

function markerFor(slug) { return `matrix-${slug}@example.test` }

async function verifyPersistenceIsolation(entries) {
  for (const entry of entries) {
    const port = await freePort()
    const api = start(process.execPath, [path.join(entry.workspaceDirectory, 'server', 'server.js')], entry.workspaceDirectory, runtimeEnv(entry, port))
    counts.runtimeStarts++
    try {
      const base = `http://127.0.0.1:${port}/api/platform`
      const { body } = await waitForBootstrap(`${base}/bootstrap`, { 'x-demo-user': 'demo-admin' }, api)
      assert.equal(body.data.config.company.slug, entry.slug, `${entry.slug}: restarted workspace should load its own persisted config`)
      const candidates = await getJson(`${base}/records/candidates`, { 'x-demo-user': 'demo-admin' })
      assert.equal(candidates.response.status, 200, `${entry.slug}: restarted candidate API should remain available`)
      assert.ok(candidates.body.data.some(candidate => candidate.email === entry.marker), `${entry.slug}: synthetic candidate should survive restart`)
      counts.runtimeAssertions += 3
      for (const other of entries) {
        if (other === entry) continue
        assert.equal(candidates.body.data.some(candidate => candidate.email === other.marker), false, `${entry.slug}: must not contain ${other.preset}'s candidate`)
        counts.runtimeAssertions++
      }
    } finally { await stop(api) }
  }
}

async function verifyBackup(entry) {
  const restoreRoot = path.join(root, '..', `.ats-matrix-restore-${runId}-${entry.slug}`)
  const backupPath = path.join(root, 'generated', `.matrix-backup-${runId}-${entry.slug}`)
  const restoreDb = path.join(restoreRoot, 'db', 'platform.sqlite')
  const restoreDocs = path.join(restoreRoot, 'documents')
  await mkdir(restoreRoot, { recursive: true })
  const env = { ...process.env, ATS_PLATFORM_DB: entry.dbPath, ATS_PLATFORM_DATA_DIR: entry.docsPath }
  await run(process.execPath, ['scripts/deployment-backup.mjs', 'backup', '--destination', backupPath], { cwd: root, env }); counts.backupCommands++
  const preview = await run(process.execPath, ['scripts/deployment-backup.mjs', 'preview', '--bundle', backupPath], { cwd: root, env }); counts.backupCommands++
  const details = JSON.parse(preview.stdout)
  assert.equal(details.companyCount, 1, `${entry.slug}: backup preview should contain its configured company`)
  assert.equal(details.recordCount, entry.operationalRecordCount, `${entry.slug}: backup should contain its expected synthetic operational record count`)
  await run(process.execPath, ['scripts/deployment-backup.mjs', 'restore', '--bundle', backupPath, '--db', restoreDb, '--documents', restoreDocs, '--replace', '--confirm'], { cwd: root, env }); counts.backupCommands++
  assert.ok((await stat(restoreDb)).isFile(), `${entry.slug}: restore should create database at separate target`)
  assert.ok((await stat(restoreDocs)).isDirectory(), `${entry.slug}: restore should create document directory at separate target`)
  const restored = require('node:sqlite').DatabaseSync
  const db = new restored(restoreDb, { readOnly: true })
  try {
    const configRow = db.prepare('SELECT active FROM platform_config').get()
    assert.ok(configRow, `${entry.slug}: restored database should contain the initialized configuration`)
    assert.equal(JSON.parse(configRow.active).company.slug, entry.slug)
    const candidates = db.prepare("SELECT data FROM platform_records WHERE kind='candidates'").all().map(row => JSON.parse(row.data))
    assert.deepEqual(candidates.map(candidate => candidate.email), [entry.marker], `${entry.slug}: restored backup should preserve the unique candidate`)
  } finally { db.close() }
  counts.runtimeAssertions += 5
  return { backupPath, restoreRoot }
}

async function verifyProductionAuth(entry) {
  const port = await freePort()
  const env = {
    ...process.env, NODE_ENV: 'production', PLATFORM_MODE: 'true', LOCAL_DEMO_MODE: 'false', PORT: String(port),
    ATS_PLATFORM_CONFIG: path.join(entry.workspaceDirectory, 'config', 'platform.config.json'),
    ATS_PLATFORM_DB: path.join(root, 'generated', `.matrix-production-${runId}`, `${entry.slug}.sqlite`),
    ATS_PLATFORM_DATA_DIR: path.join(root, 'generated', `.matrix-production-${runId}`, `${entry.slug}-documents`),
    ATS_PLATFORM_SEED_DEMO: 'false', PLATFORM_REMINDERS: 'false'
  }
  const api = start(process.execPath, [path.join(entry.workspaceDirectory, 'server', 'server.js')], entry.workspaceDirectory, env)
  counts.runtimeStarts++
  try {
    let result
    for (let i = 0; i < 50; i++) {
      try { result = await getJson(`http://127.0.0.1:${port}/api/platform/bootstrap`); break }
      catch { await delay(200) }
    }
    assert.ok(result, `production-style ${entry.slug} API should start`)
    assert.equal(result.response.status, 503, 'production must fail closed without an authentication adapter')
    counts.runtimeAssertions++
  } finally { await stop(api) }
}

async function cleanup() {
  for (const child of childProcesses) if (child.exitCode === null) child.kill('SIGKILL')
  for (const entry of generated) {
    await rm(entry.outputDirectory, { recursive: true, force: true })
    await rm(entry.archiveFile, { force: true })
    await rm(entry.configFile, { force: true })
    await rm(path.join(root, 'generated', `.matrix-data-${runId}`, entry.slug), { recursive: true, force: true })
    await rm(path.join(root, 'generated', `.matrix-production-${runId}`, `${entry.slug}.sqlite`), { force: true })
    await rm(path.join(root, 'generated', `.matrix-production-${runId}`, `${entry.slug}.sqlite.runtime-lock.json`), { force: true })
    await rm(path.join(root, 'generated', `.matrix-production-${runId}`, `${entry.slug}-documents`), { recursive: true, force: true })
    await rm(path.join(root, '..', `.ats-matrix-restore-${runId}-${entry.slug}`), { recursive: true, force: true })
    await rm(path.join(root, 'generated', `.matrix-backup-${runId}-${entry.slug}`), { recursive: true, force: true })
  }
  await rm(path.join(root, 'generated', `.matrix-production-${runId}`), { recursive: true, force: true })
  await rm(path.join(root, 'generated', `.matrix-data-${runId}`), { recursive: true, force: true })
}

try {
  // The source dependency trees are already installed and are shared with concurrent browser verification.
  // Verify the generated root and server lockfiles through clean installs instead.
  for (const preset of PRESETS) {
    const config = makeConfig(preset, preset)
    const result = await generateCompanyPackage(config)
    generated.push({ ...result, preset, config })
  }
  const verified = []
  for (const entry of generated) verified.push(await verifyWorkspace(entry))
  await verifyProductionAuth(verified[0])
  const backupResults = []
  await verifyPersistenceIsolation(verified)
  for (const entry of verified) backupResults.push(await verifyBackup(entry))
  console.log(`Generated matrix passed: ${verified.length} distinct packages (${PRESETS.join(', ')}); generated root/server npm ci ${counts.generatedCi}/${verified.length * 2}; production builds ${counts.builds}/${verified.length}; workspace npm test ${counts.workspaceTests}/${verified.length}; API starts ${counts.runtimeStarts}; runtime/backup assertions ${counts.runtimeAssertions}; backup CLI commands ${counts.backupCommands}.`)
} catch (error) {
  console.error(`Generated matrix failed: ${error.stack || error.message}`)
  process.exitCode = 1
} finally {
  await cleanup()
}
