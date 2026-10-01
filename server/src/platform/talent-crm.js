'use strict'

const DAY_MS = 86400000

class TalentCrmError extends Error {
  constructor(message, status = 422) { super(message); this.name = 'TalentCrmError'; this.status = status }
}

const list = value => Array.isArray(value) ? value : []
const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()
const stamp = value => {
  if (!value) return null
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
const isoNow = value => {
  const parsed = stamp(value)
  if (parsed == null) throw new TalentCrmError('A valid date is required.')
  return new Date(parsed).toISOString()
}

function consentGranted(candidate) {
  return candidate?.consent === true || ['granted', 'consented', 'approved'].includes(lower(candidate?.consentStatus))
}

function latestActivity(candidate) {
  return [candidate?.lastActivityAt, candidate?.updatedAt, candidate?.consentAt, candidate?.createdAt, candidate?.appliedAt]
    .map(stamp).filter(value => value != null).reduce((a, b) => Math.max(a, b), -Infinity)
}

function identityKeys(candidate) {
  return [candidate?.id, candidate?.email, candidate?.phone, candidate?.profileUrl, candidate?.linkedin]
    .map(lower).filter(Boolean)
}

function memberMatchesCandidate(member, candidate) {
  const keys = new Set(identityKeys(candidate))
  return (member?.candidateId && member.candidateId === candidate?.id) || identityKeys(member).some(key => keys.has(key))
}

function findPoolMemberDuplicates(pool, candidate) {
  if (!candidate || !identityKeys(candidate).length) return []
  return list(pool?.members).some(member => memberMatchesCandidate(member, candidate) || member?.candidateId === candidate.id) ? [{ kind: 'duplicate' }] : []
}

function addPoolMember(pool, candidate, { actorId, followUpAt = null, note = '', now = new Date() } = {}) {
  if (!pool || typeof pool !== 'object' || !pool.id) throw new TalentCrmError('A valid talent pool is required.', 404)
  if (!candidate || !candidate.id) throw new TalentCrmError('A persisted candidate is required.')
  if (!consentGranted(candidate)) throw new TalentCrmError('Candidate consent is required before adding them to a talent pool.', 403)
  const duplicate = findPoolMemberDuplicates(pool, candidate)
  if (duplicate.length) throw new TalentCrmError('Candidate is already a member of this talent pool.', 409)
  const addedAt = isoNow(now)
  const next = {
    candidateId: candidate.id,
    addedAt,
    addedBy: actorId || null,
    followUpAt: followUpAt ? isoNow(followUpAt) : null,
    note: clean(note),
    consentStatus: lower(candidate.consentStatus) || 'granted',
    consentAt: candidate.consentAt || candidate.consentGrantedAt || null
  }
  return { ...pool, members: [...list(pool.members), next] }
}

function updatePoolMember(pool, candidateId, changes = {}, { actorId, now = new Date() } = {}) {
  const members = list(pool?.members)
  const index = members.findIndex(member => member.candidateId === candidateId)
  if (index < 0) throw new TalentCrmError('Candidate is not a member of this talent pool.', 404)
  const member = members[index]
  const updated = { ...member }
  if (Object.hasOwn(changes, 'followUpAt')) updated.followUpAt = changes.followUpAt ? isoNow(changes.followUpAt) : null
  if (Object.hasOwn(changes, 'note')) updated.note = clean(changes.note)
  updated.updatedAt = isoNow(now)
  updated.updatedBy = actorId || null
  const next = members.slice()
  next[index] = updated
  return { ...pool, members: next }
}

function removePoolMember(pool, candidateId) {
  const members = list(pool?.members)
  if (!members.some(member => member.candidateId === candidateId)) throw new TalentCrmError('Candidate is not a member of this talent pool.', 404)
  return { ...pool, members: members.filter(member => member.candidateId !== candidateId) }
}

const SAFE_CANDIDATE_FIELDS = ['id', 'name', 'fullName', 'firstName', 'lastName', 'title', 'currentTitle', 'skills', 'location', 'city', 'country', 'updatedAt', 'lastActivityAt']

function safeCandidate(candidate) {
  const result = {}
  for (const key of SAFE_CANDIDATE_FIELDS) {
    if (candidate[key] !== undefined) result[key] = candidate[key]
  }
  return result
}

/** Returns only explicitly requested candidates that remain consented and within retention. */
function rediscoverPoolCandidates(pool, candidates, { candidateIds, retentionDays, now = new Date() } = {}) {
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days < 1) throw new TalentCrmError('A positive retention period must be configured.')
  const asOf = stamp(now)
  if (asOf == null) throw new TalentCrmError('A valid rediscovery date is required.')
  const cutoff = asOf - days * DAY_MS
  const memberIds = new Set(list(pool?.members).map(member => member.candidateId).filter(Boolean))
  const requestedIds = candidateIds == null ? memberIds : new Set(list(candidateIds))
  const members = new Map(list(pool?.members).map(member => [member.candidateId, member]))
  return list(candidates).filter(candidate => {
    if (!candidate?.id || !memberIds.has(candidate.id) || !requestedIds.has(candidate.id)) return false
    if (!consentGranted(candidate) || candidate.anonymized || candidate.archivedAt || lower(candidate.status) === 'anonymized') return false
    const activity = latestActivity(candidate)
    return Number.isFinite(activity) && activity >= cutoff
  }).map(candidate => ({
    ...safeCandidate(candidate),
    poolMember: { candidateId: candidate.id, followUpAt: members.get(candidate.id)?.followUpAt || null }
  }))
}

module.exports = { TalentCrmError, consentGranted, findPoolMemberDuplicates, addPoolMember, updatePoolMember, removePoolMember, rediscoverPoolCandidates }
