'use strict'

const SUPPORTED_KINDS = new Set([
  'candidates', 'jobs', 'clients', 'applications', 'offers'
])
const VISIBILITIES = new Set(['team', 'private'])

class LinkedNoteError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'LinkedNoteError'
    this.status = status
  }
}

/** Validate note fields and build a canonical value. Identity always comes from the server. */
function validateLinkedNote(input, { authorId, id, at = new Date().toISOString() } = {}) {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['Note must be an object.'] }
  const relatedKind = input.relatedKind
  const relatedId = typeof input.relatedId === 'string' ? input.relatedId.trim() : ''
  if (!SUPPORTED_KINDS.has(relatedKind)) errors.push('Choose a supported record type for this note.')
  if (!relatedId || relatedId.length > 160) errors.push('A related record ID of at most 160 characters is required.')
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (!body || body.length > 10000) errors.push('Note body must contain between 1 and 10000 characters.')
  const visibility = input.visibility == null ? 'team' : input.visibility
  if (!VISIBILITIES.has(visibility)) errors.push('Visibility must be team or private.')
  if (typeof authorId !== 'string' || !authorId.trim()) errors.push('A server authenticated author is required.')
  if (errors.length) return { valid: false, errors }
  return {
    valid: true, errors: [],
    value: { ...(id ? { id } : {}), relatedKind, relatedId, body, visibility, authorId: authorId.trim(), createdAt: at }
  }
}

function createLinkedNote(input, options = {}) {
  const result = validateLinkedNote(input, options)
  if (!result.valid) throw new LinkedNoteError(result.errors.join(' '))
  return result.value
}

/** Patch only body and visibility; a note's parent and author are immutable. */
function updateLinkedNote(note, patch) {
  if (!note || !patch || typeof patch !== 'object' || Array.isArray(patch)) throw new LinkedNoteError('A note and update object are required.')
  for (const key of ['relatedKind', 'relatedId', 'authorId', 'id', 'createdAt']) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== note[key]) throw new LinkedNoteError(`${key} is immutable.`, 409)
  }
  const candidate = { ...note, ...patch }
  const checked = validateLinkedNote(candidate, { authorId: note.authorId, id: note.id, at: note.createdAt })
  if (!checked.valid) throw new LinkedNoteError(checked.errors.join(' '))
  return { ...note, body: checked.value.body, visibility: checked.value.visibility, updatedAt: patch.updatedAt || new Date().toISOString() }
}

/** Team notes are visible to eligible viewers; private notes only to their author/admin. */
function canReadLinkedNote(note, viewer, { canAccessRelated = () => true, isAdmin = false } = {}) {
  if (!note || !viewer?.id) return false
  if (note.visibility === 'private' && note.authorId !== viewer.id && !isAdmin) return false
  return canAccessRelated(note.relatedKind, note.relatedId, viewer) === true
}

function scopeLinkedNotes(notes, viewer, options = {}) {
  return (Array.isArray(notes) ? notes : []).filter(note => canReadLinkedNote(note, viewer, options))
}

const EVENT_FIELDS = {
  audit: ['action', 'createdAt', 'at', 'actorId', 'recordKind', 'recordId'],
  task: ['title', 'status', 'createdAt', 'updatedAt', 'dueAt', 'completedAt', 'assigneeId'],
  interview: ['status', 'scheduledAt', 'completedAt', 'updatedAt', 'interviewerId'],
  offer: ['status', 'createdAt', 'updatedAt', 'sentAt', 'respondedAt'],
  application: ['stage', 'status', 'createdAt', 'updatedAt'],
  note: ['body', 'createdAt', 'authorId', 'visibility']
}
const TIMESTAMP_FIELDS = ['at', 'createdAt', 'updatedAt', 'scheduledAt', 'completedAt', 'dueAt', 'sentAt', 'respondedAt']

function pick(source, keys) {
  const value = {}
  for (const key of keys) if (source?.[key] != null && ['string', 'number', 'boolean'].includes(typeof source[key])) value[key] = source[key]
  return value
}

function timestampOf(row) {
  for (const key of TIMESTAMP_FIELDS) {
    const value = Date.parse(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

/** Return a newest-first, allowlisted activity feed. Sensitive payloads never enter the projection. */
function projectTimeline({ audit = [], notes = [], tasks = [], interviews = [], offers = [], applications = [] } = {}, { viewer, canReadNote = note => canReadLinkedNote(note, viewer) } = {}) {
  const rows = []
  const append = (items, type) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue
      if (type === 'note' && !canReadNote(item)) continue
      const data = pick(item, EVENT_FIELDS[type])
      // Note text is the sole freeform content in the feed; omit it for private notes unless authorized.
      if (type === 'note' && item.visibility === 'private' && viewer?.id !== item.authorId) delete data.body
      rows.push({ type, id: item.id || null, relatedKind: item.relatedKind || item.recordKind || null,
        relatedId: item.relatedId || item.recordId || null, occurredAt: item.at || item.createdAt || item.updatedAt || item.scheduledAt || null, ...data })
    }
  }
  append(audit, 'audit'); append(notes, 'note'); append(tasks, 'task'); append(interviews, 'interview'); append(offers, 'offer'); append(applications, 'application')
  return rows.sort((a, b) => timestampOf(b) - timestampOf(a) || String(a.id || '').localeCompare(String(b.id || '')))
}

module.exports = { SUPPORTED_KINDS, LinkedNoteError, validateLinkedNote, createLinkedNote, updateLinkedNote, canReadLinkedNote, scopeLinkedNotes, projectTimeline }
