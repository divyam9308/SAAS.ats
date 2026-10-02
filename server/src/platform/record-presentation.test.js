'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { projectRecordLabels } = require('./record-presentation')

const records = {
  candidates: { c1: { id: 'c1', firstName: 'Ari', lastName: 'Stone', email: 'ari@example.test' } },
  jobs: { j1: { id: 'j1', title: 'Staff Engineer' } },
  clients: { cl1: { id: 'cl1', name: 'Northwind' } },
  placements: { p1: { id: 'p1', name: 'Q3 placement', clientId: 'cl1' } },
  contacts: { ct1: { id: 'ct1', name: 'Casey Contact', email: 'casey@example.test' } },
}
function options(overrides = {}) {
  return {
    get: (kind, id) => records[kind]?.[id] || null,
    canView: () => true,
    readable: () => true,
    users: [{ id: 'u1', name: 'Recruiter One', email: 'private@example.test' }],
    ...overrides,
  }
}

test('projects safe labels for common recruiting records while retaining IDs', () => {
  const row = { id: 'a1', candidateId: 'c1', jobId: 'j1', clientId: 'cl1', ownerId: 'u1' }
  const projected = projectRecordLabels('applications', row, options())
  assert.equal(projected.candidateName, 'Ari Stone')
  assert.equal(projected.jobTitle, 'Staff Engineer')
  assert.equal(projected.clientName, 'Northwind')
  assert.equal(projected.ownerName, 'Recruiter One')
  assert.equal(projected.candidateId, 'c1')
  assert.equal(JSON.stringify(projected).includes('@'), false)
  assert.deepEqual(row, { id: 'a1', candidateId: 'c1', jobId: 'j1', clientId: 'cl1', ownerId: 'u1' })
})

test('does not expose stale labels when linked module or row scope denies access', () => {
  const row = { candidateId: 'c1', candidateName: 'Stale Private Name' }
  const deniedModule = projectRecordLabels('applications', row, options({ canView: kind => kind !== 'candidates' }))
  assert.equal(deniedModule.candidateName, 'Candidate unavailable')
  const deniedRow = projectRecordLabels('applications', row, options({ readable: kind => kind !== 'candidates' }))
  assert.equal(deniedRow.candidateName, 'Candidate unavailable')
  assert.equal(JSON.stringify([deniedModule, deniedRow]).includes('Ari Stone'), false)
  assert.equal(JSON.stringify([deniedModule, deniedRow]).includes('Stale Private Name'), false)
})

test('missing references receive generic fallback labels and IDs remain stable', () => {
  const projected = projectRecordLabels('offers', { candidateId: 'gone', jobId: 'gone-job' }, options())
  assert.equal(projected.candidateName, 'Candidate unavailable')
  assert.equal(projected.jobTitle, 'Job unavailable')
  assert.equal(projected.candidateId, 'gone')
})

test('invoice and interview projections follow relevant relations', () => {
  const invoice = projectRecordLabels('invoices', { clientId: 'missing', placementId: 'p1', placementName: 'Stale' }, options())
  assert.equal(invoice.placementName, 'Q3 placement')
  assert.equal(invoice.clientName, 'Northwind')
  const interview = projectRecordLabels('interviews', { applicationId: 'missing', candidateId: 'c1', contactId: 'ct1' }, options())
  assert.equal(interview.candidateName, 'Ari Stone')
  assert.equal(interview.contactName, 'Casey Contact')
})

test('replaces stale projections when relation is removed and resolves only roster owner names', () => {
  const projected = projectRecordLabels('applications', { candidateName: 'Old', ownerName: 'Spoof', ownerId: 'unapproved' }, options())
  assert.equal('candidateName' in projected, false)
  assert.equal('ownerName' in projected, false)
})

test('record routes return linked labels to admins while denying labels for forbidden modules', async t => {
  const fs = require('node:fs')
  const path = require('node:path')
  const os = require('node:os')
  const express = require('express')
  const { defaults } = require('../../../shared/ats-config.cjs')
  const { createPlatformRouter } = require('./index')
  const config = defaults('corporate')
  config.roles.push({ id: 'applications-only', name: 'Application reader', scope: 'all', permissions: { applications: ['view'] }, sensitive: [] })
  config.users.push({ id: 'limited-reader', name: 'Limited Reader', roleId: 'applications-only' })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-label-routes-'))
  const router = createPlatformRouter({ initialConfig: config, dbPath: path.join(directory, 'ats.sqlite'), dataDir: path.join(directory, 'documents') })
  const app = express(); app.use('/api/platform', router)
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  t.after(async () => { await new Promise(resolve => server.close(resolve)); router.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  const list = async user => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform/records/applications`, { headers: { 'X-Demo-User': user } })
    assert.equal(response.status, 200)
    return (await response.json()).data
  }
  const admin = await list('demo-admin')
  assert.ok(admin.length > 0)
  assert.ok(admin.every(row => row.candidateName && row.candidateName !== 'Candidate unavailable' && row.jobTitle))
  const limited = await list('limited-reader')
  assert.equal(limited.length, admin.length)
  assert.ok(limited.every(row => row.candidateName === 'Candidate unavailable' && row.jobTitle === 'Job unavailable'))
})
