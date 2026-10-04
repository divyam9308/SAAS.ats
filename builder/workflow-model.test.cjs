'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { defaults, validateConfig } = require('../shared/ats-config.cjs')
const model = import('./workflow-model.js')

test('pipeline rename and reorder preserve identity, other pipelines, and explicit transition rules', async () => {
  const { editPipeline, reorderStage } = await model
  const config = defaults('corporate')
  config.pipelines.push({ ...structuredClone(config.pipelines[0]), id: 'executive', name: 'Executive', default: false })
  const original = structuredClone(config)
  const next = editPipeline(config, 'general', pipeline => ({ ...reorderStage(pipeline, 1, 1), name: 'Company journey' }))
  assert.equal(next.pipelines[0].name, 'Company journey')
  assert.deepEqual(next.pipelines[0].transitions, original.pipelines[0].transitions)
  assert.deepEqual(next.pipelines[1], original.pipelines[1])
  assert.deepEqual(config, original)
  assert.equal(validateConfig(next).valid, true)
})

test('stage removal prunes only incident transitions and keeps one stage', async () => {
  const { removeStage } = await model
  const pipeline = defaults().pipelines[0]
  const next = removeStage(pipeline, 'screening')
  assert.ok(!next.stages.some(stage => stage.id === 'screening'))
  assert.deepEqual(next.transitions, pipeline.transitions.filter(item => item.from !== 'screening' && item.to !== 'screening'))
  assert.throws(() => removeStage({ stages: [{ id: 'one' }] }, 'one'), /at least one/)
})

test('approval changes update policy references, preserve thresholds, and respect preset roles', async () => {
  const { setApprovalMode } = await model
  for (const preset of ['corporate', 'agency', 'startup', 'campus', 'basic']) {
    let config = defaults(preset)
    for (const module of ['requisitions', 'offers']) {
      for (const mode of ['single', 'sequential', 'parallel', 'none']) {
        config = setApprovalMode(config, module, mode)
        const result = validateConfig(config)
        assert.equal(result.valid, true, `${preset}/${module}/${mode}: ${result.errors.join(', ')}`)
        if (mode === 'none') assert.equal(config[module].approvalWorkflowId, '')
        else assert.ok(config.approvalWorkflows.some(workflow => workflow.id === config[module].approvalWorkflowId))
      }
    }
  }
  const config = defaults()
  config.approvalWorkflows[0].threshold = 50000
  assert.equal(setApprovalMode(config, 'requisitions', 'parallel').approvalWorkflows[0].threshold, 50000)
})

test('module toggles maintain agency dependencies and produce valid configurations', async () => {
  const { setModule } = await model
  const enabled = setModule(defaults(), 'agency', true)
  assert.equal(enabled.agency.placements, true)
  const withInvoices = setModule(enabled, 'invoices', true)
  assert.equal(withInvoices.agency.invoices, true)
  const disabled = setModule(withInvoices, 'agency', false)
  assert.equal(disabled.modules.invoices, false)
  assert.equal(validateConfig(disabled).valid, true)
  assert.equal(validateConfig(setModule(defaults('agency'), 'agency', false)).valid, true)
  assert.throws(() => setModule(defaults(), 'invoices', true), /before invoices/)
})

test('approval setup accepts roles with module or global administer permission', async () => {
  const { approvalRoles, setApprovalMode } = await model
  for (const permissions of [{ '*': ['*'] }, { '*': ['administer'] }, { offers: ['administer'] }]) {
    const config = { roles: [{ id: 'company-admin', permissions }], offers: {}, approvalWorkflows: [] }
    const next = setApprovalMode(config, 'offers', 'single')
    assert.equal(next.approvalWorkflows[0].steps[0].roleId, 'company-admin')
    assert.equal(next.offers.approvalWorkflowId, next.approvalWorkflows[0].id)
    assert.deepEqual(approvalRoles(config, 'offers').map(role => role.id), ['company-admin'])
  }
})
