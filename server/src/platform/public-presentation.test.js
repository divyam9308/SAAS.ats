'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const express = require('../../node_modules/express')
const { defaults } = require('../../../shared/ats-config.cjs')
const { createPlatformRouter } = require('./index')

async function publicInstance(t, customize = () => {}, routerOptions = {}) {
  const initialConfig = defaults('corporate')
  customize(initialConfig)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-public-presentation-'))
  const router = createPlatformRouter({ initialConfig, dbPath: path.join(dir, 'ats.sqlite'), dataDir: dir, ...routerOptions })
  const app = express()
  app.use(express.json())
  app.use('/api/platform', router)
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    router.close?.()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function request(route) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${route}`)
    const payload = await response.json()
    return { status: response.status, data: payload?.data ?? payload, payload }
  }
  return { request }
}

test('public company and job presentation return only allowlisted branding, careers copy, terminology, and regional fields', async t => {
  const { request } = await publicInstance(t, config => {
    config.company.name = 'Publicly Named Company'
    config.company.supportEmail = 'private@example.test'
    config.branding.careersLogo = 'https://cdn.example.test/careers.svg'
    config.branding.internalSecret = 'brand-secret'
    config.branding.loginSubheading = 'private-login-instructions'
    config.careers = { ...config.careers, copy: {
      headline: 'Work with us',
      submit: 'Send application',
      injectedPrivateNote: 'copy-secret',
      nested: { user: 'must-not-leak' },
    } }
    config.careers.internalSecret = 'career-secret'
    config.terminology.jobs = 'Opportunities'
    config.regional = { ...config.regional, locale: 'en-GB', numberLocale: 'en-GB', currency: 'GBP', timezone: 'Europe/London', dateFormat: 'DD/MM/YYYY', timeFormat: '24h', internalSecret: 'region-secret' }
    config.integrationSecrets = { apiKey: 'top-secret' }
  })

  const company = await request('/public/company')
  assert.equal(company.status, 200)
  assert.deepEqual(Object.keys(company.data).sort(), ['branding', 'careers', 'company', 'privacy', 'privacyNotice', 'regional', 'terminology'].sort())
  assert.deepEqual(company.data.company, { name: 'Publicly Named Company', website: '' })
  assert.equal(company.data.branding.logo, 'https://cdn.example.test/careers.svg')
  assert.deepEqual(Object.keys(company.data.branding).sort(), ['productName', 'logo', 'primaryColor', 'accentColor', 'colorMode', 'darkPrimaryColor', 'darkBackgroundColor', 'typography', 'favicon'].sort())
  assert.equal(company.data.careers.copy.headline, 'Work with us')
  assert.equal(company.data.careers.copy.submit, 'Send application')
  assert.deepEqual(Object.keys(company.data.careers.copy).sort(), ['headline', 'submit'].sort())
  assert.equal(company.data.terminology.jobs, 'Opportunities')
  assert.deepEqual(company.data.regional, { locale: 'en-GB', language: 'en', numberLocale: 'en-GB', currency: 'GBP', timezone: 'Europe/London', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' })

  const jobs = await request('/public/jobs')
  assert.equal(jobs.status, 200)
  assert.ok(jobs.data.length > 0)
  const detail = await request(`/public/jobs/${jobs.data[0].id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.data.company.name, 'Publicly Named Company')
  assert.equal(detail.data.branding.logo, 'https://cdn.example.test/careers.svg')
  assert.equal(detail.data.careers.copy.headline, 'Work with us')
  assert.deepEqual(Object.keys(detail.data.careers.copy).sort(), ['headline', 'submit'].sort())

  const serialized = JSON.stringify([company.data, detail.data])
  for (const secret of ['private@example.test', 'private-login-instructions', 'brand-secret', 'copy-secret', 'must-not-leak', 'career-secret', 'region-secret', 'top-secret', '"roles"', '"users"']) {
    assert.equal(serialized.includes(secret), false, `public response leaked ${secret}`)
  }
})

test('public careers endpoint has an empty jobs projection when there are no seeded records', async t => {
  const { request } = await publicInstance(t, () => {}, { seedDemo: false })
  const company = await request('/public/company')
  assert.equal(company.status, 200)
  const jobs = await request('/public/jobs')
  assert.equal(jobs.status, 200)
  assert.deepEqual(jobs.data, [])
})

test('disabled careers returns no public company or job details and an empty listing', async t => {
  const { request } = await publicInstance(t, config => { config.modules.careers = false })
  assert.equal((await request('/public/company')).status, 404)
  assert.deepEqual((await request('/public/jobs')).data, [])
  const missingJob = await request('/public/jobs/seeded-public-job')
  assert.equal(missingJob.status, 404)
})
