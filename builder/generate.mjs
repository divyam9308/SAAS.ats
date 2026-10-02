import { access, cp, mkdir, readFile, rename, rm, writeFile, lstat, open, readdir } from 'node:fs/promises'
import { dirname, join, resolve, parse, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { safeCompanySlug } from '../config/config-core.js'
import { validateConfig } from '../shared/ats-config.cjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { openDatabase, createStore, seedCompany, now } = require('../server/src/platform/database.js')
const { activateConfiguration } = require('../server/src/platform/config-lifecycle.js')
const { acquirePlatformRuntimeLock } = require('../server/src/platform/runtime-lock.js')
const json = value => JSON.stringify(value, null, 2) + '\n'
const execFileAsync = promisify(execFile)
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const WORKSPACE_ENTRIES = ['eslint.config.js', 'index.html', 'public', 'server', 'src', 'vite.config.js']
const SERVER_PACKAGE = {
  name: 'generated-ats-platform-server', version: '1.0.0', private: true, main: 'server.js',
  engines: { node: '>=22.13' },
  scripts: { start: 'node server.js', dev: 'node server.js', test: 'node --test ../tests/platform.acceptance.test.cjs src/platform/workflows.test.js src/platform/local-scheduler.test.js' },
  dependencies: { cors: '^2.8.5', dotenv: '^16.4.1', express: '^4.18.2' }
}

async function exists(file) { try { await access(file); return true } catch { return false } }

async function assertNoSymlinkPath(target) {
  const absolute = resolve(target)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink in generator path: ${current}`) }
    catch (error) { if (error.code === 'ENOENT') break; throw error }
  }
}

async function assertTreeHasNoSymlinks(target) {
  await assertNoSymlinkPath(target)
  if (!await exists(target)) return
  const info = await lstat(target)
  if (info.isDirectory()) for (const entry of await readdir(target)) await assertTreeHasNoSymlinks(join(target, entry))
}

async function assertCopySourcesSafe(target) {
  await assertNoSymlinkPath(target)
  if (!await exists(target)) return
  const info = await lstat(target)
  if (info.isDirectory()) {
    for (const entry of await readdir(target)) {
      if (['node_modules', 'dist', '.env', '.vercel', 'data', 'package-lock.json'].includes(entry)) continue
      await assertCopySourcesSafe(join(target, entry))
    }
  }
}

async function acquireGenerationLock(slug) {
  const lockDir = join(root, 'generated', '.locks')
  await assertNoSymlinkPath(lockDir)
  await mkdir(lockDir, { recursive: true })
  const file = join(lockDir, `${slug}.lock`)
  let handle
  try { handle = await open(file, 'wx', 0o600) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Generation for "${slug}" is already in progress (lock: ${file})`)
    throw error
  }
  const token = randomUUID()
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`)
  return async () => {
    await handle.close()
    try { if (JSON.parse(await readFile(file, 'utf8')).token === token) await rm(file) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function assertSourceTreeSafe() {
  for (const entry of [...WORKSPACE_ENTRIES, 'shared/ats-config.cjs', 'shared/ats-config.test.cjs', 'tests/platform.acceptance.test.cjs', 'scripts/deployment-backup.mjs', 'docs/LOCAL_BACKUP_RESTORE.md']) {
    const path = join(root, entry)
    if (await exists(path)) await assertCopySourcesSafe(path)
  }
}

const BRANDING_ASSET_FIELDS = ['logo', 'horizontalLogo', 'emailLogo', 'careersLogo', 'documentLogo', 'favicon']
const LOCAL_BRANDING_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.woff'])

function localBrandingAssetPath(value, field) {
  if (typeof value !== 'string' || !value) return null
  if (/^https:\/\//i.test(value)) {
    let url
    try { url = new URL(value) } catch { throw new Error(`Invalid HTTPS branding asset in branding.${field}.`) }
    if (url.username || url.password) throw new Error(`Credentials are not allowed in branding.${field} asset URLs.`)
    return null
  }
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\u0000-\u0020]/.test(value)) {
    throw new Error(`Invalid local branding asset in branding.${field}; use an HTTPS URL or a path such as /assets/logo.svg.`)
  }
  let decoded
  try { decoded = decodeURIComponent(value) } catch { throw new Error(`Invalid local branding asset in branding.${field}; malformed URL encoding.`) }
  if (decoded.includes('%') || decoded.startsWith('//') || /[?#\\\u0000-\u0020]/.test(decoded)) throw new Error(`Invalid local branding asset in branding.${field}; query strings, fragments, residual encoding, and encoded separators are not allowed.`)
  const segments = decoded.slice(1).split('/')
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid local branding asset in branding.${field}; parent or empty path segments are not allowed.`)
  }
  const extension = segments.at(-1).slice(segments.at(-1).lastIndexOf('.')).toLowerCase()
  if (!LOCAL_BRANDING_EXTENSIONS.has(extension)) throw new Error(`Unsupported local branding asset type in branding.${field}; use PNG, JPG, WEBP, GIF, SVG, ICO, or WOFF.`)
  return segments
}

