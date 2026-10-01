import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { safeCompanySlug } from '../config/config-core.js'
import { validateConfig } from '../shared/ats-config.cjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { openDatabase, createStore, seedCompany, now } = require('../server/src/platform/database.js')
const { activateConfiguration } = require('../server/src/platform/config-lifecycle.js')
const json = value => JSON.stringify(value, null, 2) + '\n'
const execFileAsync = promisify(execFile)
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const WORKSPACE_ENTRIES = ['eslint.config.js', 'index.html', 'public', 'server', 'src', 'vite.config.js']
const SERVER_PACKAGE = {
  name: 'generated-ats-platform-server', version: '1.0.0', private: true, main: 'server.js',
  engines: { node: '>=22.5' },
  scripts: { start: 'node server.js', dev: 'node server.js', test: 'node --test ../tests/platform.acceptance.test.cjs src/platform/workflows.test.js src/platform/local-scheduler.test.js' },
  dependencies: { cors: '^2.8.5', dotenv: '^16.4.1', express: '^4.18.2' }
}

async function exists(file) { try { await access(file); return true } catch { return false } }

function validateForGeneration(input) {
  const result = validateConfig(input)
  if (!result.valid) throw new Error(`Invalid schemaV2 configuration:\n- ${result.errors.join('\n- ')}`)
  return structuredClone(input)
}

function platformApp() {
  return `'use strict'
const express = require('express')
const cors = require('cors')
const fs = require('node:fs')
const path = require('node:path')
const app = express()
app.disable('x-powered-by')
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"); next() })
const allowed = [/^http:\\/\\/(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?$/]
app.use(cors({ origin(origin, callback) { if (!origin || allowed.some(rule => rule.test(origin))) return callback(null, true); callback(new Error('Not allowed by CORS'), false) }, credentials: true }))
const maximumUploadMb = Math.max(1, Number(process.env.ATS_MAX_UPLOAD_MB) || 20)
app.use(express.json({ limit: Math.ceil(maximumUploadMb * 1024 * 1024 * 4 / 3) + 1024 * 1024 }))
const resolveSetting = (value, fallback) => path.isAbsolute(value || '') ? value : path.resolve(__dirname, '..', '..', value || fallback)
const configFile = resolveSetting(process.env.ATS_PLATFORM_CONFIG, 'config/platform.config.json')
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
const { createPlatformRouter } = require('./platform')
const router = createPlatformRouter({ initialConfig: config, seedDemo: process.env.ATS_PLATFORM_SEED_DEMO === 'true', dbPath: resolveSetting(process.env.ATS_PLATFORM_DB, 'server/data/platform.sqlite'), dataDir: resolveSetting(process.env.ATS_PLATFORM_DATA_DIR, 'server/data/documents'), schedulerEnabled: process.env.NODE_ENV !== 'test' && process.env.PLATFORM_REMINDERS !== 'false' })
app.locals.platformClose = () => router.close?.()
app.use('/api/platform', router)
app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'platform-local', company: config.company.slug }))
app.use('/api', (req, res) => res.status(404).json({ error: 'This API is not part of the local platform runtime.' }))
app.use((error, req, res, next) => { if (res.headersSent) return next(error); if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request exceeds the configured ' + maximumUploadMb + ' MB upload limit' }); return res.status(error?.message === 'Not allowed by CORS' ? 403 : 500).json({ error: error?.message === 'Not allowed by CORS' ? 'Origin is not allowed' : 'Request failed' }) })
module.exports = app
`
}

function platformServerEntry() {
  return `const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const app = require('./src/app')
const port = Number(process.env.PORT || 4000)
const server = app.listen(port, '127.0.0.1', () => console.log('ATS platform API listening at http://127.0.0.1:' + port))
let stopping = false
function stop() { if (stopping) return; stopping = true; server.close(() => { app.locals.platformClose?.(); process.exit(0) }) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
`
}

