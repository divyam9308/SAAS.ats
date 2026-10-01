const test = require('node:test')
const assert = require('node:assert/strict')
const { companyConfig } = require('../config/companyConfig')
const requireModule = require('./moduleEnabled')

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

test('module middleware continues for enabled modules', () => {
  let continued = false
  requireModule('dashboard')({}, responseRecorder(), () => { continued = true })
  assert.equal(continued, true)
})

test('module middleware hides disabled module APIs', () => {
  const previous = companyConfig.modules.invoices
  companyConfig.modules.invoices = false
  try {
    const response = responseRecorder()
    let continued = false
    requireModule('invoices')({}, response, () => { continued = true })
    assert.equal(continued, false)
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.body, { error: 'Module is not enabled.' })
  } finally {
    companyConfig.modules.invoices = previous
  }
})
