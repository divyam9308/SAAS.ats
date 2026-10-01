const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

process.env.LOCAL_DEMO_MODE = 'true'
process.env.LOCAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'ats-local-test-'))

const app = require('../app')
const { companyConfig } = require('../config/companyConfig')

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, init)
  const payload = await response.json()
  assert.equal(response.ok, true, `${path}: ${response.status} ${payload.error || ''}`)
  return payload
}

test('local demo seeds core ATS data and persists CRUD through the API', async t => {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api`

  const health = await json(base, '/health')
  assert.equal(health.runtime, 'local-demo')

  const before = await json(base, '/candidates?all=true')
  assert.equal(before.data.length, 4)

  const created = await json(base, '/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ full_name: 'Local Test Candidate', email: 'local@example.test' })
  })
  assert.match(created.candidate_display_id, new RegExp(`^${companyConfig.ids.candidatePrefix}\\d+$`))

  const after = await json(base, '/candidates?all=true')
  assert.equal(after.data.length, 5)

  const dashboard = await json(base, '/dashboard')
  assert.equal(dashboard.kpis.totalCandidates, 5)
})
