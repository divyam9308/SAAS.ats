'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const { join, resolve } = require('node:path')
const { defaults } = require('../shared/ats-config.cjs')
const { acquirePlatformRuntimeLock } = require('../server/src/platform/runtime-lock.js')

const generated = resolve(__dirname, '..', 'generated')
const configs = resolve(__dirname, '..', 'configs')
const parse = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const makeConfig = () => {
  const config = defaults('startup')
  config.company.name = 'Generation Safety'
  config.company.slug = `generation-safety-${process.pid}`
  return config
}

test('generation refuses a live runtime database before touching its workspace', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const config = makeConfig()
  const output = join(generated, config.company.slug)
  const archive = join(generated, `${config.company.slug}-ats-platform.tar.gz`)
  const configFile = join(configs, `${config.company.slug}.json`)
  t.after(() => { for (const path of [output, archive, configFile]) fs.rmSync(path, { recursive: true, force: true }) })
  const first = await generateCompanyPackage(config)
  const sentinel = join(first.workspaceDirectory, 'sentinel.txt')
  fs.writeFileSync(sentinel, 'preserve')
  const dbPath = join(first.workspaceDirectory, 'server', 'data', 'platform.sqlite')
  fs.mkdirSync(join(dbPath, '..'), { recursive: true })
  const release = acquirePlatformRuntimeLock(dbPath)
  try {
    await assert.rejects(generateCompanyPackage(config), /runtime appears active|owns this database/i)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve')
    assert.equal(fs.existsSync(first.archiveFile), true)
  } finally { release() }
})

test('invalid configuration and unsafe source data leave the previous generated output intact', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const config = makeConfig()
  const result = await generateCompanyPackage(config)
  t.after(() => { for (const path of [result.outputDirectory, result.archiveFile, result.configFile]) fs.rmSync(path, { recursive: true, force: true }); if (result.backupDirectory) fs.rmSync(result.backupDirectory, { recursive: true, force: true }) })
  const sentinel = join(result.workspaceDirectory, 'sentinel.txt')
  fs.writeFileSync(sentinel, 'old workspace')
  const oldArchive = fs.readFileSync(result.archiveFile)
  const oldConfig = fs.readFileSync(result.configFile)
  const invalid = structuredClone(config)
  invalid.company.name = ''
  await assert.rejects(generateCompanyPackage(invalid), /Invalid schemaV2/)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace')
  assert.deepEqual(fs.readFileSync(result.archiveFile), oldArchive)
  assert.deepEqual(fs.readFileSync(result.configFile), oldConfig)
  const unsafe = structuredClone(config)
  unsafe.branding.logo = '/../package.json'
  await assert.rejects(generateCompanyPackage(unsafe), /Invalid local branding asset in branding\.logo/)
  assert.deepEqual(fs.readFileSync(result.archiveFile), oldArchive)
  assert.deepEqual(fs.readFileSync(result.configFile), oldConfig)
  const missing = structuredClone(config)
  missing.branding.logo = '/assets/no-such-company-logo.svg'
  await assert.rejects(generateCompanyPackage(missing), /Local branding asset branding\.logo.*Add the asset under public\//)
  assert.deepEqual(fs.readFileSync(result.archiveFile), oldArchive)
  assert.deepEqual(fs.readFileSync(result.configFile), oldConfig)
  const data = join(result.workspaceDirectory, 'server', 'data')
  fs.mkdirSync(data, { recursive: true })
  const external = fs.mkdtempSync(join(os.tmpdir(), 'ats-gen-link-'))
  t.after(() => fs.rmSync(external, { recursive: true, force: true }))
  fs.symlinkSync(external, join(data, 'external-link'))
  await assert.rejects(generateCompanyPackage(config), /symlink/i)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'old workspace')
  assert.deepEqual(fs.readFileSync(result.archiveFile), oldArchive)
  assert.deepEqual(fs.readFileSync(result.configFile), oldConfig)
})

test('generated code archive omits operational databases and includes backup documentation and tools', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const config = makeConfig()
  const result = await generateCompanyPackage(config)
  t.after(() => { for (const path of [result.outputDirectory, result.archiveFile, result.configFile]) fs.rmSync(path, { recursive: true, force: true }); if (result.backupDirectory) fs.rmSync(result.backupDirectory, { recursive: true, force: true }) })
  const stdout = require('node:child_process').execFileSync('tar', ['-tzf', result.archiveFile], { encoding: 'utf8' })
  assert.doesNotMatch(stdout, /server\/data|platform\.sqlite/)
  assert.match(stdout, /LOCAL_BACKUP_RESTORE\.md/)
  const pkg = parse(join(result.workspaceDirectory, 'package.json'))
  assert.equal(pkg.scripts['backup:create'], 'node scripts/deployment-backup.mjs backup')
  assert.equal(pkg.scripts['backup:preview'], 'node scripts/deployment-backup.mjs preview')
  assert.equal(pkg.scripts['backup:restore'], 'node scripts/deployment-backup.mjs restore --replace')
  assert.match(fs.readFileSync(join(result.workspaceDirectory, 'LOCAL_SETUP.md'), 'utf8'), /LOCAL_BACKUP_RESTORE\.md/)
  assert.equal(fs.existsSync(join(result.workspaceDirectory, 'scripts', 'deployment-backup.mjs')), true)
})

