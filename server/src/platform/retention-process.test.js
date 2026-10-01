'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  RetentionProcessError, requestRetentionApproval, decideRetentionApproval, processRetention
} = require('./retention-process')

function memoryStore(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([kind, rows]) => [kind, new Map(rows.map(row => [row.id, structuredClone(row)]))]))
  let serial = 0
  const table = kind => { if (!tables.has(kind)) tables.set(kind, new Map()); return tables.get(kind) }
  return {
    get(kind, id, { includeArchived = false } = {}) { const row = table(kind).get(id); return row && (!row.archivedAt || includeArchived) ? structuredClone(row) : null },
    list(kind, { includeArchived = false } = {}) { return [...table(kind).values()].filter(row => includeArchived || !row.archivedAt).map(row => structuredClone(row)) },
    put(kind, row, actor) {
      const id = row.id || `${kind}-${++serial}`
      const next = { ...(table(kind).get(id) || {}), ...structuredClone(row), id, updatedBy: actor }
      delete next.archivedAt
      table(kind).set(id, next)
      return structuredClone(next)
    },
    archive(kind, id) { const row = this.get(kind, id); if (!row) return null; const next = { ...row, archivedAt: '2026-09-24T00:00:00.000Z' }; table(kind).set(id, next); return structuredClone(next) }
  }
}

const now = new Date('2026-09-24T00:00:00.000Z')
const old = '2025-01-01T00:00:00.000Z'
const config = { privacy: { retentionDays: 365, deletionApprovalRequired: true, anonymizeOnDeletion: true } }

test('dry run is default and does not mutate candidates or approvals', () => {
  const store = memoryStore({ candidates: [{ id: 'old', name: 'Private Name', email: 'private@example.test', createdAt: old, consentStatus: 'granted' }] })
  const preview = processRetention(store, { config, now })
  assert.equal(preview.dryRun, true)
  assert.equal(preview.items[0].status, 'approval_required')
  assert.equal(store.get('candidates', 'old').email, 'private@example.test')
  assert.deepEqual(store.list('approvals'), [])
})

test('caller cannot bypass approval; persisted independent decision is required to process', () => {
  const store = memoryStore({ candidates: [{ id: 'old', name: 'Private Name', email: 'private@example.test', createdAt: old, consentStatus: 'granted' }] })
  const withoutApproval = processRetention(store, { config, now, dryRun: false, candidateIds: ['old'], approved: true })
  assert.equal(withoutApproval.results[0].status, 'approval_required')
  const request = requestRetentionApproval(store, 'old', { actor: 'requester' })
  assert.throws(() => decideRetentionApproval(store, request.id, { actor: 'requester', decision: 'approved' }), error => error instanceof RetentionProcessError && error.status === 403)
  decideRetentionApproval(store, request.id, { actor: 'reviewer', decision: 'approved' })
  const result = processRetention(store, { config, now, dryRun: false, candidateIds: ['old'], actor: 'operator' })
  assert.equal(result.processed[0].action, 'anonymize')
  assert.equal(store.get('candidates', 'old').email, null)
})

test('processor rechecks current eligibility and records audit intent and outcome', () => {
  const store = memoryStore({
    candidates: [{ id: 'old', createdAt: old, consentStatus: 'granted' }],
    approvals: [{ id: 'approved', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'old', status: 'approved', requesterId: 'requester', decidedBy: 'reviewer' }]
  })
  const events = []
  const audit = (...args) => events.push(args)
  const result = processRetention(store, { config, now, dryRun: false, candidateIds: ['old'], audit })
  assert.equal(result.results[0].status, 'processed')
  assert.ok(events.some(event => event[0] === 'retention.processing_intent'))
  assert.ok(events.some(event => event[0] === 'retention.processing_result' && event[3].outcome === 'processed'))

  const recentStore = memoryStore({ candidates: [{ id: 'old', createdAt: old, consentStatus: 'granted' }], approvals: [{ id: 'a', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'old', status: 'approved', requesterId: 'r', decidedBy: 'd' }] })
  recentStore.put('applications', { id: 'app', candidateId: 'old', status: 'active', createdAt: now.toISOString() })
  const skipped = processRetention(recentStore, { config, now, dryRun: false, candidateIds: ['old'] })
  assert.equal(skipped.results[0].status, 'blocked_active_application')
  assert.equal(recentStore.get('candidates', 'old').anonymized, undefined)
})

test('batch bounds are enforced and document cleanup receives archived plus sanitized row', () => {
  assert.throws(() => processRetention(memoryStore(), { config, batchSize: 101 }), RetentionProcessError)
  const store = memoryStore({
    candidates: [{ id: 'old', createdAt: old, consentStatus: 'granted' }],
    approvals: [{ id: 'a', workflow: 'privacy-deletion', recordKind: 'candidates', recordId: 'old', status: 'approved', requesterId: 'r', decidedBy: 'd' }],
    documents: [{ id: 'doc', candidateId: 'old', storageName: 'resume.pdf', filename: 'private.pdf' }]
  })
  let received
  processRetention(store, { config, now, dryRun: false, candidateIds: ['old'], onDocumentArchived: (archived, sanitized) => { received = { archived, sanitized } } })
  assert.equal(received.archived.id, 'doc')
  assert.equal(received.archived.storageName, 'resume.pdf')
  assert.equal(received.sanitized.storageName, null)
})
