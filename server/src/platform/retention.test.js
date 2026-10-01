'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { RetentionError, buildRetentionPlan } = require('./retention')

function memoryStore(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([kind, rows]) => [kind, rows.map(row => structuredClone(row))]))
  return { list(kind) { return (tables.get(kind) || []).map(row => structuredClone(row)) } }
}

const reference = new Date('2026-09-24T00:00:00.000Z')
const oldDate = '2025-09-24T00:00:00.000Z'
const config = { privacy: { retentionDays: 365, deletionApprovalRequired: true } }

test('retention preview flags missing consent for review and requires an approval before proposing anonymization', () => {
  const store = memoryStore({ candidates: [{ id: 'no-consent', createdAt: oldDate, consentStatus: 'pending', email: 'private@example.test' }] })
  const plan = buildRetentionPlan(store, { config, now: reference })
  assert.equal(plan.previewOnly, true)
  assert.equal(plan.summary.approvalRequiredCount, 1)
  assert.deepEqual(plan.items[0], {
    candidateId: 'no-consent', status: 'approval_required',
    reason: 'Consent is not recorded as granted and the retention period elapsed; review consent and obtain approval before processing.',
    recommendedAction: 'request_approval', consentStatus: 'pending', consentReviewRequired: true,
    lastActivityAt: oldDate, activeApplicationCount: 0, applicationCount: 0,
    approvalId: null, pendingApprovalId: null, retentionAction: null
  })
  assert.equal(store.list('candidates')[0].email, 'private@example.test')
})

test('most recent persisted application activity keeps a candidate within the configured period', () => {
  const store = memoryStore({
    candidates: [{ id: 'recent-app', createdAt: oldDate, consentStatus: 'granted' }],
    applications: [{ id: 'application', candidateId: 'recent-app', status: 'rejected', appliedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' }]
  })
  const item = buildRetentionPlan(store, { config, now: reference }).items[0]
  assert.equal(item.status, 'within_retention_period')
  assert.equal(item.lastActivityAt, '2026-09-23T00:00:00.000Z')
  assert.equal(item.recommendedAction, 'retain')
})

test('active applications block retention processing even when the candidate is old and approved', () => {
  const store = memoryStore({
    candidates: [{ id: 'active', createdAt: oldDate, consentStatus: 'granted' }],
    applications: [{ id: 'a', candidateId: 'active', status: 'screening', createdAt: oldDate }],
    approvals: [{ id: 'approved', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'active', status: 'approved', requesterId: 'admin-a', decidedBy: 'admin-b' }]
  })
  const item = buildRetentionPlan(store, { config, now: reference }).items[0]
  assert.equal(item.status, 'blocked_active_application')
  assert.equal(item.recommendedAction, 'review_active_application')
  assert.equal(item.approvalId, 'approved')
})

test('independently approved privacy request makes an old candidate eligible and selects configured action', () => {
  const store = memoryStore({
    candidates: [{ id: 'approved-candidate', createdAt: oldDate, consentStatus: 'withdrawn' }],
    approvals: [{ id: 'request-1', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'approved-candidate', status: 'approved', requesterId: 'admin-a', decidedBy: 'admin-b' }]
  })
  const item = buildRetentionPlan(store, { config, now: reference }).items[0]
  assert.equal(item.status, 'eligible')
  assert.equal(item.consentReviewRequired, true)
  assert.equal(item.approvalId, 'request-1')
  assert.equal(item.retentionAction, 'anonymize')

  const archivePlan = buildRetentionPlan(store, { config: { ...config, privacy: { ...config.privacy, anonymizeOnDeletion: false } }, now: reference })
  assert.equal(archivePlan.items[0].retentionAction, 'archive')
})

test('cutoff boundary is inclusive and an approval by the requester does not count', () => {
  const store = memoryStore({
    candidates: [
      { id: 'on-boundary', createdAt: oldDate, consentStatus: 'granted' },
      { id: 'one-millisecond-newer', createdAt: '2025-09-24T00:00:00.001Z', consentStatus: 'granted' }
    ],
    approvals: [{ id: 'self-approved', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'on-boundary', status: 'approved', requesterId: 'same-user', decidedBy: 'same-user' }]
  })
  const plan = buildRetentionPlan(store, { config, now: reference })
  assert.equal(plan.cutoff, oldDate)
  assert.equal(plan.items.find(item => item.candidateId === 'on-boundary').status, 'approval_required')
  assert.equal(plan.items.find(item => item.candidateId === 'one-millisecond-newer').status, 'within_retention_period')
})

test('pending independent request is surfaced without silently processing and missing activity dates are held', () => {
  const store = memoryStore({
    candidates: [{ id: 'pending', createdAt: oldDate }, { id: 'no-date', consentStatus: 'granted' }],
    approvals: [{ id: 'pending-request', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'pending', status: 'pending', requesterId: 'admin-a' }]
  })
  const plan = buildRetentionPlan(store, { config, now: reference })
  assert.equal(plan.items.find(item => item.candidateId === 'pending').status, 'awaiting_approval')
  assert.equal(plan.items.find(item => item.candidateId === 'no-date').status, 'needs_activity_date')
  assert.equal(plan.items.find(item => item.candidateId === 'no-date').recommendedAction, 'retain')
})

test('invalid retention configuration and planning dates are rejected', () => {
  const store = memoryStore()
  assert.throws(() => buildRetentionPlan(store, { config: { privacy: { retentionDays: 0 } }, now: reference }), RetentionError)
  assert.throws(() => buildRetentionPlan(store, { config, now: 'not-a-date' }), RetentionError)
})