test('generated workspace copies referenced local branding assets from public', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const config = makeConfig()
  config.branding.logo = '/assets/fyndbridge-official-logo.svg'
  config.branding.favicon = '/assets/fyndbridge-official-logo.png'
  const result = await generateCompanyPackage(config)
  t.after(() => { for (const path of [result.outputDirectory, result.archiveFile, result.configFile]) fs.rmSync(path, { recursive: true, force: true }); if (result.backupDirectory) fs.rmSync(result.backupDirectory, { recursive: true, force: true }) })
  assert.equal(fs.readFileSync(join(result.workspaceDirectory, 'public', 'assets', 'fyndbridge-official-logo.svg'), 'utf8').startsWith('<svg'), true)
  assert.deepEqual(fs.readFileSync(join(result.workspaceDirectory, 'public', 'assets', 'fyndbridge-official-logo.png')), fs.readFileSync(resolve(__dirname, '..', 'public', 'assets', 'fyndbridge-official-logo.png')))
  assert.match(fs.readFileSync(join(result.workspaceDirectory, 'index.html'), 'utf8'), /href="\/assets\/fyndbridge-official-logo\.png"/)
})

test('SQLite-backed regeneration relocates and releases the runtime lock safely', async t => {
  const { generateCompanyPackage, applyCompanyConfig } = await import('./generate.mjs')
  const { openDatabase } = require('../server/src/platform/database.js')
  const config = makeConfig()
  const first = await generateCompanyPackage(config)
  t.after(() => {
    for (const path of [first.outputDirectory, first.archiveFile, first.configFile]) fs.rmSync(path, { recursive: true, force: true })
    if (first.backupDirectory) fs.rmSync(first.backupDirectory, { recursive: true, force: true })
  })
  const databaseFile = join(first.workspaceDirectory, 'server', 'data', 'platform.sqlite')
  fs.mkdirSync(join(databaseFile, '..'), { recursive: true })
  openDatabase(databaseFile).close()
  const liveRelease = acquirePlatformRuntimeLock(databaseFile)
  const configBefore = fs.readFileSync(first.configFile)
  const instanceConfigBefore = fs.readFileSync(join(first.workspaceDirectory, 'config', 'platform.config.json'))
  const updated = structuredClone(config)
  updated.company.name = 'Attempted Live Apply'
  try {
    await assert.rejects(applyCompanyConfig(updated), /owns this database/)
    assert.deepEqual(fs.readFileSync(first.configFile), configBefore)
    assert.deepEqual(fs.readFileSync(join(first.workspaceDirectory, 'config', 'platform.config.json')), instanceConfigBefore)
  } finally { liveRelease() }
  const regenerated = await generateCompanyPackage(config)
  assert.ok(regenerated.backupDirectory)
  const currentDb = join(regenerated.workspaceDirectory, 'server', 'data', 'platform.sqlite')
  assert.equal(fs.existsSync(`${currentDb}.runtime-lock.json`), false)
  const preservedDb = join(regenerated.backupDirectory, 'workspace', 'server', 'data', 'platform.sqlite')
  assert.equal(fs.existsSync(`${preservedDb}.runtime-lock.json`), false)
  const { createPlatformRouter } = require('../server/src/platform')
  const router = createPlatformRouter({ dbPath: currentDb, dataDir: join(regenerated.workspaceDirectory, 'server', 'data', 'documents') })
  router.close()
})

test('generated workspace locks retain the repository pinned dependency versions', async t => {
  const { generateCompanyPackage } = await import('./generate.mjs')
  const result = await generateCompanyPackage(makeConfig())
  t.after(() => { for (const path of [result.outputDirectory, result.archiveFile, result.configFile]) fs.rmSync(path, { recursive: true, force: true }); if (result.backupDirectory) fs.rmSync(result.backupDirectory, { recursive: true, force: true }) })
  for (const directory of ['', 'server']) {
    const source = parse(join(resolve(__dirname, '..', directory), 'package-lock.json'))
    const output = parse(join(result.workspaceDirectory, directory, 'package-lock.json'))
    for (const [name, item] of Object.entries(source.packages)) if (name && output.packages[name]) assert.equal(output.packages[name].version, item.version, `${directory}/${name}`)
  }
})
