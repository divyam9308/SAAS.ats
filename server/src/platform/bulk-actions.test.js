'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { bulkAction, BulkActionError } = require('./bulk-actions')

function harness(records, overrides = {}) {
  const executed = []
  const adapters = {
    loadRecord: async (kind, id) => records[id] && { ...records[id] },
    canAccess: async () => true,
    canPerform: async () => true,
    execute: async plan => { executed.push(plan); return { count: plan.operations.length } },
    workflow: { validateMove: (_record, stage) => ({ stage }), move: async () => assert.fail('planner must not execute workflow') },
    ...overrides
  }
  return { adapters, executed }
}

const actor = { id: 'user-1' }

test('plans changes and explicit audit entries, then hands off once to executor', async () => {
  const h = harness({ a: { id: 'a', tags: ['warm'] }, b: { id: 'b', tags: [] } })
  const result = await bulkAction({ kind: 'candidates', ids: ['a', 'b'], action: 'addTags', payload: { tags: ['priority', 'warm'] }, actor, adapters: h.adapters })
  assert.deepEqual(result, { count: 2 })
  assert.equal(h.executed.length, 1)
  assert.deepEqual(h.executed[0].operations[0].patch, { tags: ['warm', 'priority'] })
  assert.deepEqual(h.executed[0].operations[0].audit, { type: 'bulk.action', actorId: actor.id, kind: 'candidates', recordId: 'a', action: 'addTags', tags: ['priority', 'warm'] })
})

test('one unauthorized row aborts before execute is called', async () => {
  const h = harness({ a: { id: 'a', tags: [] }, b: { id: 'b', tags: [] } }, { canAccess: async (_actor, record) => record.id !== 'b' })
  await assert.rejects(bulkAction({ kind: 'candidates', ids: ['a', 'b'], action: 'archive', actor, adapters: h.adapters }), { status: 403 })
  assert.equal(h.executed.length, 0)
})

test('invalid transition on any application aborts the whole operation', async () => {
  const h = harness({ a: { id: 'a', stage: 'new' }, b: { id: 'b', stage: 'new' } }, {
    workflow: { validateMove: record => record.id === 'a' ? { from: 'new', to: 'screen' } : null }
  })
  await assert.rejects(bulkAction({ kind: 'applications', ids: ['a', 'b'], action: 'moveStage', payload: { stage: 'screen' }, actor, adapters: h.adapters }), { code: 'BULK_INVALID_TRANSITION' })
  assert.equal(h.executed.length, 0)
})

test('stage planning invokes validator but leaves actual workflow execution to executor', async () => {
  let moved = false
  const h = harness({ a: { id: 'a', stage: 'new' } }, {
    workflow: { validateMove: () => ({ token: 'validated' }), move: async () => { moved = true } }
  })
  await bulkAction({ kind: 'applications', ids: ['a'], action: 'moveStage', payload: { stage: 'screen' }, actor, adapters: h.adapters })
  assert.equal(moved, false)
  assert.deepEqual(h.executed[0].operations[0].workflowTransition, { token: 'validated' })
  assert.equal(h.executed[0].operations[0].patch, undefined)
})

test('duplicate IDs and over-limit batches reject before loading records', async () => {
  let loads = 0
  const h = harness({}, { loadRecord: async () => { loads++; return null } })
  await assert.rejects(bulkAction({ kind: 'jobs', ids: ['x', 'x'], action: 'archive', actor, adapters: h.adapters }), BulkActionError)
  await assert.rejects(bulkAction({ kind: 'jobs', ids: ['a', 'b', 'c'], action: 'archive', actor, adapters: h.adapters, maxBatch: 2 }), { code: 'BULK_LIMIT_EXCEEDED' })
  assert.equal(loads, 0)
})

test('archive is recoverable and owner assignment uses the record-specific owner field', async () => {
  const h = harness({ j: { id: 'j' }, t: { id: 't' } })
  await bulkAction({ kind: 'jobs', ids: ['j'], action: 'assignOwner', payload: { ownerId: 'user-2' }, actor, adapters: h.adapters })
  await bulkAction({ kind: 'tasks', ids: ['t'], action: 'archive', actor, adapters: h.adapters })
  assert.deepEqual(h.executed[0].operations[0].patch, { recruiterId: 'user-2' })
  assert.equal(typeof h.executed[1].operations[0].patch.archivedAt, 'string')
  assert.equal(h.executed[1].operations[0].patch.archivedBy, actor.id)
})
