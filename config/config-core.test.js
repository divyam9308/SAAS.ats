import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  authRestrictionLabel,
  fiscalYearLabel,
  fiscalYearRange,
  invoicePrefix,
  isEmailAllowed,
  isModuleEnabled,
  terminology,
  validateCompanyConfig
} from './config-core.js'

const readPreset = async name => JSON.parse(await readFile(new URL(`./presets/${name}.json`, import.meta.url), 'utf8'))

test('Fyndbridge compatibility preset is valid', async () => {
  const config = await readPreset('fyndbridge')
  assert.deepEqual(validateCompanyConfig(config), { valid: true, errors: [] })
  assert.equal(isEmailAllowed(config, 'person@fyndbridge.in'), true)
  assert.equal(isEmailAllowed(config, 'person@example.com'), false)
  assert.equal(invoicePrefix(config, 'FCS'), 'FB')
  assert.equal(terminology(config, 'job', true), 'Mandates')
})

test('generic recruitment preset is valid and supports any email', async () => {
  const config = await readPreset('generic-recruitment-agency')
  assert.deepEqual(validateCompanyConfig(config), { valid: true, errors: [] })
  assert.equal(isEmailAllowed(config, 'person@anywhere.example'), true)
  assert.equal(isModuleEnabled(config, 'dashboard'), true)
  assert.equal(authRestrictionLabel(config), 'Any valid email account is permitted')
  assert.equal(config.ids.candidatePrefix, 'CA')
  assert.equal(config.pipeline.find(stage => stage.key === 'offer_accepted').label, 'Offer Accepted')
  assert.equal(config.pipeline.find(stage => stage.key === 'duplicate').protected, true)
  assert.equal(invoicePrefix(config, 'PRIMARY'), 'ACME')
})

test('configuration validation rejects unstable pipeline and invalid modules', async () => {
  const config = await readPreset('generic-recruitment-agency')
  config.pipeline = config.pipeline.filter(stage => stage.key !== 'duplicate')
  config.modules.dashboard = 'yes'
  const result = validateCompanyConfig(config)
  assert.equal(result.valid, false)
  assert.match(result.errors.join(' '), /duplicate/)
  assert.match(result.errors.join(' '), /modules\.dashboard/)
})

test('fiscal year helpers support non-April starts', () => {
  assert.equal(fiscalYearLabel(new Date(2026, 0, 1), 1), 'FY 2026-27')
  assert.equal(fiscalYearLabel(new Date(2026, 2, 31), 4), 'FY 2025-26')
  assert.equal(fiscalYearLabel(new Date(2026, 3, 1), 4), 'FY 2026-27')
  const july = fiscalYearRange(2026, 7)
  assert.deepEqual([july.start.getFullYear(), july.start.getMonth(), july.start.getDate()], [2026, 6, 1])
  assert.equal(july.end.getMonth(), 5)
})

test('domain and whitelist rules are explicit', async () => {
  const config = await readPreset('generic-recruitment-agency')
  config.authentication = { mode: 'domains', allowedDomains: ['acme.com', '@partner.org'], allowedEmails: [], googleEnabled: true, passwordEnabled: false }
  assert.equal(isEmailAllowed(config, 'USER@ACME.COM'), true)
  assert.equal(isEmailAllowed(config, 'user@partner.org'), true)
  assert.equal(isEmailAllowed(config, 'user@elsewhere.test'), false)
  config.authentication = { ...config.authentication, mode: 'whitelist', allowedEmails: ['owner@elsewhere.test'] }
  assert.equal(isEmailAllowed(config, 'owner@elsewhere.test'), true)
  assert.equal(isEmailAllowed(config, 'user@acme.com'), false)
})
