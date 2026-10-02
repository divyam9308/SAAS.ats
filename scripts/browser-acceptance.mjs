import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { verifyAgencyWorkflow } from './browser-agency-flows.mjs'
import { verifyCorporateWorkflow } from './browser-corporate-flows.mjs'
const require = createRequire(import.meta.url)
const { openDatabase, seedCompany, createStore } = require('../server/src/platform/database.js')

// The browser and servers share a process tree so isolated CI network
// namespaces can run the same real UI checks as a developer's workstation.
const { chromium } = await import(process.env.ATS_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.ATS_PLAYWRIGHT_MODULE, 'index.mjs')).href : 'playwright')
const directory = await mkdtemp(join(tmpdir(), 'ats-browser-'))
const root = process.cwd()
const children = []
const errors = []
const checks = []
const slug = `browser-acceptance-${randomUUID().slice(0, 8)}`
let browser
let currentPage
function start(script, env, args = []) {
  const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  child.stderr.on('data', chunk => { const line = String(chunk); if (!line.includes('ExperimentalWarning') && !line.includes('trace-warnings')) process.stderr.write(line) })
  return child
}
async function ready(url) {
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    if (children.some(child => child.exitCode !== null)) throw new Error('Acceptance server stopped before ready')
    try { if ((await fetch(url)).ok) return } catch { /* wait for binding */ }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Server did not start: ${url}`)
}
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`) }
async function api(route, data, method = 'GET', user = 'demo-admin') {
  const response = await fetch(`http://127.0.0.1:4000/api/platform${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user }, ...(data === undefined ? {} : { body: JSON.stringify({ data }) }) })
  const payload = await response.json()
  assert.ok(response.ok, `${route}: ${JSON.stringify(payload)}`)
  return payload.data ?? payload
}
try {
  const env = { NODE_ENV: 'development', PLATFORM_MODE: 'true', LOCAL_DEMO_MODE: 'true', VITE_PLATFORM_MODE: 'true', VITE_BUILDER_AVAILABLE: 'true', ATS_PLATFORM_DB: join(directory, 'ats.sqlite'), ATS_PLATFORM_DATA_DIR: join(directory, 'documents'), PORT: '4000', ATS_BUILDER_PORT: '4177' }
  start(resolve('server/server.js'), env)
  start(resolve('node_modules/vite/bin/vite.js'), env, ['--host', '127.0.0.1', '--strictPort'])
  start(resolve('builder/server.mjs'), env)
  await Promise.all([ready('http://127.0.0.1:4000/api/health'), ready('http://127.0.0.1:5173/platform'), ready('http://127.0.0.1:4177')])
  browser = await chromium.launch({ ...(process.env.ATS_BROWSER_EXECUTABLE ? { executablePath: process.env.ATS_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true })
  console.log(`Browser engine: Chromium ${browser.version()}; desktop 1440x960; mobile 390x844`)
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  currentPage = page
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`) })
  page.on('requestfailed', request => console.log(`REQUEST FAILED ${request.url()} ${request.failure()?.errorText}`))
  await check('Mock sign-in and dashboard', async () => { await page.goto('http://127.0.0.1:5173/platform'); await page.locator('.platform-user-button').waitFor(); assert.match(await page.locator('body').innerText(), /Local demo mode/); })
  await check('Builder live preview, generation and Apply', async () => {
    await page.goto('http://127.0.0.1:4177')
    await page.locator('[data-path="company.slug"]').fill(slug)
    await page.locator('[data-path="branding.productName"]').fill('Browser Acceptance ATS')
    await page.locator('#preview-frame').getByText('Browser Acceptance ATS', { exact: true }).waitFor()
    await page.locator('[data-step="5"]').click()
    await page.locator('#next').click()
    await page.locator('#result:not(.hidden)').waitFor({ timeout: 60_000 })
    assert.equal((await api('/bootstrap')).config.branding.productName, 'Browser Acceptance ATS')
    await page.goto('http://127.0.0.1:5173/platform')
    await page.locator('.platform-brand-copy strong').getByText('Browser Acceptance ATS').waitFor()
  })
  await check('Builder regeneration preserves customer records and local documents', async () => {
    const workspace = join(root, 'generated', slug, 'workspace')
    const config = JSON.parse(await readFile(join(workspace, 'config', 'platform.config.json'), 'utf8'))
    const dbPath = join(workspace, 'server', 'data', 'platform.sqlite')
    const documentPath = join(workspace, 'server', 'data', 'documents', `document_${randomUUID()}.txt`)
    const db = openDatabase(dbPath)
    try {
      seedCompany(db, 'local-company', config, { seedDemo: false })
      createStore(db, 'local-company').put('candidates', { id: 'preserved-browser-candidate', name: 'Synthetic preserved customer', email: 'preserved@example.test' }, 'demo-admin')
    } finally { db.close() }
    await mkdir(resolve(documentPath, '..'), { recursive: true })
    await writeFile(documentPath, 'Synthetic preserved customer attachment.')
    await page.goto('http://127.0.0.1:4177')
    await page.locator('[data-path="company.slug"]').fill(slug)
    await page.locator('[data-path="branding.productName"]').fill('Browser Acceptance ATS')
    await page.locator('[data-step="5"]').click()
    await page.locator('#next').click()
    await page.locator('#result:not(.hidden)').waitFor({ timeout: 60_000 })
    const restored = openDatabase(dbPath)
    try { assert.equal(createStore(restored, 'local-company').get('candidates', 'preserved-browser-candidate').name, 'Synthetic preserved customer') } finally { restored.close() }
    assert.equal(await readFile(documentPath, 'utf8'), 'Synthetic preserved customer attachment.')
    const archiveEntries = execFileSync('tar', ['-tzf', join(root, 'generated', `${slug}-ats-platform.tar.gz`)], { encoding: 'utf8' })
    assert.doesNotMatch(archiveEntries, /workspace\/server\/data(?:\/|\n)/)
    await page.goto('http://127.0.0.1:5173/platform')
    await page.locator('.platform-brand-copy strong').getByText('Browser Acceptance ATS').waitFor()
  })
  await check('Settings unsaved navigation cancellation and saved draft reload', async () => {
    await page.locator('.platform-nav-link').filter({ hasText: /^Settings$/ }).click()
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Branding$/ }).click()
    await page.getByLabel('ATS display name', { exact: false }).fill('Reviewed ATS')
    page.once('dialog', dialog => dialog.dismiss())
    await page.locator('.platform-nav-link').filter({ hasText: /^Overview$/ }).click()
    assert.ok(page.url().endsWith('/settings'))
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Draft saved', { exact: false }).waitFor()
    await page.reload()
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Branding$/ }).click()
    assert.equal(await page.getByLabel('ATS display name', { exact: false }).inputValue(), 'Reviewed ATS')
  })
  await check('Readable activation diff and confirmation', async () => {
    await page.getByRole('button', { name: 'Review & activate' }).click()
    await page.getByRole('dialog').waitFor()
    assert.match(await page.locator('.ats-review-diff').innerText(), /Browser Acceptance ATS[\s\S]*Reviewed ATS/)
    assert.equal(await page.getByRole('button', { name: 'Activate configuration', exact: true }).isDisabled(), true)
    await page.getByLabel('I reviewed this company configuration').check()
    await page.getByRole('button', { name: 'Activate configuration', exact: true }).click()
    await page.locator('.platform-brand-copy strong').getByText('Reviewed ATS').waitFor()
  })
  await check('Version history rollback confirmation', async () => {
    await page.getByRole('button', { name: 'Version history' }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.locator('.ats-history-entry').filter({ hasText: 'Version 2' }).getByRole('button', { name: 'Restore', exact: true }).click()
    await page.locator('.platform-brand-copy strong').getByText('Browser Acceptance ATS').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
  await check('Careers configured form and public job detail', async () => { await page.goto('http://127.0.0.1:5173/careers-platform'); await page.locator('.platform-career-job').first().click(); await page.locator('.platform-career-application').waitFor(); })
  await check('Public application with resume and consent persists without bytes in answers', async () => {
    await page.getByLabel('Full name', { exact: false }).fill('Browser Test Applicant')
    await page.getByLabel('Email', { exact: false }).fill('browser-applicant@example.test')
    await page.getByLabel('Resume', { exact: false }).setInputFiles({ name: 'browser-resume.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic resume for local browser acceptance.') })
    await page.getByLabel('I agree to the privacy notice').check()
    await page.getByRole('button', { name: 'Submit application' }).click()
    await page.getByText('Application received', { exact: true }).waitFor()
    const candidates = await api('/records/candidates')
    const candidate = candidates.find(row => row.email === 'browser-applicant@example.test')
    assert.ok(candidate)
    const applications = await api('/records/applications')
    assert.ok(applications.some(row => row.candidateId === candidate.id))
    assert.doesNotMatch(JSON.stringify(applications), /contentBase64/)
    await page.goto('http://127.0.0.1:5173/platform/candidates')
    await page.getByText('Browser Test Applicant', { exact: true }).click()
    await page.getByRole('button', { name: 'Download browser-resume.txt', exact: true }).waitFor()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download browser-resume.txt', exact: true }).click()
    const download = await downloadPromise
    assert.equal((await readFile(await download.path())).toString(), 'Synthetic resume for local browser acceptance.')
  })
  await check('Candidate document upload and download', async () => {
    const form = page.locator('.platform-document-upload')
    await form.locator('input[type=file]').setInputFiles({ name: 'browser-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic private attachment.') })
    await form.getByRole('button', { name: 'Upload document' }).click()
    await page.getByRole('button', { name: 'Download browser-note.txt', exact: true }).waitFor()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download browser-note.txt', exact: true }).click()
    assert.equal((await readFile(await (await downloadPromise).path())).toString(), 'Synthetic private attachment.')
    const replacement = page.locator('.platform-document-card').filter({ hasText: 'browser-note.txt' }).locator('.platform-document-replace')
    await replacement.locator('input[type=file]').setInputFiles({ name: 'browser-note-v2.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic attachment version two.') })
    await replacement.getByRole('button', { name: 'Upload replacement' }).click()
    await page.getByRole('button', { name: 'Download browser-note-v2.txt', exact: true }).waitFor()
    assert.match(await page.locator('.platform-document-card').filter({ hasText: 'browser-note-v2.txt' }).innerText(), /v2/)
  })
  await page.getByRole('button', { name: 'Close details', exact: true }).click()
  await verifyCorporateWorkflow({ page, api, check })
  await check('Reports, tasks, notifications and audit navigation', async () => {
    await page.goto('http://127.0.0.1:5173/platform')
    for (const name of ['Reports', 'Tasks', 'Notifications', 'Audit log']) {
      await page.locator('.platform-nav-link').filter({ hasText: new RegExp(`^${name}$`) }).click()
      await page.locator('.platform-breadcrumb strong').getByText(name, { exact: true }).waitFor()
      assert.doesNotMatch(await page.locator('.platform-content').innerText(), /couldn’t|could not|not available/i)
    }
    assert.ok((await api('/records/audit')).some(row => row.action === 'configuration.rolled-back'))
  })
  await check('Mock interviewer permissions and service-layer denial', async () => {
    await page.locator('.platform-user-button').click()
    await page.locator('.platform-user-menu button').filter({ hasText: 'Casey Patel' }).click()
    await page.locator('.platform-user-copy strong').getByText('Casey Patel').waitFor()
    assert.equal(await page.locator('.platform-nav-link').filter({ hasText: /^Settings$/ }).count(), 0)
    assert.equal(await page.locator('.platform-nav-link').filter({ hasText: /^Jobs$/ }).count(), 0)
    const denied = await page.request.get('http://127.0.0.1:4000/api/platform/config/draft', { headers: { 'X-Demo-User': 'demo-interviewer' } })
    assert.equal(denied.status(), 403)
    const exports = await page.request.get('http://127.0.0.1:4000/api/platform/export/candidates', { headers: { 'X-Demo-User': 'demo-interviewer' } })
    assert.equal(exports.status(), 403)
  })
  await check('Restricted route reload remains usable', async () => {
    await page.reload()
    await page.locator('.platform-user-copy strong').getByText('Casey Patel').waitFor()
    await page.locator('.platform-breadcrumb strong').getByText('Applications', { exact: true }).waitFor()
    await page.locator('.platform-user-button').click()
    await page.locator('.platform-user-menu button').filter({ hasText: 'Alex Morgan' }).click()
    await page.locator('.platform-user-copy strong').getByText('Alex Morgan').waitFor()
  })
  await check('Preset cancellation, dependency confirmation, terminology and careers copy activation', async () => {
    await page.goto('http://127.0.0.1:5173/platform/settings')
    await page.getByLabel('Starting preset').waitFor()
    page.once('dialog', dialog => dialog.dismiss())
    await page.getByLabel('Starting preset').selectOption('agency')
    assert.equal((await api('/config/draft')).mode, 'corporate')
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Terminology$/ }).click()
    await page.getByLabel('Jobs', { exact: true }).fill('Positions')
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Modules$/ }).click()
    const offers = page.locator('.ats-settings-module').filter({ has: page.getByText('Offers', { exact: true }) }).locator('input')
    page.once('dialog', dialog => dialog.dismiss())
    await offers.click()
    assert.equal(await offers.isChecked(), true)
    page.once('dialog', dialog => dialog.accept())
    await offers.click()
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Branding$/ }).click()
    await page.getByLabel('Careers Logo', { exact: true }).fill('/favicon.png')
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Careers site$/ }).click()
    await page.getByLabel('Headline', { exact: true }).fill('Build a team with us')
    await page.getByLabel('Submit', { exact: true }).fill('Send your application')
    await page.getByRole('button', { name: 'Review & activate' }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByLabel('I reviewed this company configuration').check()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Activate configuration', exact: true }).click()
    await page.locator('.platform-nav-link').filter({ hasText: /^Positions$/ }).waitFor()
    assert.equal(await page.locator('.platform-nav-link').filter({ hasText: /^Offers$/ }).count(), 0)
    await page.goto('http://127.0.0.1:5173/careers-platform')
    await page.getByRole('heading', { name: 'Build a team with us' }).waitFor()
    assert.equal(await page.locator('.platform-career-brand img').getAttribute('src'), '/favicon.png')
    await page.locator('.platform-career-job').first().click()
    await page.getByRole('button', { name: 'Send your application' }).waitFor()
  })
  await check('Agency preset changes navigation and permits client creation', async () => {
    await page.goto('http://127.0.0.1:5173/platform/settings')
    await page.getByLabel('Starting preset').waitFor()
    page.once('dialog', dialog => dialog.accept())
    await page.getByLabel('Starting preset').selectOption('agency')
    await page.getByRole('button', { name: 'Review & activate' }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByLabel('I reviewed this company configuration').check()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Activate configuration', exact: true }).click()
    await page.locator('.platform-nav-link').filter({ hasText: /^Mandates$/ }).waitFor()
    await page.locator('.platform-nav-link').filter({ hasText: /^Clients$/ }).click()
    await page.getByRole('button', { name: 'Add client', exact: true }).first().click()
    await page.getByRole('dialog').getByLabel('Name', { exact: false }).fill('Browser Acceptance Client')
    await page.getByRole('button', { name: 'Create client', exact: true }).click()
    await page.getByText('Browser Acceptance Client', { exact: true }).waitFor()
    assert.ok((await api('/records/clients')).some(client => client.name === 'Browser Acceptance Client'))
    for (const name of ['Contacts', 'Candidate submissions', 'Placements', 'Invoices']) {
      await page.locator('.platform-nav-link').filter({ hasText: new RegExp(`^${name}$`) }).click()
      await page.locator('.platform-breadcrumb strong').getByText(name, { exact: true }).waitFor()
      assert.doesNotMatch(await page.locator('.platform-content').innerText(), /page could not|Missing permission|not available/i)
    }
  })
  await verifyAgencyWorkflow({ page, api, check })
  await check('Mobile workspace menu and careers layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    await page.locator('.platform-sidebar.is-open').waitFor()
    await page.getByRole('button', { name: 'Close menu', exact: true }).click()
    await page.goto('http://127.0.0.1:5173/careers-platform')
    await page.locator('.platform-career-job').first().waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  })
  assert.deepEqual(errors, [], 'Browser runtime/console errors')
  console.log(`Browser acceptance: ${checks.length} checks passed`)
} catch (error) {
  console.error(`BROWSER FAILURE ${error.message}`)
  if (currentPage) { console.error((await currentPage.locator('body').innerText()).slice(0,6500)); await currentPage.screenshot({ path: '/tmp/ats-browser-failure.png', fullPage: true }) }
  throw error
} finally {
  await browser?.close()
  await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM') })))
  await rm(directory, { recursive: true, force: true })
  // Remove only this run's uniquely named generated artifacts.
  for (const file of [join(root, 'generated', slug), join(root, 'generated', `${slug}-ats-platform.tar.gz`), join(root, 'configs', `${slug}.json`)]) await rm(file, { recursive: true, force: true })
  const backups = join(root, 'generated', '.backups')
  for (const name of await readdir(backups).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
    if (name.startsWith(`${slug}-`)) await rm(join(backups, name), { recursive: true, force: true })
  }
}