async function copyBrandingAssets(config, workspaceDirectory) {
  const sourcePublic = join(root, 'public')
  const copied = new Set()
  for (const field of BRANDING_ASSET_FIELDS) {
    const segments = localBrandingAssetPath(config.branding?.[field], field)
    if (!segments) continue
    const source = resolve(sourcePublic, ...segments)
    if (source !== sourcePublic && !source.startsWith(`${sourcePublic}${sep}`)) throw new Error(`Branding asset branding.${field} escapes the public assets directory.`)
    try {
      await assertNoSymlinkPath(source)
      if (!(await lstat(source)).isFile()) throw new Error('not a regular file')
    } catch (error) {
      throw new Error(`Local branding asset branding.${field} points to ${config.branding[field]}, but no regular file exists at public/${segments.join('/')}. Add the asset under public/ or configure an HTTPS URL.`, { cause: error })
    }
    const relative = segments.join('/')
    if (copied.has(relative)) continue
    copied.add(relative)
    const destination = join(workspaceDirectory, 'public', ...segments)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination)
  }
}

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
  await assertSourceTreeSafe()
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
  await mkdir(join(destination, 'scripts'), { recursive: true })
  await cp(join(root, 'scripts', 'deployment-backup.mjs'), join(destination, 'scripts', 'deployment-backup.mjs'))
  await cp(join(root, 'docs', 'LOCAL_BACKUP_RESTORE.md'), join(destination, 'LOCAL_BACKUP_RESTORE.md'))
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
  await copyBrandingAssets(config, workspaceDirectory)
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
  const faviconHref = String(config.branding?.favicon || '/favicon.svg').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  await writeFile(join(workspaceDirectory, 'index.html'), `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Configurable ATS platform workspace"><link rel="icon" href="${faviconHref}"><title>ATS Platform Workspace</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`)
  await writeFile(join(workspaceDirectory, 'public', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2347C5"/><text x="32" y="41" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">ATS</text></svg>\n`)
  await writeFile(join(workspaceDirectory, 'server', 'package.json'), json({ ...SERVER_PACKAGE, name: `${slug}-platform-server` }))
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  rootPackage.name = `${slug}-ats-platform`
  rootPackage.private = true
  rootPackage.engines = { node: '>=22.13' }
  rootPackage.dependencies = Object.fromEntries(Object.entries(rootPackage.dependencies).filter(([name]) => !['@supabase/supabase-js', '@vercel/speed-insights', 'recharts'].includes(name)))
  rootPackage.scripts = { setup: 'npm ci && npm --prefix server ci', local: 'node scripts/platform-dev.mjs', 'backup:create': 'node scripts/deployment-backup.mjs backup', 'backup:preview': 'node scripts/deployment-backup.mjs preview', 'backup:restore': 'node scripts/deployment-backup.mjs restore --replace', dev: 'vite', build: 'vite build', test: 'node --test tests/platform.acceptance.test.cjs shared/ats-config.test.cjs server/src/platform/*.test.js', lint: 'eslint src/platform' }
  await writeFile(join(workspaceDirectory, 'package.json'), json(rootPackage))
  // Reuse the repository's pinned dependency graph. Generation must not depend
  // on a registry metadata cache having been warmed on the developer's machine.
  for (const directory of ['', 'server']) {
    const sourceLock = JSON.parse(await readFile(join(root, directory, 'package-lock.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(workspaceDirectory, directory, 'package.json'), 'utf8'))
    sourceLock.name = manifest.name
    sourceLock.version = manifest.version
    sourceLock.packages[''] = { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies, ...(manifest.devDependencies ? { devDependencies: manifest.devDependencies } : {}), engines: manifest.engines }
    await writeFile(join(workspaceDirectory, directory, 'package-lock.json'), json(sourceLock))
  }
  await writeFile(join(workspaceDirectory, '.gitignore'), 'node_modules\ndist\n.env\n.env.*\n!.env.example\nserver/node_modules\nserver/.env\nserver/.env.*\n!server/.env.example\nserver/data/*\n*.log\n')
  await execFileAsync(npmExecutable, ['install', '--package-lock-only', '--ignore-scripts', '--offline'], { cwd: workspaceDirectory })
  await execFileAsync(npmExecutable, ['install', '--package-lock-only', '--ignore-scripts', '--offline'], { cwd: join(workspaceDirectory, 'server') })
  await writeFile(join(workspaceDirectory, 'LOCAL_SETUP.md'), `# ${config.branding?.productName || config.company.name}\n\nA standalone local ATS platform workspace using its own schemaV2 configuration and SQLite database.\n\nPrerequisite: Node.js 22.13 or newer and npm; Node.js 24 is recommended.\n\n\`\`\`sh\nnpm run setup\nnpm run local\n\`\`\`\n\nOpen http://127.0.0.1:5173/platform. The API listens on http://127.0.0.1:4000/api/platform. The first launch seeds an independent database from \`config/platform.config.json\`.\n\nFor offline backups and restore, see [LOCAL_BACKUP_RESTORE.md](LOCAL_BACKUP_RESTORE.md). Commands: \`npm run backup:create -- --destination ../backup\`, \`npm run backup:preview -- --bundle ../backup\`, and \`npm run backup:restore -- --bundle ../backup --confirm\`.\n`)
}

export async function generateCompanyPackage(inputConfig) {
  const config = validateForGeneration(inputConfig)
  config.company.slug = safeCompanySlug(config.company.slug || config.company.name)
  const slug = config.company.slug
  const outputDirectory = join(root, 'generated', slug)
  const outputDb = join(outputDirectory, 'workspace', 'server', 'data', 'platform.sqlite')
  const unlockGeneration = await acquireGenerationLock(slug)
  let unlockRuntime = null
  let runtimeDbLocation = outputDb
  const stagingDirectory = join(root, 'generated', `.${slug}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const archiveFile = join(root, 'generated', `${slug}-ats-platform.tar.gz`)
  const stagedArchive = `${stagingDirectory}.tar.gz`
  const configFile = join(root, 'configs', `${slug}.json`)
  const stagedConfig = `${stagingDirectory}.config.json`
  let backupDirectory = null
  let previousArchive = null
  let previousConfig = null
  let outputInstalled = false
  let archiveInstalled = false
  let configInstalled = false
  try {
    await assertNoSymlinkPath(outputDirectory)
    await assertNoSymlinkPath(archiveFile)
    await assertNoSymlinkPath(configFile)
    if (await exists(outputDb) || await exists(`${outputDb}.runtime-lock.json`)) unlockRuntime = acquirePlatformRuntimeLock(outputDb, { allowGenerationLock: true })
    await mkdir(stagingDirectory, { recursive: true })
    const workspaceDirectory = join(stagingDirectory, 'workspace')
    await mkdir(workspaceDirectory, { recursive: true })
    await writeStandaloneWorkspace(config, workspaceDirectory)
    const existingData = join(outputDirectory, 'workspace', 'server', 'data')
    if (await exists(existingData)) {
      await assertTreeHasNoSymlinks(existingData)
      await cp(existingData, join(workspaceDirectory, 'server', 'data'), { recursive: true, force: true, dereference: false, verbatimSymlinks: true, filter: source => source !== `${outputDb}.runtime-lock.json` })
    }
    await writeFile(stagedConfig, json(config))
    // The archive is code-only. Operational records and documentation stay in the workspace.
    await execFileAsync('tar', ['-czf', stagedArchive, '--exclude=workspace/server/data', '-C', stagingDirectory, 'workspace'])
    await mkdir(join(root, 'configs'), { recursive: true })
    if (await exists(outputDirectory)) {
      const backupRoot = join(root, 'generated', '.backups')
      await mkdir(backupRoot, { recursive: true })
      backupDirectory = join(backupRoot, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      await rename(outputDirectory, backupDirectory)
      runtimeDbLocation = join(backupDirectory, 'workspace', 'server', 'data', 'platform.sqlite')
      if (await exists(archiveFile)) {
        previousArchive = join(backupDirectory, 'previous-package.tar.gz')
        await rename(archiveFile, previousArchive)
      }
    }
    if (await exists(configFile)) {
      previousConfig = join(root, 'configs', `.${slug}-${process.pid}-${Date.now()}.previous.json`)
      await rename(configFile, previousConfig)
    }
    await rename(stagingDirectory, outputDirectory)
    outputInstalled = true
    await rename(stagedArchive, archiveFile)
    archiveInstalled = true
    await rename(stagedConfig, configFile)
    configInstalled = true
  } catch (error) {
    if (configInstalled) await rm(configFile, { force: true })
    if (previousConfig && await exists(previousConfig)) await rename(previousConfig, configFile)
    if (archiveInstalled) await rm(archiveFile, { force: true })
    if (previousArchive && await exists(previousArchive)) await rename(previousArchive, archiveFile)
    if (outputInstalled) await rm(outputDirectory, { recursive: true, force: true })
    if (backupDirectory && await exists(backupDirectory)) { await rename(backupDirectory, outputDirectory); runtimeDbLocation = outputDb }
    await rm(stagingDirectory, { recursive: true, force: true })
    await rm(stagedArchive, { force: true })
    await rm(stagedConfig, { force: true })
    throw error
  } finally {
    unlockRuntime?.(runtimeDbLocation)
    await unlockGeneration()
  }
  if (previousConfig) await rm(previousConfig, { force: true })
  return { slug, outputDirectory, workspaceDirectory: join(outputDirectory, 'workspace'), archiveFile, backupDirectory, configFile, activated: false }
}

export async function applyCompanyConfig(inputConfig) {
  const config = validateForGeneration(inputConfig)
  config.company.slug = safeCompanySlug(config.company.slug || config.company.name)
  const target = join(root, 'generated', config.company.slug, 'workspace', 'config', 'platform.config.json')
  if (!await exists(target)) throw new Error(`Generated instance "${config.company.slug}" does not exist; generate it first.`)
  const databaseFile = join(root, 'generated', config.company.slug, 'workspace', 'server', 'data', 'platform.sqlite')
  const lockRelease = await acquireGenerationLock(config.company.slug)
  let release
  const configFile = join(root, 'configs', `${config.company.slug}.json`)
  const stage = `${target}.${process.pid}.tmp`
  const configsStage = `${configFile}.${process.pid}.tmp`
  const targetPrevious = `${target}.${process.pid}.previous`
  const configPrevious = `${configFile}.${process.pid}.previous`
  let targetMoved = false
  let configMoved = false
  let targetInstalled = false
  let configInstalled = false
  let databaseUpdated = false
  let version = null
  try {
    release = acquirePlatformRuntimeLock(databaseFile, { allowGenerationLock: true })
    await assertNoSymlinkPath(target)
    await assertNoSymlinkPath(configFile)
    await writeFile(stage, json(config))
    await writeFile(configsStage, json(config))
    if (await exists(target)) { await rename(target, targetPrevious); targetMoved = true }
    if (await exists(configFile)) { await rename(configFile, configPrevious); configMoved = true }
    await rename(stage, target)
    targetInstalled = true
    await rename(configsStage, configFile)
    configInstalled = true
    if (await exists(databaseFile)) {
      const db = openDatabase(databaseFile)
      try {
        const result = activateConfiguration(db, { config, actorId: 'builder', note: 'Applied by ATS Builder' })
        version = result.version
        databaseUpdated = true
      } finally { db.close() }
    }
  } catch (error) {
    if (configInstalled) await rm(configFile, { force: true })
    if (configMoved && await exists(configPrevious)) await rename(configPrevious, configFile)
    if (targetInstalled) await rm(target, { force: true })
    if (targetMoved && await exists(targetPrevious)) await rename(targetPrevious, target)
    await rm(stage, { force: true })
    await rm(configsStage, { force: true })
    throw error
  } finally {
    release?.()
    await lockRelease()
  }
  await rm(targetPrevious, { force: true })
  await rm(configPrevious, { force: true })
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
