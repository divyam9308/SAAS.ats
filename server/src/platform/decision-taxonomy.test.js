'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { action, WorkflowError } = require('./workflows')

function memoryStore(record) {
  const rows = new Map([[record.id, structuredClone(record)]])
  let writes = 0
  return {
    get(id) { return structuredClone(rows.get(id) || null) },
    put(_kind, value, actor) {
      writes++
      const saved = { ...structuredClone(value), updatedBy: actor }
      rows.set(saved.id, saved)
      return structuredClone(saved)
    },
    writes: () => writes
  }
}

function context(config) {
  const audits = []
  return {
    user: { id: 'recruiter-1', roleId: 'recruiter' },
    config,
    audit: (...entry) => audits.push(entry),
    emit() {},
    audits
  }
}

const config = {
  taxonomies: {
    rejectionReasons: ['Skills mismatch', 'Role filled'],
    withdrawalReasons: ['Accepted another offer', 'No longer interested']
  }
}

test('application reject and withdraw use their respective configured reason categories', () => {
  const rejectedStore = memoryStore({ id: 'app-reject', status: 'active', stage: 'screening' })
  const rejectedContext = context(config)
  const rejected = action(rejectedStore, 'applications', rejectedStore.get('app-reject'), 'reject', {
    reason: 'The role needs deeper experience.', reasonCategory: 'Skills mismatch'
  }, rejectedContext)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.endReason, 'The role needs deeper experience.')
  assert.equal(rejected.endReasonCategory, 'Skills mismatch')
  assert.deepEqual(rejectedContext.audits[0][3], { reason: 'The role needs deeper experience.', reasonCategory: 'Skills mismatch' })

  const withdrawnStore = memoryStore({ id: 'app-withdraw', status: 'active', stage: 'screening' })
  const withdrawnContext = context(config)
  const withdrawn = action(withdrawnStore, 'applications', withdrawnStore.get('app-withdraw'), 'withdraw', {
    reason: 'Candidate informed the recruiter.', reasonCategory: 'Accepted another offer'
  }, withdrawnContext)
  assert.equal(withdrawn.status, 'withdrawn')
  assert.equal(withdrawn.endReasonCategory, 'Accepted another offer')
  assert.deepEqual(withdrawnContext.audits[0][3], { reason: 'Candidate informed the recruiter.', reasonCategory: 'Accepted another offer' })
})

test('invalid or cross-taxonomy categories reject atomically before persistence and audit', () => {
  for (const [actionName, reasonCategory] of [
    ['reject', 'Accepted another offer'],
    ['withdraw', 'Role filled'],
    ['reject', 7]
  ]) {
    const initial = { id: `app-${actionName}-${String(reasonCategory)}`, status: 'active', stage: 'screening' }
    const store = memoryStore(initial)
    const ctx = context(config)
    assert.throws(() => action(store, 'applications', store.get(initial.id), actionName, { reasonCategory }, ctx), error =>
      error instanceof WorkflowError && error.status === 422)
    assert.equal(store.writes(), 0)
    assert.deepEqual(store.get(initial.id), initial)
    assert.deepEqual(ctx.audits, [])
  }
})

test('free-text-only application decisions remain backward-compatible', () => {
  const store = memoryStore({ id: 'app-freeform', status: 'active', stage: 'screening' })
  const ctx = context(config)
  const rejected = action(store, 'applications', store.get('app-freeform'), 'reject', { reason: 'Not a fit for this opening.' }, ctx)
  assert.equal(rejected.endReason, 'Not a fit for this opening.')
  assert.equal(rejected.endReasonCategory, null)
  assert.deepEqual(ctx.audits[0][3], { reason: 'Not a fit for this opening.', reasonCategory: null })
})
