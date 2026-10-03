'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { defaults, migrateConfig, validateConfig } = require('../shared/ats-config.cjs')

const PRESETS = ['corporate', 'agency', 'startup', 'campus', 'basic']
const OPTIONAL_MODULES = ['requisitions', 'careers', 'offers', 'onboarding', 'referrals', 'talentCrm', 'workforcePlanning', 'automation', 'agency', 'invoices']

test('pairwise buyer module matrix either validates or returns the documented dependency error', () => {
  let scenarios = 0
  for (const preset of PRESETS) {
    for (let left = 0; left < OPTIONAL_MODULES.length; left += 1) {
      for (let right = left + 1; right < OPTIONAL_MODULES.length; right += 1) {
        const config = defaults(preset)
        const leftKey = OPTIONAL_MODULES[left]
        const rightKey = OPTIONAL_MODULES[right]
        config.modules[leftKey] = (left + right) % 2 === 0
        config.modules[rightKey] = (left + right) % 3 === 0
        if (config.mode === 'agency') config.modules.agency = true
        if (!config.modules.agency) {
          config.modules.invoices = false
          for (const key of Object.keys(config.agency || {})) if (typeof config.agency[key] === 'boolean') config.agency[key] = false
        }
        if (!config.modules.offers) config.offers = { ...config.offers, requireApproval: false, approvalWorkflowId: '' }
        if (!config.modules.careers) {
          config.applicationForms = []
          config.jobTemplates = config.jobTemplates.map((template) => ({ ...template, applicationFormId: '' }))
        }
        const result = validateConfig(config)
        assert.equal(result.valid, true, `${preset}/${leftKey}/${rightKey}: ${result.errors.join(', ')}`)
        scenarios += 1
      }
    }
  }
  assert.equal(scenarios, 225)
})

test('uncommon parallel, delegated, conditional and cross-module workflow configuration validates', () => {
  const config = defaults('corporate')
  config.approvalWorkflows.push({ id: 'parallel-finance-and-legal', name: 'Finance and legal in parallel', module: 'offers', sequential: false, threshold: 250000, steps: [{ roleId: 'finance' }, { roleId: 'admin' }] })
  config.delegations.push({ id: 'holiday-cover', roleId: 'hr-head', delegateRoleId: 'recruiter', startsOn: '2026-12-20', endsOn: '2027-01-05' })
  config.automations.push({ id: 'high-value-offer-review', name: 'High value offer review', enabled: true, trigger: { event: 'offer.created' }, conditions: [{ field: 'amount', operator: 'gte', value: 250000 }], actions: [{ type: 'create_task', ownerRoleId: 'finance' }] })
  config.scorecards.push({ id: 'executive-scorecard', name: 'Executive scorecard', competencies: [{ id: 'strategy', name: 'Strategy', weight: 3, required: true }], ratingScale: { min: 1, max: 7, labels: ['1','2','3','4','5','6','7'] }, recommendations: ['no', 'yes'], mandatoryFeedback: true })
  const result = validateConfig(config)
  assert.equal(result.valid, true, result.errors.join(', '))
})

test('legacy migration matrix preserves buyer identity while canonicalizing retired fields', () => {
  const legacyCases = PRESETS.map((preset, index) => ({
    version: 1,
    mode: preset === 'agency' ? 'agency' : preset === 'startup' || preset === 'basic' ? 'startup' : 'corporate',
    company: { displayName: `Legacy Buyer ${index}`, slug: `legacy-buyer-${index}` },
    modules: { publicRoles: index % 2 === 0, clients: preset === 'agency', offers: index % 3 !== 0 },
    data: { retentionDays: 180 + index },
  }))
  for (const [index, legacy] of legacyCases.entries()) {
    const migrated = migrateConfig(legacy)
    assert.equal(migrated.company.slug, `legacy-buyer-${index}`)
    assert.equal(migrated.modules.careers, index % 2 === 0)
    assert.equal(migrated.schemaVersion > 1, true)
    const validation = validateConfig(migrated)
    assert.equal(validation.valid, true, validation.errors.join(', '))
  }
})
