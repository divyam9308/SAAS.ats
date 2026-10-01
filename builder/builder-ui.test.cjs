'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const { readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const express = require('../server/node_modules/express')
const { DatabaseSync } = require('node:sqlite')
const { defaults } = require('../shared/ats-config.cjs')

let server
let baseUrl
let testDirectory
let factoryDatabase

test.before(async () => {
  const port = 43_000 + process.pid % 1_000
  baseUrl = `http://127.0.0.1:${port}`
  testDirectory = fs.mkdtempSync(join(os.tmpdir(), 'ats-builder-'))
  factoryDatabase = join(testDirectory, 'factory.sqlite')
  server = spawn(process.execPath, [resolve(__dirname, 'server.mjs')], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, ATS_BUILDER_PORT: String(port), ATS_PLATFORM_DB: factoryDatabase },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Builder did not start.')), 10_000)
    server.once('exit', code => reject(new Error(`Builder exited early (${code}).`)))
    server.stderr.on('data', chunk => reject(new Error(String(chunk))))
    server.stdout.on('data', chunk => {
      if (!String(chunk).includes('ATS Builder running')) return
      clearTimeout(timeout)
      resolveReady()
    })
  })
})

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise(resolveExit => server.once('exit', resolveExit))
  }
  fs.rmSync(testDirectory, { recursive: true, force: true })
})

test('guided builder is the primary buyer experience', async () => {
  const response = await fetch(`${baseUrl}/`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /id="steps"/)
  assert.match(html, /id="save-draft"/)
  assert.match(html, /id="import-trigger"/)
  assert.match(html, /id="export"/)
  assert.match(html, /Review &amp; generate|step-content/)
  assert.match(html, /class="editor-preview-layout"/)
  assert.match(html, /id="preview-frame"/)
  assert.match(html, /id="preview-page"/)
  assert.match(html, /Preview updates as you edit/)
  assert.doesNotMatch(html, /id="config"/)
})

test('builder script wires immediate, page-aware live preview updates', async () => {
  const response = await fetch(`${baseUrl}/app.js`)
  assert.equal(response.status, 200)
  const script = await response.text()
  assert.match(script, /function renderPreview\(\)/)
  assert.match(script, /previewPageForStep/)
  assert.match(script, /addEventListener\(eventName, update\)/)
  assert.match(script, /data-preview-page/)
  assert.match(script, /modules\.agency/)
  assert.match(script, /validCurrency/)
})

test('local Vite proxy uses the API server IPv4 bind address', async () => {
  const source = await readFile(resolve(__dirname, '..', 'vite.config.js'), 'utf8')
  assert.match(source, /http:\/\/127\.0\.0\.1:4000/)
  assert.doesNotMatch(source, /target:\s*['"]http:\/\/localhost:4000/)
})

test('every buyer preset loads and validates through the builder API', async () => {
  for (const name of ['corporate', 'agency', 'startup', 'campus', 'basic']) {
    const presetResponse = await fetch(`${baseUrl}/api/presets/${name}`)
    assert.equal(presetResponse.status, 200)
    const config = await presetResponse.json()
    const validationResponse = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
    })
    assert.equal(validationResponse.status, 200)
    const result = await validationResponse.json()
    assert.equal(result.valid, true, `${name}: ${(result.errors || []).join(', ')}`)
  }
})

