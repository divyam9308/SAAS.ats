'use strict'

const DAY_MS = 86400000
const ALLOWED_KINDS = new Set([
  'jobs', 'candidates', 'applications', 'requisitions', 'approvals', 'interviews',
  'feedback', 'offers', 'onboarding', 'tasks', 'notifications', 'clients', 'contacts',
  'submissions', 'placements', 'invoices', 'talentPools', 'referrals', 'notes',
  'workforceTargets'
])
const OWNER_FIELDS = ['ownerId', 'recruiterId', 'hiringManagerId', 'assignedTo', 'assigneeId', 'userId', 'createdBy']
const AGE_BASES = new Set(['createdAt', 'updatedAt', 'stageEnteredAt'])
const SEARCH_EXCLUDED_KEY = /(?:salary|compensation|private.?notes?|tokens?|secrets?|passwords?|documents?|^_)/i

function matchesQuery(value, query) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true

  function includesSafeText(item, key) {
    if (key && SEARCH_EXCLUDED_KEY.test(key)) return false
    if (typeof item === 'string') return item.toLocaleLowerCase().includes(needle)
    if (typeof item === 'number' || typeof item === 'boolean') return String(item).toLocaleLowerCase().includes(needle)
    if (Array.isArray(item)) return item.some(entry => includesSafeText(entry))
    if (!item || typeof item !== 'object') return false
    return Object.entries(item).some(([childKey, child]) => includesSafeText(child, childKey))
  }

  return includesSafeText(value)
}

function validateSavedView(input, { users = [], allowShared = true } = {}) {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['View must be an object.'] }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 80) errors.push('Name must contain between 1 and 80 characters.')
  if (!ALLOWED_KINDS.has(input.kind)) errors.push('Choose a supported record type for this view.')
  if (input.description != null && (typeof input.description !== 'string' || input.description.length > 240)) errors.push('Description must be 240 characters or fewer.')
  const visibility = input.visibility || 'private'
  if (!['private', 'shared'].includes(visibility)) errors.push('Visibility must be private or shared.')
  if (visibility === 'shared' && !allowShared) errors.push('Shared views are disabled for this organization.')

  const filters = input.filters == null ? {} : input.filters
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) errors.push('Filters must be an object.')
  else {
    const unsupported = Object.keys(filters).filter(key => !['owner', 'status', 'stage', 'aging', 'query'].includes(key))
    if (unsupported.length) errors.push(`Unsupported filter: ${unsupported[0]}.`)
    if (filters.owner != null) {
      const owner = filters.owner
      if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) errors.push('Owner filter must be “me” or a configured user ID.')
      else if (owner !== 'me' && users.length && !users.some(user => user.id === owner)) errors.push('Owner filter must refer to a configured user.')
    }
    for (const field of ['status', 'stage']) {
      if (filters[field] != null && (typeof filters[field] !== 'string' || !filters[field].trim() || filters[field].length > 80)) errors.push(`${field} filter must be a non-empty value of at most 80 characters.`)
    }
    if (filters.query != null && (typeof filters.query !== 'string' || filters.query.trim().length > 160)) errors.push('Query filter must be text of at most 160 characters.')
    if (filters.stage != null && input.kind !== 'applications') errors.push('Stage filters can only be used for applications.')
    if (filters.aging != null) {
      const aging = filters.aging
      if (!aging || typeof aging !== 'object' || Array.isArray(aging)) errors.push('Aging filter must be an object.')
      else {
        const keys = Object.keys(aging).filter(key => !['minDays', 'maxDays', 'basis'].includes(key))
        if (keys.length) errors.push(`Unsupported aging option: ${keys[0]}.`)
        if (aging.basis != null && !AGE_BASES.has(aging.basis)) errors.push('Aging basis must be createdAt, updatedAt, or stageEnteredAt.')
        for (const bound of ['minDays', 'maxDays']) {
          if (aging[bound] != null && (!Number.isInteger(aging[bound]) || aging[bound] < 0 || aging[bound] > 3650)) errors.push(`${bound} must be a whole number from 0 to 3650.`)
        }
        if (Number.isInteger(aging.minDays) && Number.isInteger(aging.maxDays) && aging.minDays > aging.maxDays) errors.push('minDays cannot exceed maxDays.')
      }
    }
  }
  const normalizedFilters = filters && typeof filters === 'object' && !Array.isArray(filters) ? { ...filters, ...(typeof filters.query === 'string' ? { query: filters.query.trim() } : {}) } : {}
  return { valid: errors.length === 0, errors, value: { name, description: input.description?.trim() || '', kind: input.kind, visibility, filters: normalizedFilters } }
}

function enteredStageAt(record) {
  const history = Array.isArray(record.stageHistory) ? record.stageHistory : Array.isArray(record.stageChanges) ? record.stageChanges : []
  const matching = history.filter(entry => {
    const stage = typeof entry === 'string' ? entry : entry?.stageId || entry?.stage || entry?.to
    return stage === record.stage
  }).at(-1)
  return typeof matching === 'object' && matching ? (matching.enteredAt || matching.at || matching.createdAt || null) : null
}

function ageAnchor(record, basis) {
  if (basis === 'stageEnteredAt') return enteredStageAt(record)
  return record[basis || 'updatedAt'] || null
}

function applySavedView(rows, filters = {}, { actorId, now = Date.now() } = {}) {
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (filters.owner) {
      const ownerId = filters.owner === 'me' ? actorId : filters.owner
      if (!OWNER_FIELDS.some(field => row[field] === ownerId)) return false
    }
    if (filters.status != null && row.status !== filters.status) return false
    if (filters.stage != null && row.stage !== filters.stage) return false
    if (filters.query != null && !matchesQuery(row, filters.query)) return false
    if (filters.aging) {
      const stamp = Date.parse(ageAnchor(row, filters.aging.basis))
      if (!Number.isFinite(stamp)) return false
      const days = Math.max(0, Math.floor((now - stamp) / DAY_MS))
      if (filters.aging.minDays != null && days < filters.aging.minDays) return false
      if (filters.aging.maxDays != null && days > filters.aging.maxDays) return false
    }
    return true
  })
}

module.exports = { ALLOWED_KINDS, validateSavedView, applySavedView }
