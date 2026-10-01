'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { defaults, migrateConfig, validateConfig, validateFields, presets } = require('./ats-config.cjs')

test('all presets produce valid canonical configs with resolvable references', () => {
  assert.deepEqual(presets.map(preset => preset.id), ['corporate', 'agency', 'startup', 'campus', 'basic'])
  for (const { id } of presets) {
    const result = validateConfig(defaults(id))
    assert.equal(result.valid, true, `${id}: ${result.errors.join('; ')}`)
  }
  const agency = defaults('agency')
  assert.ok(agency.users.some(user => user.roleId === 'agency-consultant'))
  assert.ok(agency.roles.some(role => role.id === 'agency-consultant'))
})

test('corporate defaults include multi-step offer and onboarding workflows and executive roles', () => {
  const config = defaults('corporate')
  assert.equal(config.modules.onboarding, true)
  assert.ok(config.onboardingTemplates.length)
  const offerFlow = config.approvalWorkflows.find(workflow => workflow.id === config.offers.approvalWorkflowId)
  assert.ok(offerFlow)
  assert.ok(offerFlow.steps.length > 1)
  assert.ok(config.roles.some(role => role.id === 'hr-head'))
  assert.ok(config.roles.some(role => role.id === 'ceo'))
})

test('required consent checkbox accepts only true', () => {
  const field = [{ id: 'consent', field: 'consent', key: 'consent', label: 'Consent', type: 'checkbox', required: true }]
  assert.equal(validateFields(field, { consent: true }).valid, true)
  assert.equal(validateFields(field, { consent: false }).valid, false)
  assert.equal(validateFields(field, {}).valid, false)
})

test('application fields support legacy field names but reject conflicting canonical identifiers', () => {
  const config = defaults('corporate')
  const appField = config.applicationForms[0].sections[0].fields[0]
  assert.equal(validateConfig(config).valid, true)
  appField.id = 'different-id'
  assert.equal(validateConfig(config).errors.some(error => error.includes('id, key, and field must agree')), true)
})

test('migration preserves branding and V2 migration is idempotent without recursive legacy nesting', () => {
  const migrated = migrateConfig({
    version: 1,
    company: { displayName: 'Example Org', atsProductName: 'Example People', shortName: 'example' },
    branding: { primaryColor: '#123456', squareLogo: '/logo.svg', horizontalLogo: '/wide.svg' },
    pipeline: [{ key: 'applied', label: 'Applied', enabled: true }, { key: 'interview', label: 'Interview', enabled: true }]
  })
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.company.name, 'Example Org')
  assert.equal(migrated.branding.productName, 'Example People')
  assert.equal(migrated.branding.primaryColor, '#123456')
  assert.equal(migrated.branding.logo, '/logo.svg')
  assert.equal(migrated.branding.horizontalLogo, '/wide.svg')
  assert.equal(migrated.legacy.sourceConfig.version, 1)
  const twice = migrateConfig(migrated)
  assert.deepEqual(twice, migrated)
  assert.equal(twice.legacy.sourceConfig.legacy, undefined)
})

test('migration rejects non-object inputs', () => {
  assert.throws(() => migrateConfig(null), TypeError)
  assert.throws(() => migrateConfig([]), TypeError)
})

test('migration refuses newer schemas rather than rewriting data with an older schema', () => {
  assert.throws(() => migrateConfig({ schemaVersion: 3, company: { name: 'Future Co' } }), /newer than this application supports/)
})

test('organization validation catches duplicate IDs, cycles, and unknown default owners', () => {
  const config = defaults('corporate')
  config.organization.units[1].parentId = 'unit-sales'
  config.organization.units[2].parentId = 'unit-engineering'
  config.organization.units[1].defaultHiringOwnerId = 'missing-user'
  const result = validateConfig(config)
  assert.ok(result.errors.some(error => error.includes('hierarchy cycle')))
  assert.ok(result.errors.some(error => error.includes('defaultHiringOwnerId references an unknown user')))

  const duplicate = defaults('corporate')
  duplicate.organization.locations.push({ ...duplicate.organization.locations[0] })
  assert.ok(validateConfig(duplicate).errors.some(error => error.includes('organization.locations[1].id')))
})

test('pipeline and template references are checked before activation', () => {
  const config = defaults('corporate')
  config.pipelines[0].transitions.push({ from: 'applied', to: 'applied' })
  config.jobTemplates[0].pipelineId = 'missing-pipeline'
  const result = validateConfig(config)
  assert.ok(result.errors.some(error => error.includes('cannot transition a stage to itself')))
  assert.ok(result.errors.some(error => error.includes('jobTemplates[0].pipelineId references an unknown pipeline')))
})

test('select custom fields require configured choices before activation', () => {
  const config = defaults('corporate')
  config.customFields.candidates.push({
    id: 'candidate-source-detail',
    key: 'candidateSourceDetail',
    label: 'Candidate source detail',
    type: 'singleSelect',
    required: false,
    options: ['Referral', 'Careers site']
  })
  assert.equal(validateConfig(config).valid, true)

  config.customFields.candidates[0].options = []
  assert.ok(validateConfig(config).errors.some(error => error.includes('customFields.candidates[0].options must contain at least one option')))
})

test('module and approval contradictions fail validation with actionable errors', () => {
  const config = defaults('agency')
  config.modules.agency = false
  config.agency.placements = true
  config.offers.requireApproval = true
  config.offers.approvalWorkflowId = ''
  const result = validateConfig(config)
  assert.ok(result.errors.some(error => error.includes('Agency mode requires the agency module')))
  assert.ok(result.errors.some(error => error.includes('Agency workflow settings cannot be enabled')))
  assert.ok(result.errors.some(error => error.includes('offers.approvalWorkflowId is required')))
})

test('malformed collection shapes return validation errors instead of throwing', () => {
  const config = defaults('corporate')
  config.users = { id: 'not-an-array' }
  config.pipelines[0].stages = { id: 'not-an-array' }
  config.applicationForms = { id: 'not-an-array' }
  assert.doesNotThrow(() => {
    const result = validateConfig(config)
    assert.equal(result.valid, false)
    assert.ok(result.errors.length)
  })
})