test('Apply activates the factory runtime configuration without touching a real local database', async t => {
  const config = defaults('startup')
  config.company.name = 'Applied Factory Company'
  config.company.slug = 'applied-factory-company'
  config.branding.productName = 'Applied Factory ATS'

  const response = await fetch(`${baseUrl}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config }),
  })
  const applied = await response.json()
  assert.equal(response.status, 200, JSON.stringify(applied))
  assert.equal(applied.target, 'factory')
  assert.equal(applied.databaseUpdated, true)
  assert.equal(applied.version, 2)

  const db = new DatabaseSync(factoryDatabase)
  const row = db.prepare('SELECT active,draft,active_version FROM platform_config WHERE company_id=?').get('local-company')
  assert.equal(JSON.parse(row.active).company.name, 'Applied Factory Company')
  assert.equal(JSON.parse(row.draft).branding.productName, 'Applied Factory ATS')
  assert.equal(row.active_version, 2)
  assert.equal(db.prepare('SELECT count(*) AS count FROM platform_config_versions WHERE company_id=?').get('local-company').count, 2)
  assert.equal(db.prepare('SELECT action FROM platform_audit WHERE company_id=? ORDER BY seq DESC LIMIT 1').get('local-company').action, 'configuration.activated')
  assert.equal(db.prepare('SELECT count(*) AS count FROM platform_users WHERE company_id=?').get('local-company').count, config.users.length)
  db.close()

  const { createPlatformRouter } = require('../server/src/platform')
  const router = createPlatformRouter({ dbPath: factoryDatabase, dataDir: join(testDirectory, 'documents') })
  const runtime = express()
  runtime.use(express.json())
  runtime.use('/api/platform', router)
  const runtimeServer = await new Promise(resolveReady => {
    const listening = runtime.listen(0, '127.0.0.1', () => resolveReady(listening))
  })
  t.after(async () => {
    await new Promise(resolveClose => runtimeServer.close(resolveClose))
    router.close()
  })

  const bootstrapResponse = await fetch(`http://127.0.0.1:${runtimeServer.address().port}/api/platform/bootstrap`, {
    headers: { 'x-demo-user': 'demo-admin' },
  })
  const bootstrap = await bootstrapResponse.json()
  assert.equal(bootstrapResponse.status, 200, JSON.stringify(bootstrap))
  assert.equal(bootstrap.data.config.company.name, 'Applied Factory Company')
  assert.equal(bootstrap.data.config.branding.productName, 'Applied Factory ATS')
  assert.equal(bootstrap.data.config.mode, 'startup')
})

test('regeneration preserves buyer data, creates a rollback backup, and emits reproducible installs', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const config = defaults('startup')
  const slug = `builder-regeneration-${process.pid}`
  config.company.name = 'Builder Regeneration Safety'
  config.company.slug = slug
  const generatedRoot = resolve(__dirname, '..', 'generated')
  const outputDirectory = join(generatedRoot, slug)
  const archiveFile = join(generatedRoot, `${slug}-ats-platform.tar.gz`)
  const configFile = resolve(__dirname, '..', 'configs', `${slug}.json`)
  const cleanup = new Set([outputDirectory, archiveFile, configFile])
  t.after(() => { for (const target of cleanup) fs.rmSync(target, { recursive: true, force: true }) })

  const first = await generateCompanyPackage(config)
  assert.equal(first.backupDirectory, null)
  assert.equal(fs.existsSync(join(first.workspaceDirectory, 'package-lock.json')), true)
  assert.equal(fs.existsSync(join(first.workspaceDirectory, 'server', 'package-lock.json')), true)
  const generatedPackage = JSON.parse(fs.readFileSync(join(first.workspaceDirectory, 'package.json'), 'utf8'))
  assert.equal(generatedPackage.scripts.setup, 'npm ci && npm --prefix server ci')

  const dataDirectory = join(first.workspaceDirectory, 'server', 'data')
  fs.mkdirSync(dataDirectory, { recursive: true })
  fs.writeFileSync(join(dataDirectory, 'buyer-data.txt'), 'must survive regeneration')
  config.company.name = 'Builder Regeneration Safety Updated'
  const second = await generateCompanyPackage(config)
  cleanup.add(second.backupDirectory)
  assert.equal(fs.readFileSync(join(second.workspaceDirectory, 'server', 'data', 'buyer-data.txt'), 'utf8'), 'must survive regeneration')
  assert.equal(fs.existsSync(join(second.backupDirectory, 'workspace', 'server', 'data', 'buyer-data.txt')), true)
})
