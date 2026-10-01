#!/usr/bin/env node

// Lightweight, read-only browser acceptance check for the local ATS.
// Run with: node scripts/browser-check.mjs [base-url]
// Defaults to http://127.0.0.1:5173. Install Playwright + Chromium first if
// they are not available: npm install --no-save playwright && npx playwright install chromium

import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const baseUrl = (process.argv[2] || process.env.ATS_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')

function loadPlaywright() {
  try {
    return require('playwright')
  } catch {}
  try {
    return require('/tmp/ats-browser/node_modules/playwright')
  } catch {}
  throw new Error('Playwright is missing. Install it with `npm install --no-save playwright`, then install Chromium with `npx playwright install chromium`.')
}

const { chromium } = loadPlaywright()
const failures = []
const checks = []
const consoleErrors = []
const pageErrors = []
const failedRequests = []

function check(name, condition, detail = '') {
  checks.push({ name, passed: Boolean(condition), detail })
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

let browser
try {
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    console.error(`BROWSER UNAVAILABLE: Playwright could not launch Chromium (${error.message.split('\n')[0]}).`)
    console.error('Install a runnable browser with `npx playwright install chromium`, then rerun this script. No browser checks were performed.')
    process.exitCode = 2
  }

  if (browser) {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'failed'}`))

    try {
      const response = await page.goto(`${baseUrl}/platform`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      check('platform route responds', Boolean(response && response.ok()), response ? `HTTP ${response.status()}` : 'no response')
      await page.locator('.platform-user-button').waitFor({ state: 'visible', timeout: 15000 })
      check('workspace navigation renders', await page.locator('.platform-sidebar, [role="navigation"]').count() > 0)

      const jobsLink = page.getByRole('button', { name: /Jobs/ }).first()
      if (await jobsLink.count()) {
        await jobsLink.click()
        await page.getByRole('heading', { name: /Jobs/i }).first().waitFor({ state: 'visible', timeout: 10000 })
        check('navigation opens Jobs', true)
      } else {
        check('navigation opens Jobs', false, 'Jobs navigation control not found')
      }

      const settingsLink = page.getByRole('button', { name: /Settings/ }).first()
      if (await settingsLink.count()) {
        await settingsLink.click()
        await page.getByRole('heading', { name: 'Configure your ATS' }).waitFor({ state: 'visible', timeout: 10000 })
        check('configuration screen opens', true)
      } else {
        check('configuration screen opens', false, 'Settings navigation control not found')
      }

      await page.locator('.platform-user-button').click()
      await page.getByText('Switch demo user', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
      const userOptions = page.locator('.platform-user-menu > button')
      const userCount = await userOptions.count()
      check('demo user switcher opens', userCount > 0, `${userCount} user options`)
      if (userCount > 1) {
        const originalName = (await page.locator('.platform-user-button strong').innerText()).trim()
        const optionNames = await userOptions.locator('strong').allInnerTexts()
        const alternateName = optionNames.map((name) => name.trim()).find((name) => name && name !== originalName)
        if (alternateName) {
          await userOptions.filter({ hasText: alternateName }).first().click()
          await page.getByText(`Now viewing as ${alternateName}`, { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
          check('demo user switch works', (await page.locator('.platform-user-button strong').innerText()).trim() === alternateName, alternateName)
          await page.locator('.platform-user-button').click()
          await page.locator('.platform-user-menu').getByRole('button').filter({ hasText: originalName }).click()
          await page.getByText(`Now viewing as ${originalName}`, { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
        } else {
          check('demo user switch works', false, 'No alternate demo user is available')
        }
      } else {
        check('demo user switch works', false, 'Fewer than two demo users are configured')
      }
    } catch (error) {
      failures.push(`browser flow aborted: ${error.message}`)
      console.error(`FAIL browser flow aborted — ${error.message}`)
    }

    try {
      const response = await page.goto(`${baseUrl}/careers-platform`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      check('careers route responds', Boolean(response && response.ok()), response ? `HTTP ${response.status()}` : 'no response')
      await page.getByRole('heading', { name: /Find work|Careers/i }).waitFor({ state: 'visible', timeout: 15000 })
      check('careers content renders', await page.locator('.platform-career-main').innerText().then((text) => text.trim().length > 0))
      const firstRole = page.locator('.platform-career-job').first()
      if (await firstRole.count()) {
        const roleName = (await firstRole.locator('strong').innerText()).trim()
        await firstRole.click()
        await page.getByRole('heading', { name: roleName }).waitFor({ state: 'visible', timeout: 10000 })
        check('career role detail opens', true, roleName)
        await page.getByRole('button', { name: /All openings/ }).click()
        check('career listing returns', await page.locator('.platform-career-jobs').isVisible())
      } else {
        check('career role detail opens', false, 'No published role is available to open')
      }
    } catch (error) {
      failures.push(`careers flow aborted: ${error.message}`)
      console.error(`FAIL careers flow aborted — ${error.message}`)
    }

    check('no uncaught browser exceptions', pageErrors.length === 0, pageErrors.join(' | ') || 'none')
    check('no browser console errors', consoleErrors.length === 0, consoleErrors.join(' | ') || 'none')
    if (failedRequests.length) console.error(`Failed network requests:\n${failedRequests.map((item) => `  ${item}`).join('\n')}`)
    await context.close()
  }
} finally {
  if (browser) await browser.close()
}

if (browser) {
  console.log(`\n${checks.filter((item) => item.passed).length}/${checks.length} browser checks passed at ${baseUrl}`)
  if (failures.length) process.exitCode = 1
}
