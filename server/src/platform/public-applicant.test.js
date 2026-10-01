'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { PublicApplicantError, preparePublicApplication } = require('./public-applicant')

const jobs = [{ id: 'job-1', title: 'Designer', status: 'open' }, { id: 'closed', title: 'Closed', status: 'closed' }]

test('public application captures applicant details without resolving private candidates by email', () => {
  const result = preparePublicApplication({
    input: { jobId: 'job-1', name: ' Ari Singh ', email: 'ARI@example.test', phone: '555-0100' },
    jobs,
    // This argument is intentionally ignored: public applications must not
    // attach a private candidate record, even on an exact email match.
    candidates: [{ id: 'private-candidate', email: 'ari@example.test' }],
    now: '2026-01-02T03:04:05Z'
  })
  assert.equal(result.candidateId, null)
  assert.equal(result.candidateDetails.email, 'ari@example.test')
  assert.equal(result.status, 'received')
  assert.equal(JSON.stringify(result).includes('private-candidate'), false)
})

test('duplicate public application uses the same response shape and discloses no record IDs', () => {
  const result = preparePublicApplication({
    input: { jobId: 'job-1', name: 'Ari Singh', email: 'ari@example.test' },
    jobs,
    applications: [{ id: 'secret-app-id', candidateId: 'secret-candidate-id', candidateEmail: 'ARI@example.test', jobId: 'job-1' }]
  })
  assert.equal(result.status, 'received')
  assert.equal(result.duplicateReview, true)
  assert.equal(result.candidateId, null)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('missing details and unavailable jobs are rejected', () => {
  assert.throws(() => preparePublicApplication({ input: { jobId: 'job-1' }, jobs }), error => error instanceof PublicApplicantError && error.status === 422)
  assert.throws(() => preparePublicApplication({ input: { jobId: 'closed', name: 'Ari', email: 'ari@example.test' }, jobs }), error => error.status === 404)
})
