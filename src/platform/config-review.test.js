import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfigDiff, getDisabledModuleWarnings, resolveConfigPath } from './config-review.js'

test('configuration review produces readable changed paths and values', () => {
  const changes = getConfigDiff({ company: { name: 'Acme' }, modules: { agency: true } }, { company: { name: 'Northstar' }, modules: { agency: false } })
  assert.deepEqual(changes.map(({ label, before, after }) => [label, before, after]), [
    ['Company › Name', 'Acme', 'Northstar'],
    ['Modules › Agency', 'true', 'false'],
  ])
})

test('keyed arrays show a role permission change at the named role and permission', () => {
  const changes = getConfigDiff(
    { roles: [{ id: 'recruiter', name: 'Recruiter', permissions: { candidates: ['view'] } }] },
    { roles: [{ id: 'recruiter', name: 'Recruiter', permissions: { candidates: ['view', 'edit'] } }] },
  )
  assert.equal(changes.length, 1)
  assert.match(changes[0].label, /Roles › Recruiter › Permissions › Candidates/)
  assert.equal(changes[0].before, '["view"]')
  assert.equal(changes[0].after, '["view","edit"]')
  assert.match(changes[0].path, /id%3Arecruiter/)
})

test('keyed stage arrays report readable order changes', () => {
  const changes = getConfigDiff(
    { pipelines: [{ id: 'general', name: 'General', stages: [{ id: 'applied', name: 'Applied' }, { id: 'screen', name: 'Screen' }] }] },
    { pipelines: [{ id: 'general', name: 'General', stages: [{ id: 'screen', name: 'Screen' }, { id: 'applied', name: 'Applied' }] }] },
  )
  assert.equal(changes.length, 1)
  assert.match(changes[0].label, /Pipelines › General › Stages › Order/)
  assert.match(changes[0].before, /Applied.*Screen/)
  assert.match(changes[0].after, /Screen.*Applied/)
})

test('new pipelines are summarized instead of serialized as a large object', () => {
  const pipeline = { id: 'sales', name: 'Sales Hiring', stages: [{ id: 'applied' }, { id: 'offer' }], transitions: [{ from: 'applied', to: 'offer' }], settings: { internal: 'x'.repeat(1000) } }
  const [change] = getConfigDiff({ pipelines: [] }, { pipelines: [pipeline] })
  assert.match(change.label, /Pipelines › Sales Hiring/)
  assert.match(change.after, /Sales Hiring \(2 stages, 1 transitions\)/)
  assert.ok(change.after.length < 100)
})

test('section path resolution prefixes section fields and preserves mapped nested paths', () => {
  assert.equal(resolveConfigPath('branding', 'branding', {}, 'primaryColor'), 'branding.primaryColor')
  assert.equal(resolveConfigPath('regional', 'regional', {}, 'workingHours.start'), 'regional.workingHours.start')
  assert.equal(resolveConfigPath('terminology', 'terminology', {}, 'candidates.plural'), 'terminology.candidates.plural')
  assert.equal(resolveConfigPath('careers', 'careers', { forms: 'applicationForms', presentation: 'careers' }, 'presentation.copy.submit'), 'careers.copy.submit')
  assert.equal(resolveConfigPath('jobs', 'jobs', { templates: 'jobTemplates' }, 'jobTemplates.0.title'), 'jobTemplates.0.title')
})

test('module policy explains disabling dependent operational workflows', () => {
  const warnings = getDisabledModuleWarnings({ modules: { agency: true, offers: true, onboarding: true } }, { modules: { agency: false, offers: false, onboarding: false } })
  assert.deepEqual(warnings.map(({ module }) => module), ['agency', 'offers', 'onboarding'])
  assert.match(warnings[0].message, /existing records remain stored/i)
  assert.match(warnings[0].message, /client records, mandates, submissions, placements, fees and invoices/)
  assert.equal(getDisabledModuleWarnings({ modules: { agency: false } }, { modules: { agency: false } }).length, 0)
})
