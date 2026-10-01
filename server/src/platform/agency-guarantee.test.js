'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AgencyGuaranteeError,
  calculateGuaranteeExpiry,
  requestGuaranteeReplacement,
  startGuaranteeReview,
  decideGuaranteeReview,
  submitReplacement
} = require('./agency-guarantee')

function memoryStore(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([kind, rows]) => [kind, new Map(rows.map(row => [row.id, structuredClone(row)]))]))
  let sequence = 0
  const table = kind => { if (!tables.has(kind)) tables.set(kind, new Map()); return tables.get(kind) }
  return {
    get(kind, id) { const row = table(kind).get(id); return row ? structuredClone(row) : null },
    list(kind) { return [...table(kind).values()].map(row => structuredClone(row)) },
    put(kind, row) { const value = { ...structuredClone(row), id: row.id || `${kind}-${++sequence}` }; table(kind).set(value.id, value); return structuredClone(value) }
  }
}
function failStatus(fn, status) { assert.throws(fn, error => error instanceof AgencyGuaranteeError && error.status === status) }

test('expiry uses placement start date and agency.guarantees duration policy', () => {
  assert.equal(calculateGuaranteeExpiry({ startDate: '2026-01-31' }, { agency: { guarantees: { defaultDays: 30 } } }), '2026-03-02')
  assert.equal(calculateGuaranteeExpiry({ placedAt: '2026-02-01', guaranteeDays: 14 }, {}), '2026-02-15')
  assert.equal(calculateGuaranteeExpiry({ startDate: '2026-01-01' }, { agency: { guarantees: { defaultDays: 0 } } }), null)
  failStatus(() => calculateGuaranteeExpiry({ startDate: 'bad' }, { agency: { guarantees: { defaultDays: 10 } } }), 422)
})

test('request requires a reason and an active guarantee period', () => {
  const placement = { id: 'p1', guaranteeExpiry: '2026-12-31', guaranteeHistory: [] }
  failStatus(() => requestGuaranteeReplacement(memoryStore(), placement, { reason: '  ' }, { config: {}, actor: 'client' }), 422)
  failStatus(() => requestGuaranteeReplacement(memoryStore(), { ...placement, guaranteeExpiry: '2026-01-01' }, { reason: 'Candidate left', requestedAt: '2026-03-01' }, { config: {} }), 409)
  const updated = requestGuaranteeReplacement(memoryStore(), placement, { reason: 'Candidate left', requestedAt: '2026-06-01' }, { config: {}, actor: 'client' })
  assert.equal(updated.guaranteeStatus, 'requested')
  assert.equal(updated.guaranteeRequest.reason, 'Candidate left')
  assert.equal(updated.guaranteeHistory[0].type, 'requested')
})

test('review progresses through start and approve or deny with immutable event history', () => {
  const store = memoryStore()
  const original = { id: 'p1', clientId: 'c1', guaranteeExpiry: '2026-12-31', guaranteeHistory: [] }
  const requested = requestGuaranteeReplacement(store, original, { reason: 'Early departure', requestedAt: '2026-06-01' }, { config: {}, actor: 'client' })
  const firstHistory = structuredClone(requested.guaranteeHistory)
  const reviewing = startGuaranteeReview(store, requested, { comment: 'Checking terms', reviewedAt: '2026-06-02' }, { actor: 'ops' })
  assert.equal(reviewing.guaranteeStatus, 'under_review')
  assert.deepEqual(requested.guaranteeHistory, firstHistory)
  failStatus(() => decideGuaranteeReview(store, reviewing, 'deny', { decidedAt: '2026-06-03' }), 422)
  const approved = decideGuaranteeReview(store, reviewing, 'approve', { reason: 'Within terms', decidedAt: '2026-06-03' }, { actor: 'manager' })
  assert.equal(approved.guaranteeStatus, 'approved')
  assert.deepEqual(approved.guaranteeHistory.map(event => event.type), ['requested', 'review_started', 'approved'])
})

test('approved guarantee submits one linked replacement to the same client', () => {
  const store = memoryStore()
  const approved = {
    id: 'p1', clientId: 'c1', candidateId: 'old-candidate', guaranteeStatus: 'approved',
    guaranteeRequest: { id: 'g1', status: 'approved' }, guaranteeHistory: []
  }
  failStatus(() => submitReplacement(store, approved, { clientId: 'c2', candidateId: 'new-candidate' }), 422)
  const result = submitReplacement(store, approved, { clientId: 'c1', candidateId: 'new-candidate', jobId: 'j1' }, { actor: 'recruiter' })
  assert.equal(result.submission.clientId, 'c1')
  assert.equal(result.submission.replacementForPlacementId, 'p1')
  assert.equal(result.submission.guaranteeRequestId, 'g1')
  assert.equal(result.placement.guaranteeStatus, 'replacement_submitted')
  assert.equal(result.placement.guaranteeHistory[0].submissionId, result.submission.id)
  failStatus(() => submitReplacement(store, result.placement, { clientId: 'c1' }), 409)
})
