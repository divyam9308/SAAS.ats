'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateSavedView, applySavedView } = require('./saved-views')

const users = [{ id: 'recruiter-1' }, { id: 'recruiter-2' }]

test('saved view validation only accepts known record types and declarative filters', () => {
  const valid = validateSavedView({ name: 'Stale applications', kind: 'applications', filters: { owner: 'me', stage: 'screening', aging: { minDays: 5, basis: 'stageEnteredAt' } } }, { users })
  assert.equal(valid.valid, true, valid.errors.join('; '))
  assert.equal(valid.value.visibility, 'private')
  assert.equal(validateSavedView({ name: 'Any field query', kind: 'applications', filters: { arbitraryPath: '$.salary' } }, { users }).valid, false)
  assert.equal(validateSavedView({ name: 'Wrong stage target', kind: 'jobs', filters: { stage: 'screening' } }, { users }).valid, false)
  assert.equal(validateSavedView({ name: 'Invalid age range', kind: 'tasks', filters: { aging: { minDays: 90, maxDays: 2 } } }, { users }).valid, false)
  assert.equal(validateSavedView({ name: 'Other owner', kind: 'tasks', filters: { owner: 'not-a-user' } }, { users }).valid, false)
  assert.equal(validateSavedView({ name: 'Shared', kind: 'jobs', visibility: 'shared' }, { allowShared: false }).valid, false)
})

test('saved view query is persisted as trimmed text and rejects unsupported or non-string values', () => {
  const valid = validateSavedView({ name: 'Search', kind: 'candidates', filters: { query: '  Ada Lovelace  ' } })
  assert.equal(valid.valid, true, valid.errors.join('; '))
  assert.equal(valid.value.filters.query, 'Ada Lovelace')
  assert.equal(validateSavedView({ name: 'Bad query', kind: 'candidates', filters: { query: 42 } }).valid, false)
  assert.equal(validateSavedView({ name: 'Long query', kind: 'candidates', filters: { query: 'x'.repeat(161) } }).valid, false)
  assert.equal(validateSavedView({ name: 'Unsupported', kind: 'candidates', filters: { query: 'x', mystery: true } }).valid, false)
})

test('saved view filtering applies owner, status, stage, and age without evaluating arbitrary fields', () => {
  const now = Date.parse('2026-09-24T00:00:00.000Z')
  const rows = [
    { id: 'old', ownerId: 'recruiter-1', status: 'active', stage: 'screening', updatedAt: '2026-09-15T00:00:00.000Z', stageHistory: [{ stageId: 'screening', enteredAt: '2026-09-10T00:00:00.000Z' }] },
    { id: 'recent', ownerId: 'recruiter-1', status: 'active', stage: 'screening', updatedAt: '2026-09-23T00:00:00.000Z', stageHistory: [{ stageId: 'screening', enteredAt: '2026-09-22T00:00:00.000Z' }] },
    { id: 'other', ownerId: 'recruiter-2', status: 'active', stage: 'screening', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'closed', ownerId: 'recruiter-1', status: 'hired', stage: 'hired', updatedAt: '2026-09-01T00:00:00.000Z' }
  ]
  const found = applySavedView(rows, { owner: 'me', status: 'active', stage: 'screening', aging: { minDays: 5, basis: 'stageEnteredAt' } }, { actorId: 'recruiter-1', now })
  assert.deepEqual(found.map(row => row.id), ['old'])
  assert.deepEqual(applySavedView(rows, { owner: 'recruiter-2' }, { actorId: 'recruiter-1', now }).map(row => row.id), ['other'])
})

test('stage-entered aging uses latest entry for current stage and safely excludes undated records', () => {
  const now = Date.parse('2026-09-24T00:00:00.000Z')
  const rows = [
    { id: 'moved-back', stage: 'screening', updatedAt: '2026-09-01T00:00:00Z', stageHistory: [{ stageId: 'screening', enteredAt: '2026-09-01T00:00:00Z' }, { stageId: 'interview', enteredAt: '2026-09-10T00:00:00Z' }, { stageId: 'screening', enteredAt: '2026-09-20T00:00:00Z' }] },
    { id: 'undated', stage: 'screening' }
  ]
  assert.deepEqual(applySavedView(rows, { aging: { minDays: 5, basis: 'stageEnteredAt' } }, { now }).map(row => row.id), [])
})

test('saved-view query searches safe primitive display values and arrays case-insensitively', () => {
  const rows = [
    { id: 'match-name', name: 'Ada Lovelace', status: 'active' },
    { id: 'match-array', name: 'Grace Hopper', tags: ['Compiler Pioneer', 'navy'] },
    { id: 'no-match', name: 'Katherine Johnson' }
  ]
  assert.deepEqual(applySavedView(rows, { query: 'ada' }).map(row => row.id), ['match-name'])
  assert.deepEqual(applySavedView(rows, { query: 'PIONEER' }).map(row => row.id), ['match-array'])
})

test('saved-view query does not search sensitive or nested object values', () => {
  const rows = [
    { id: 'salary-only', name: 'Candidate A', salary: 'needle' },
    { id: 'private-note-only', name: 'Candidate B', privateNotes: 'needle' },
    { id: 'document-only', name: 'Candidate C', documents: [{ name: 'needle file' }] },
    { id: 'token-only', name: 'Candidate D', token: 'needle' },
    { id: 'safe-name', name: 'Needle Candidate', compensation: { label: 'needle' } }
  ]
  assert.deepEqual(applySavedView(rows, { query: 'needle' }).map(row => row.id), ['safe-name'])
})