function runner() {
  return `import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, NODE_ENV: 'development', PLATFORM_MODE: 'true', VITE_PLATFORM_MODE: 'true', VITE_BUILDER_AVAILABLE: 'false', PORT: process.env.PORT || '4000', ATS_PLATFORM_CONFIG: process.env.ATS_PLATFORM_CONFIG || resolve('config/platform.config.json'), ATS_PLATFORM_DB: process.env.ATS_PLATFORM_DB || resolve('server/data/platform.sqlite'), ATS_PLATFORM_DATA_DIR: process.env.ATS_PLATFORM_DATA_DIR || resolve('server/data/documents'), ATS_PLATFORM_SEED_DEMO: process.env.ATS_PLATFORM_SEED_DEMO || 'false' }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [spawn(process.execPath, [resolve('server/server.js')], { cwd: root, env, stdio: 'inherit' }), spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' })]
let stopping = false
function stop(signal = 'SIGTERM') { if (stopping) return; stopping = true; for (const child of children) if (child.exitCode === null) child.kill(signal) }
for (const child of children) { child.on('error', error => { console.error(error); process.exitCode = 1; stop() }); child.on('exit', code => { if (!stopping) { process.exitCode = code ?? 1; stop() } }) }
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'))
console.log('Platform workspace: http://127.0.0.1:5173/platform')
`
}

function serverEnv(config) {
  return `PORT=4000\nNODE_ENV=development\nPLATFORM_MODE=true\nLOCAL_DEMO_MODE=true\nATS_PLATFORM_CONFIG=config/platform.config.json\nATS_PLATFORM_DB=server/data/platform.sqlite\nATS_PLATFORM_DATA_DIR=server/data/documents\nATS_PLATFORM_SEED_DEMO=false\nATS_MAX_UPLOAD_MB=${Number(config.documents?.maxFileSizeMb) || 20}\nCOMPANY_TIME_ZONE=${config.regional?.timezone || 'UTC'}\n`
}

async function copySource(destination) {
  const ignored = new Set(['node_modules', 'dist', '.env', '.vercel', 'data', 'package-lock.json'])
  const filter = source => !source.split(/[\\/]/).some(part => ignored.has(part))
  for (const entry of WORKSPACE_ENTRIES) if (await exists(join(root, entry))) await cp(join(root, entry), join(destination, entry), { recursive: true, filter })
  if (await exists(join(root, 'tests', 'platform.acceptance.test.cjs'))) {
    await mkdir(join(destination, 'tests'), { recursive: true })
    await cp(join(root, 'tests', 'platform.acceptance.test.cjs'), join(destination, 'tests', 'platform.acceptance.test.cjs'))
  }
  await mkdir(join(destination, 'shared'), { recursive: true })
  await cp(join(root, 'shared', 'ats-config.cjs'), join(destination, 'shared', 'ats-config.cjs'))
  await cp(join(root, 'shared', 'ats-config.test.cjs'), join(destination, 'shared', 'ats-config.test.cjs'))
  // The generated workspace is a platform instance; legacy API routes and config are excluded.
  await rm(join(destination, 'server', 'src', 'controllers'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'middleware'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'routes'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'services'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'utils'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'local'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'src', 'config'), { recursive: true, force: true })
  await rm(join(destination, 'server', 'scripts'), { recursive: true, force: true })
  for (const entry of ['components', 'config', 'constants', 'context', 'data', 'features', 'hooks', 'pages', 'services', 'styles', 'utils']) {
    await rm(join(destination, 'src', entry), { recursive: true, force: true })
  }
  await rm(join(destination, 'public'), { recursive: true, force: true })
  await mkdir(join(destination, 'public'), { recursive: true })
}

