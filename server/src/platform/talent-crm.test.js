'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { TalentCrmError, findPoolMemberDuplicates, addPoolMember, updatePoolMember, removePoolMember, rediscoverPoolCandidates } = require('./talent-crm')

const pool = { id: 'pool-1', name: 'Design', members: [] }
const candidates = [
  { id: 'c1', name: 'Ari Singh', email: 'ari@example.test', title: 'Designer', skills: ['Figma'], location: 'London', consentStatus: 'granted', consentAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', phone: 'secret', salary: 123 },
  { id: 'c2', name: 'No Consent', consentStatus: 'withdrawn', updatedAt: '2026-09-20T00:00:00Z' },
  { id: 'c3', name: 'Old Consent', consentStatus: 'granted', updatedAt: '2025-01-01T00:00:00Z' },
  { id: 'c4', name: 'Anonymized', consentStatus: 'granted', status: 'anonymized', updatedAt: '2026-09-20T00:00:00Z' }
]

test('membership and follow-up live inside the existing pool record', () => {
  const added = addPoolMember(pool, candidates[0], { actorId: 'u1', followUpAt: '2026-10-01T00:00:00Z', note: 'Check in', now: '2026-09-24T00:00:00Z' })
  assert.equal(added.id, pool.id)
  assert.equal(added.members.length, 1)
  assert.deepEqual(Object.keys(added.members[0]).sort(), ['addedAt', 'addedBy', 'candidateId', 'consentAt', 'consentStatus', 'followUpAt', 'note'].sort())
  assert.equal(added.members[0].candidateId, 'c1')
  assert.equal(pool.members.length, 0)
  const updated = updatePoolMember(added, 'c1', { followUpAt: null, note: 'Done' }, { actorId: 'u2', now: '2026-09-25T00:00:00Z' })
  assert.equal(updated.members[0].followUpAt, null)
  assert.equal(updated.members[0].note, 'Done')
  assert.equal(updated.members[0].updatedBy, 'u2')
  assert.equal(removePoolMember(updated, 'c1').members.length, 0)
})

test('consent is required and candidate duplicates are guarded without leaking identity', () => {
  assert.throws(() => addPoolMember(pool, candidates[1]), error => error instanceof TalentCrmError && error.status === 403)
  const added = addPoolMember(pool, candidates[0])
  assert.deepEqual(findPoolMemberDuplicates(added, candidates[0]), [{ kind: 'duplicate' }])
  assert.throws(() => addPoolMember(added, candidates[0]), error => error.status === 409)
})

test('rediscovery returns scoped, safe candidates only when consent and retention remain valid', () => {
  const withMembers = { ...pool, members: ['c1', 'c2', 'c3', 'c4'].map(candidateId => ({ candidateId })) }
  const result = rediscoverPoolCandidates(withMembers, candidates, { retentionDays: 90, now: '2026-09-24T00:00:00Z' })
  assert.deepEqual(result.map(candidate => candidate.id), ['c1'])
  assert.equal(result[0].poolMember.candidateId, 'c1')
  assert.equal('email' in result[0], false)
  assert.equal('phone' in result[0], false)
  assert.equal('salary' in result[0], false)
  assert.deepEqual(rediscoverPoolCandidates(withMembers, candidates, { candidateIds: ['c2'], retentionDays: 90, now: '2026-09-24T00:00:00Z' }), [])
  assert.throws(() => rediscoverPoolCandidates(withMembers, candidates, { retentionDays: 0 }), error => error.status === 422)
})
