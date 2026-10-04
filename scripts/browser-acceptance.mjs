import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { verifyAgencyWorkflow } from './browser-agency-flows.mjs'
import { verifyCorporateWorkflow } from './browser-corporate-flows.mjs'
import AxeBuilder from '@axe-core/playwright'
const require = createRequire(import.meta.url)
const { openDatabase, seedCompany, createStore } = require('../server/src/platform/database.js')

// Firefox on macOS cannot create its temporary profile through the /var ->
// /private/var system alias. Canonicalizing TMPDIR keeps every engine on the
// same real path without weakening the application's symlink protections.
process.env.TMPDIR = realpathSync(tmpdir())

// The browser and servers share a process tree so isolated CI network
// namespaces can run the same real UI checks as a developer's workstation.
const playwright = await import(process.env.ATS_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.ATS_PLAYWRIGHT_MODULE, 'index.mjs')).href : 'playwright')
const browserName = String(process.env.ATS_BROWSER || 'chromium').toLowerCase()
// macOS WebKit's default Tab traversal includes text controls; Option+Tab
// traverses all native interactive controls without changing system preferences.
const forwardTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
const backwardTab = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab'
const browserType = playwright[browserName]
if (!browserType || !['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error(`Unsupported ATS_BROWSER "${browserName}".`)
const root = process.cwd()
await mkdir(join(root, 'generated'), { recursive: true })
const directory = await mkdtemp(join(root, 'generated', '.browser-acceptance-'))
const artifactDirectory = join(root, '.browser', 'product-audit-20261004', browserName)
await mkdir(artifactDirectory, { recursive: true })
const children = []
const errors = []
const checks = []
const slug = `browser-acceptance-${randomUUID().slice(0, 8)}`
let browser
let context
let currentPage
let firefoxCustomIni
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
async function firefoxExecutableForMac(executable) {
  if (process.platform !== 'darwin') return executable
  const originalIni = resolve(executable, '..', '..', 'Resources', 'application.ini')
  const customIni = resolve(originalIni, '..', 'browser', `playwright-ats-${process.pid}.ini`)
  const wrapper = join(directory, 'playwright-firefox-launcher')
  const application = (await readFile(originalIni, 'utf8'))
    .replace(/^Name=.*$/m, 'Name=PlaywrightFirefoxATS')
    .replace(/^Vendor=.*$/m, 'Vendor=PlaywrightAutomation')
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
  await writeFile(customIni, application)
  firefoxCustomIni = customIni
  await writeFile(wrapper, `#!/bin/sh\nexec ${quote(executable)} -app ${quote(customIni)} "$@"\n`)
  await chmod(wrapper, 0o755)
  return wrapper
}
async function checkAccessibility(page, label) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const blockers = result.violations.filter(violation => ['critical', 'serious'].includes(violation.impact))
  assert.deepEqual(blockers.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, targets: violation.nodes.slice(0, 30).map(node => node.target.join(' ')) })), [], `${label} accessibility blockers`)
  assert.equal(Boolean(await page.locator('html').getAttribute('lang')), true, `${label} declares a document language`)
}
async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))
  assert.ok(dimensions.scrollWidth <= dimensions.innerWidth + 1, `${label} horizontal overflow: ${dimensions.scrollWidth}px > ${dimensions.innerWidth}px`)
}
async function captureViewport(page, label) {
  const file = join(artifactDirectory, `${label}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`ARTIFACT ${file}`)
}
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
  const requestedExecutable = process.env.ATS_BROWSER_EXECUTABLE || browserType.executablePath()
  const executablePath = browserName === 'firefox' ? await firefoxExecutableForMac(requestedExecutable) : requestedExecutable
  const launchOptions = { executablePath, ...(browserName === 'chromium' ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}), headless: true }
  browser = await browserType.launch(launchOptions)
  context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  console.log(`Browser engine: ${browserName} ${browser.version()}; viewports 1440x960, 1280x900, 768x1024, 390x844`)
  const page = await context.newPage()
  currentPage = page
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`) })
  page.on('requestfailed', request => console.log(`REQUEST FAILED ${request.url()} ${request.failure()?.errorText}`))
  await check('Mock sign-in and dashboard', async () => { await page.goto('http://127.0.0.1:5173/platform'); await page.locator('.platform-user-button').waitFor(); assert.match(await page.locator('body').innerText(), /Local demo mode/); })
  await check('Dashboard screen-reader semantics and WCAG blockers', async () => { await checkAccessibility(page, 'Dashboard') })
  await check('Builder live preview, generation and Apply', async () => {
    await page.goto('http://127.0.0.1:4177')
    await checkAccessibility(page, 'Builder')
    await page.locator('body').press(forwardTab)
    for (let index = 0; index < 40 && !(await page.locator('#next').evaluate(element => element === document.activeElement)); index += 1) await page.keyboard.press(forwardTab)
    assert.equal(await page.locator('#next').evaluate(element => element === document.activeElement), true, 'Builder primary action must be keyboard reachable')
    const previewPages = await page.locator('#preview-page option').evaluateAll(options => options.map(option => option.value).filter(value => value !== 'auto'))
    for (const previewPage of previewPages) {
      await page.locator('#preview-page').selectOption(previewPage)
      assert.equal(await page.locator('#preview-frame').getAttribute('data-page'), previewPage, `${previewPage} preview did not render`)
      assert.ok((await page.locator('#preview-frame').innerText()).trim().length > 20, `${previewPage} preview was empty`)
    }
    await page.locator('#preview-page').selectOption('auto')
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
  await check('Settings pipeline stage rename saves through buyer controls and preserves stage graph', async () => {
    const before = await api('/config/draft')
    const pipelineBefore = before.pipelines.find(item => item.default) || before.pipelines[0]
    const stageBefore = pipelineBefore.stages[0]
    const renamed = `${stageBefore.name} Reviewed`
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Pipelines$/ }).click()
    await checkAccessibility(page, 'Settings pipeline editor')
    await page.getByLabel('Stage name', { exact: true }).first().fill(renamed)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Draft saved', { exact: false }).waitFor()
    await page.reload()
    await page.locator('.ats-settings-nav-item').filter({ hasText: /^Pipelines$/ }).click()
    assert.equal(await page.getByLabel('Stage name', { exact: true }).first().inputValue(), renamed)
    const after = await api('/config/draft')
    const pipelineAfter = after.pipelines.find(item => item.id === pipelineBefore.id)
    assert.ok(pipelineAfter)
    assert.equal(pipelineAfter.stages[0].name, renamed)
    assert.deepEqual(pipelineAfter.stages.map(stage => stage.id), pipelineBefore.stages.map(stage => stage.id))
    assert.deepEqual(pipelineAfter.transitions, pipelineBefore.transitions)
    await page.getByLabel('Stage name', { exact: true }).first().fill(stageBefore.name)
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Draft saved', { exact: false }).waitFor()
    await page.reload()
    const restored = await api('/config/draft')
    const pipelineRestored = restored.pipelines.find(item => item.id === pipelineBefore.id)
    assert.equal(pipelineRestored.stages[0].name, stageBefore.name)
    assert.deepEqual(pipelineRestored.stages.map(stage => stage.id), pipelineBefore.stages.map(stage => stage.id))
    assert.deepEqual(pipelineRestored.transitions, pipelineBefore.transitions)
  })
  await check('Buyer form, approval and scorecard editors have accessible controls', async () => {
    for (const label of ['Application forms', 'Approvals', 'Scorecards & plans']) {
      await page.locator('.ats-settings-nav-item').filter({ hasText: label }).click()
      await page.locator('.ats-domain-editor').waitFor()
      await checkAccessibility(page, `Settings ${label}`)
    }
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
  await check('Careers form screen-reader semantics and WCAG blockers', async () => { await checkAccessibility(page, 'Careers application') })
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
  await check('All presets enforce their configured module navigation', async () => {
    const moduleLabels = { requisitions: 'Hiring requests', offers: 'Offers', onboarding: 'Onboarding', referrals: 'Referrals', talentCrm: 'Talent pools', workforcePlanning: 'Workforce plan', automation: 'Automations', agency: 'Clients', invoices: 'Invoices' }
    for (const presetName of ['corporate', 'agency', 'startup', 'campus', 'basic']) {
      const presetResponse = await page.request.get(`http://127.0.0.1:4177/api/presets/${presetName}`)
      assert.equal(presetResponse.ok(), true)
      const preset = await presetResponse.json()
      const applyResponse = await page.request.post('http://127.0.0.1:4177/api/apply', { data: { config: preset } })
      assert.equal(applyResponse.ok(), true, await applyResponse.text())
      await page.goto('http://127.0.0.1:5173/platform')
      await page.locator('.platform-user-button').waitFor()
      for (const [module, label] of Object.entries(moduleLabels)) {
        const count = await page.locator('.platform-nav-link').filter({ hasText: new RegExp(`^${label}$`) }).count()
        assert.equal(count > 0, Boolean(preset.modules[module]), `${presetName}: ${label} navigation mismatch`)
      }
    }
  })
  await check('Responsive Builder, ATS, dialog and Careers layouts at four viewports', async () => {
    const viewports = [
      { width: 1440, height: 960 },
      { width: 1280, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]
    const duplicates = await api('/records/candidates')
    assert.ok(duplicates.length >= 1, 'Seeded candidate records are needed for responsive detail checks')
    const duplicateSource = duplicates[0]
    const createdDuplicate = await api('/records/candidates', { name: duplicateSource.name, email: duplicateSource.email }, 'POST')
    assert.ok(createdDuplicate.id, 'Create a temporary duplicate to open the nested merge action dialog')

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      const label = `${viewport.width}x${viewport.height}`
      await page.goto('http://127.0.0.1:4177')
      await page.locator('#next').waitFor()
      assert.equal(await page.locator('#next').isVisible(), true, `${label}: Builder primary action should be usable`)
      await assertNoHorizontalOverflow(page, `${label} Builder`)
      await captureViewport(page, `viewport-${label}-builder`)

      await page.goto('http://127.0.0.1:5173/platform/candidates')
      await page.locator('.platform-user-button').waitFor()
      if (viewport.width <= 900) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click()
        await page.locator('.platform-sidebar.is-open').waitFor()
        await page.locator('.platform-nav-link').filter({ hasText: /^Candidates$/ }).click()
        await page.locator('.platform-sidebar:not(.is-open)').waitFor({ state: 'attached' })
      } else {
        await page.locator('.platform-nav-link').filter({ hasText: /^Candidates$/ }).click()
      }
      await page.locator('.platform-table-wrap').waitFor()
      await assertNoHorizontalOverflow(page, `${label} ATS list`)
      await captureViewport(page, `viewport-${label}-ats-list`)
      const candidateButton = page.locator('.platform-primary-cell button').filter({ hasText: duplicateSource.name }).first()
      await candidateButton.click()
      const drawer = page.getByRole('dialog', { name: 'Candidate details' })
      await drawer.waitFor()
      await assertNoHorizontalOverflow(page, `${label} ATS details`)
      await captureViewport(page, `viewport-${label}-ats-details`)
      await drawer.getByRole('button', { name: 'Scan for duplicates', exact: true }).click()
      const duplicateCard = drawer.locator('.platform-duplicate-card').filter({ hasText: createdDuplicate.email })
      await duplicateCard.waitFor()
      await duplicateCard.getByRole('button', { name: 'Keep this candidate as primary', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: /merge/i })
      await dialog.waitFor()
      await assertNoHorizontalOverflow(page, `${label} ATS modal`)
      await captureViewport(page, `viewport-${label}-ats-modal`)
      const focusable = dialog.locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      const focusCount = await focusable.count()
      assert.ok(focusCount >= 3, `${label}: merge action dialog should have a useful keyboard loop`)
      const first = focusable.first()
      const last = focusable.last()
      await first.focus()
      await page.keyboard.press(backwardTab)
      assert.equal(await last.evaluate(element => element === document.activeElement), true, `${label}: Shift+Tab should wrap within the topmost action dialog`)
      await page.keyboard.press(forwardTab)
      assert.equal(await first.evaluate(element => element === document.activeElement), true, `${label}: Tab should wrap within the topmost action dialog`)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await drawer.waitFor()
      assert.equal(await page.evaluate(() => Boolean(document.querySelector('.platform-record-drawer')?.contains(document.activeElement))), true, `${label}: closing the action dialog should restore focus to the record drawer`)
      await page.keyboard.press('Escape')
      await drawer.waitFor({ state: 'detached' })

      await page.goto('http://127.0.0.1:5173/careers-platform')
      await page.locator('.platform-career-job').first().waitFor()
      await assertNoHorizontalOverflow(page, `${label} Careers`)
      await captureViewport(page, `viewport-${label}-careers`)
    }
  })
  await check('Mobile workspace menu and careers layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('http://127.0.0.1:5173/platform')
    await page.locator('.platform-user-button').waitFor()
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
  if (firefoxCustomIni) await rm(firefoxCustomIni, { force: true })
  // Remove only this run's uniquely named generated artifacts.
  for (const file of [join(root, 'generated', slug), join(root, 'generated', `${slug}-ats-platform.tar.gz`), join(root, 'configs', `${slug}.json`)]) await rm(file, { recursive: true, force: true })
  const backups = join(root, 'generated', '.backups')
  for (const name of await readdir(backups).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
    if (name.startsWith(`${slug}-`)) await rm(join(backups, name), { recursive: true, force: true })
  }
}
