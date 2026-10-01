const test = require('node:test')
const assert = require('node:assert/strict')
const {
  billingEntity,
  companyConfig,
  emailAllowed,
  financialYearStartMonth,
  moduleEnabled
} = require('./companyConfig')

test('server loads the active company configuration', () => {
  assert.equal(companyConfig.version, 1)
  assert.equal(companyConfig.ids.candidatePrefix, 'CA')
  assert.equal(financialYearStartMonth(), 4)
  assert.equal(companyConfig.pipeline.some(stage => stage.key === 'duplicate' && stage.protected), true)
})

test('server applies auth, modules, and invoice configuration', () => {
  assert.equal(emailAllowed('person@fyndbridge.in'), true)
  assert.equal(emailAllowed('person@example.com'), false)
  assert.equal(moduleEnabled('dashboard'), true)
  assert.equal(billingEntity('FCS').invoicePrefix, 'FB')
  assert.equal(billingEntity('FCAPL').proformaPrefix, 'PI/FCAPL')
})