async function writeStandaloneWorkspace(config, workspaceDirectory) {
  await copySource(workspaceDirectory)
  const slug = config.company.slug
  await mkdir(join(workspaceDirectory, 'config'), { recursive: true })
  await mkdir(join(workspaceDirectory, 'scripts'), { recursive: true })
  await writeFile(join(workspaceDirectory, 'config', 'platform.config.json'), json(config))
  await writeFile(join(workspaceDirectory, '.env'), `VITE_PLATFORM_MODE=true\nVITE_BUILDER_AVAILABLE=false\n`)
  await writeFile(join(workspaceDirectory, '.env.example'), `VITE_PLATFORM_MODE=true\nVITE_BUILDER_AVAILABLE=false\n`)
  await writeFile(join(workspaceDirectory, 'server', '.env'), serverEnv(config))
  await writeFile(join(workspaceDirectory, 'server', '.env.example'), serverEnv(config))
  await writeFile(join(workspaceDirectory, 'server', 'src', 'app.js'), platformApp())
  await writeFile(join(workspaceDirectory, 'server', 'server.js'), platformServerEntry())
  await writeFile(join(workspaceDirectory, 'scripts', 'platform-dev.mjs'), runner())
  await writeFile(join(workspaceDirectory, 'src', 'App.jsx'), `import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'\nimport PlatformApp from './platform/PlatformApp'\n\nexport default function App() {\n  return <BrowserRouter><Routes><Route path="/" element={<Navigate to="/platform" replace />} /><Route path="/platform/*" element={<PlatformApp />} /><Route path="/careers-platform/*" element={<PlatformApp />} /><Route path="*" element={<Navigate to="/platform" replace />} /></Routes></BrowserRouter>\n}\n`)
  await writeFile(join(workspaceDirectory, 'src', 'main.jsx'), `import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App.jsx'\nimport './index.css'\n\ncreateRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)\n`)
  await writeFile(join(workspaceDirectory, 'src', 'index.css'), `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}html,body,#root{min-height:100%;margin:0}button,input,select,textarea{font:inherit}button{cursor:pointer}a{color:inherit}\n`)
  await writeFile(join(workspaceDirectory, 'index.html'), `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Configurable ATS platform workspace"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>ATS Platform Workspace</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`)
  await writeFile(join(workspaceDirectory, 'public', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2347C5"/><text x="32" y="41" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">ATS</text></svg>\n`)
  await writeFile(join(workspaceDirectory, 'server', 'package.json'), json({ ...SERVER_PACKAGE, name: `${slug}-platform-server` }))
  await rm(join(workspaceDirectory, 'server', 'package-lock.json'), { force: true })
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  rootPackage.name = `${slug}-ats-platform`
  rootPackage.private = true
  rootPackage.engines = { node: '>=22.5' }
  rootPackage.dependencies = Object.fromEntries(Object.entries(rootPackage.dependencies).filter(([name]) => !['@supabase/supabase-js', '@vercel/speed-insights', 'recharts'].includes(name)))
  rootPackage.scripts = { setup: 'npm ci && npm --prefix server ci', local: 'node scripts/platform-dev.mjs', dev: 'vite', build: 'vite build', test: 'node --test tests/platform.acceptance.test.cjs shared/ats-config.test.cjs server/src/platform/*.test.js', lint: 'eslint src/platform' }
  await writeFile(join(workspaceDirectory, 'package.json'), json(rootPackage))
  await writeFile(join(workspaceDirectory, '.gitignore'), 'node_modules\ndist\n.env\n.env.*\n!.env.example\nserver/node_modules\nserver/.env\nserver/.env.*\n!server/.env.example\nserver/data/*\n*.log\n')
  await execFileAsync(npmExecutable, ['install', '--package-lock-only', '--ignore-scripts', '--offline'], { cwd: workspaceDirectory })
  await execFileAsync(npmExecutable, ['install', '--package-lock-only', '--ignore-scripts', '--offline'], { cwd: join(workspaceDirectory, 'server') })
  await writeFile(join(workspaceDirectory, 'LOCAL_SETUP.md'), `# ${config.branding?.productName || config.company.name}\n\nA standalone local ATS platform workspace using its own schemaV2 configuration and SQLite database.\n\nPrerequisite: Node.js 22.5 or newer and npm.\n\n\`\`\`sh\nnpm run setup\nnpm run local\n\`\`\`\n\nOpen http://127.0.0.1:5173/platform. The API listens on http://127.0.0.1:4000/api/platform. The first launch seeds an independent database from \`config/platform.config.json\`.\n`)
}

export async function generateCompanyPackage(inputConfig) {
  const config = validateForGeneration(inputConfig)
  config.company.slug = safeCompanySlug(config.company.slug || config.company.name)
  const slug = config.company.slug
  const outputDirectory = join(root, 'generated', slug)
  const stagingDirectory = join(root, 'generated', `.${slug}-${process.pid}-${Date.now()}`)
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  const workspaceDirectory = join(stagingDirectory, 'workspace')
  await mkdir(workspaceDirectory, { recursive: true })
  await writeStandaloneWorkspace(config, workspaceDirectory)
  const existingData = join(outputDirectory, 'workspace', 'server', 'data')
  if (await exists(existingData)) {
    await cp(existingData, join(workspaceDirectory, 'server', 'data'), { recursive: true, force: true })
  }
  await mkdir(join(root, 'configs'), { recursive: true })
  await writeFile(join(root, 'configs', `${slug}.json`), json(config))
  const archiveFile = join(root, 'generated', `${slug}-ats-platform.tar.gz`)
  const stagedArchive = join(root, 'generated', `.${slug}-${process.pid}-${Date.now()}.tar.gz`)
  await execFileAsync('tar', ['-czf', stagedArchive, '-C', stagingDirectory, 'workspace'])
  let backupDirectory = null
  let previousArchive = null
  try {
    if (await exists(outputDirectory)) {
      const backupRoot = join(root, 'generated', '.backups')
      await mkdir(backupRoot, { recursive: true })
      backupDirectory = join(backupRoot, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      await rename(outputDirectory, backupDirectory)
      if (await exists(archiveFile)) {
        previousArchive = join(backupDirectory, 'previous-package.tar.gz')
        await rename(archiveFile, previousArchive)
      }
    }
    await rename(stagingDirectory, outputDirectory)
    await rename(stagedArchive, archiveFile)
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    if (previousArchive && await exists(previousArchive)) await rename(previousArchive, archiveFile)
    if (backupDirectory && await exists(backupDirectory)) await rename(backupDirectory, outputDirectory)
    await rm(stagedArchive, { force: true })
    throw error
  }
  return { slug, outputDirectory, workspaceDirectory: join(outputDirectory, 'workspace'), archiveFile, backupDirectory, configFile: join(root, 'configs', `${slug}.json`), activated: false }
}

export async function applyCompanyConfig(inputConfig) {
  const config = validateForGeneration(inputConfig)
  config.company.slug = safeCompanySlug(config.company.slug || config.company.name)
  const target = join(root, 'generated', config.company.slug, 'workspace', 'config', 'platform.config.json')
  if (!await exists(target)) throw new Error(`Generated instance "${config.company.slug}" does not exist; generate it first.`)
  await writeFile(target, json(config))
  await writeFile(join(root, 'configs', `${config.company.slug}.json`), json(config))
  const databaseFile = join(root, 'generated', config.company.slug, 'workspace', 'server', 'data', 'platform.sqlite')
  let databaseUpdated = false
  let version = null
  if (await exists(databaseFile)) {
    const db = openDatabase(databaseFile)
    try {
      const result = activateConfiguration(db, { config, actorId: 'builder', note: 'Applied by ATS Builder' })
      version = result.version
      databaseUpdated = true
    } finally { db.close() }
  }
  return { slug: config.company.slug, configFile: target, applied: true, databaseUpdated, version }
}

export async function applyFactoryConfig(inputConfig, { dbPath } = {}) {
  const config = validateForGeneration(inputConfig)
  config.company.slug = safeCompanySlug(config.company.slug || config.company.name)
  const databaseFile = resolve(dbPath || process.env.ATS_PLATFORM_DB || join(root, 'server', 'data', 'platform-local.sqlite'))
  const db = openDatabase(databaseFile)
  try {
    // A first-time factory should seed demo records that match the configuration
    // being applied. Existing databases keep all operational records untouched.
    seedCompany(db, 'local-company', config)
    const store = createStore(db, 'local-company')
    const audit = (event, kind, recordId, details = {}) => {
      const createdAt = now()
      db.prepare('INSERT INTO platform_audit(company_id,actor_id,action,kind,record_id,details,created_at) VALUES(?,?,?,?,?,?,?)')
        .run('local-company', 'builder', event, kind || null, recordId || null, JSON.stringify(details), createdAt)
      store.put('audit', { actorId: 'builder', action: event, kind: kind || null, recordId: recordId || null, details, createdAt }, 'builder')
    }
    const result = activateConfiguration(db, {
      config,
      actorId: 'builder',
      note: 'Applied to factory ATS by ATS Builder',
      audit,
    })
    return { slug: config.company.slug, applied: true, databaseUpdated: true, version: result.version, target: 'factory' }
  } finally {
    db.close()
  }
}

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : '' }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = argument('--config')
  if (!file) throw new Error('Usage: npm run generate -- --config configs/acme.json')
  const result = await generateCompanyPackage(JSON.parse(await readFile(resolve(file), 'utf8')))
  console.log(`Generated ${result.slug} at ${result.outputDirectory}`)
}
