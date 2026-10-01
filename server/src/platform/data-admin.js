'use strict'

const { now } = require('./database')

class DataAdminError extends Error {
  constructor(message, status = 422, details = null) { super(message); this.status = status; this.details = details }
}

const REQUIRED_FIELDS = {
  jobs: [['title']],
  candidates: [['email'], ['name', 'fullName', 'firstName']],
  clients: [['name']],
  requisitions: [['title']],
  applications: [['candidateId'], ['jobId'], ['stage']]
}
const CANDIDATE_LINKS = ['applications', 'interviews', 'feedback', 'offers', 'referrals', 'notes', 'submissions', 'placements', 'documents', 'outbox']
const SENSITIVE_CANDIDATE_FIELDS = [
  'email', 'alternateEmails', 'phone', 'alternatePhones', 'profileUrl', 'linkedin', 'portfolio', 'address', 'fullName',
  'currentSalary', 'expectedSalary', 'salaryExpectation', 'currentCompensation', 'privateNotes', 'documents', 'resume'
]
const PII_KEY = /(?:email|phone|mobile|telephone|profile.?url|linkedin|portfolio|address|salary|compensation|birth|dob|ssn|tax.?id|passport|first.?name|last.?name|full.?name|candidate.?name|person.?name|resume|private.?notes?|filename|original.?name|owner.?name|uploaded.?by.?name)/i
const REDACTED = '[redacted by approved privacy request]'
const cleanString = value => String(value ?? '').trim()
const asArray = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]

function redactPii(value, key = '') {
  if (PII_KEY.test(key)) return null
  if (Array.isArray(value)) return value.map(item => redactPii(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactPii(childValue, childKey)]))
}

function sanitizeArchivedDocument(document) {
  const clean = redactPii(document)
  for (const key of ['filename', 'originalName', 'title', 'description', 'metadata', 'notes', 'ownerName', 'uploadedByName', 'storageName']) {
    if (key in clean) clean[key] = key === 'metadata' ? {} : null
  }
  return clean
}

function parseCsv(input, options = {}) {
  if (typeof input !== 'string') throw new DataAdminError('CSV input must be text.', 400)
  const source = input.replace(/^\uFEFF/, '')
  const delimiter = options.delimiter || ','
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\r' || delimiter === '\n') throw new DataAdminError('CSV delimiter must be one ordinary character.', 400)
  const rows = [], row = []
  let cell = '', quoted = false, afterQuote = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') { quoted = false; afterQuote = true }
      else cell += char
      continue
    }
    if (afterQuote && char !== delimiter && char !== '\r' && char !== '\n' && !/[\t ]/.test(char)) throw new DataAdminError(`Unexpected character after a quoted CSV value at offset ${i}.`, 422)
    if (char === '"' && cell === '') { quoted = true; afterQuote = false }
    else if (char === delimiter) { row.push(cell.trim()); cell = ''; afterQuote = false }
    else if (char === '\r' || char === '\n') {
      row.push(cell.trim()); cell = ''; afterQuote = false
      if (row.some(value => value !== '')) rows.push(row.splice(0))
      if (char === '\r' && source[i + 1] === '\n') i++
    } else { cell += char; afterQuote = false }
  }
  if (quoted) throw new DataAdminError('CSV ends inside a quoted value.', 422)
  row.push(cell.trim())
  if (row.some(value => value !== '')) rows.push(row)
  if (!rows.length) return { headers: [], rows: [] }
  const headers = rows.shift().map(value => value.trim())
  if (headers.some(value => !value)) throw new DataAdminError('CSV column names must not be empty.', 422)
  if (new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new DataAdminError('CSV column names must be unique.', 422)
  const records = [], errors = []
  rows.forEach((cells, index) => {
    if (cells.length > headers.length && cells.slice(headers.length).some(Boolean)) errors.push({ row: index + 2, message: `Found ${cells.length} cells for ${headers.length} columns.` })
    const record = {}
    headers.forEach((header, cellIndex) => { record[header] = cells[cellIndex] ?? '' })
    records.push(record)
  })
  return { headers, rows: records, errors }
}

function csvSafeValue(value) {
  if (value == null) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`
  return text
}
function stringifyCsv(rows, fields) {
  const records = Array.isArray(rows) ? rows : []
  const columns = fields || [...new Set(records.flatMap(row => Object.keys(row || {})))]
  const quote = value => {
    const text = csvSafeValue(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [columns.map(quote).join(','), ...records.map(record => columns.map(field => quote(record?.[field])).join(','))].join('\r\n')
}

// fieldMapping maps each source header to a destination field, e.g. { 'Email Address': 'email' }.
function mapImportRows(rows, fieldMapping = {}) {
  return (rows || []).map((row, index) => {
    const mapped = {}
    for (const [source, value] of Object.entries(row || {})) {
      const target = Object.hasOwn(fieldMapping || {}, source) ? fieldMapping[source] : source
      if (typeof target !== 'string' || !target.trim() || ['__proto__', 'constructor', 'prototype', '__importRow'].includes(target)) continue
      mapped[target] = value
    }
    return { ...mapped, __importRow: index + 2 }
  })
}

function normalizeKey(key, value) {
  if (value == null || value === '') return ''
  const kind = String(key).toLowerCase()
  if (/email/.test(kind)) return cleanString(value).toLowerCase()
  if (/phone|mobile|telephone/.test(kind)) return cleanString(value).replace(/\D/g, '')
  if (/url|linkedin|profile/.test(kind)) return cleanString(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0].replace(/\/+$/, '')
  return cleanString(Array.isArray(value) ? value.join(' ') : value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
function duplicateKeysFor(config, kind) {
  const configured = config?.data?.duplicateKeys
  const keys = Array.isArray(configured) && configured.length ? configured : ['email', 'phone', 'profileUrl']
  return [...new Set([...keys, ...(kind === 'candidates' ? ['name'] : [])])]
}
function findDuplicates(record, records, keys = ['email', 'phone', 'profileUrl'], options = {}) {
  const supportingInput = options.supportingFields
  const supporting = Array.isArray(supportingInput) ? supportingInput : typeof supportingInput === 'string' ? [supportingInput] : ['currentTitle', 'company', 'currentCompany', 'employer', 'phone']
  const matches = []
  for (const candidate of records || []) {
    if (!candidate || candidate.id && record?.id && candidate.id === record.id) continue
    const matchedBy = []
    for (const key of keys.filter(item => !['name', 'fullName'].includes(item))) {
      const left = normalizeKey(key, record?.[key]), right = normalizeKey(key, candidate?.[key])
      if (left && right && left === right) matchedBy.push(key)
    }
    // A name alone is weak evidence. Require one configured corroborating attribute.
    const nameKey = ['name', 'fullName'].find(key => keys.includes(key) && normalizeKey(key, record?.[key]) && normalizeKey(key, record?.[key]) === normalizeKey(key, candidate?.[key]))
    if (nameKey) {
      const support = supporting.find(key => normalizeKey(key, record?.[key]) && normalizeKey(key, record?.[key]) === normalizeKey(key, candidate?.[key]))
      if (support) matchedBy.push(`${nameKey}+${support}`)
      else {
        const nameAt = matchedBy.indexOf(nameKey)
        if (nameAt >= 0) matchedBy.splice(nameAt, 1)
      }
    }
    if (matchedBy.length) matches.push({ record: candidate, matchedBy: [...new Set(matchedBy)] })
  }
  return matches
}

function validateImportRows(kind, rows, { config = {}, existing = [], validateRecord, mapping = {}, csvErrors = [] } = {}) {
  const mapped = mapImportRows(rows, mapping)
  const errors = [...csvErrors]
  const duplicates = []
  const seenIds = new Set()
  // Two input columns targeting the same field are ambiguous: mapImportRows
  // necessarily keeps only one value, so reject rather than silently losing data.
  const sourcesByTarget = new Map()
  for (const [source, target] of Object.entries(mapping || {})) {
    if (typeof target !== 'string' || !target.trim() || ['__proto__', 'constructor', 'prototype', '__importRow'].includes(target)) {
      errors.push({ field: source, message: 'Field mapping target is not allowed.' })
      continue
    }
    const sources = sourcesByTarget.get(target) || []
    sources.push(source)
    sourcesByTarget.set(target, sources)
  }
  for (const [target, sources] of sourcesByTarget) {
    if (sources.length > 1) errors.push({ field: target, message: `Multiple source columns map to “${target}”: ${sources.join(', ')}.` })
  }
  const keys = duplicateKeysFor(config, kind)
  const support = config?.data?.duplicateSupportingFields || config?.data?.duplicateSupportAttributes
  mapped.forEach((record, index) => {
    const rowNumber = record.__importRow || index + 2
    delete record.__importRow
    for (const requiredGroup of REQUIRED_FIELDS[kind] || []) {
      if (!requiredGroup.some(field => cleanString(record[field]))) errors.push({ row: rowNumber, field: requiredGroup.join('|'), message: `Requires one of: ${requiredGroup.join(', ')}.` })
    }
    for (const field of config?.customFields?.[kind] || []) {
      if (field.required && !cleanString(record.customFields?.[field.id] ?? record[field.id])) errors.push({ row: rowNumber, field: field.id, message: `${field.label || field.id} is required.` })
    }
    if (record.id) {
      if (seenIds.has(record.id)) errors.push({ row: rowNumber, field: 'id', message: 'Import contains a repeated record ID.' })
      if ((existing || []).some(item => item.id === record.id)) errors.push({ row: rowNumber, field: 'id', message: 'Record ID already exists.' })
      seenIds.add(record.id)
    }
    if (typeof validateRecord === 'function') {
      const result = validateRecord(kind, record, rowNumber)
      if (result === false) errors.push({ row: rowNumber, message: 'Record failed validation.' })
      else if (Array.isArray(result)) errors.push(...result.map(message => ({ row: rowNumber, message })))
    }
    const found = findDuplicates(record, [...(existing || []), ...mapped.slice(0, index)], keys, { supportingFields: support })
    if (found.length) duplicates.push({ row: rowNumber, record, matches: found.map(match => ({ id: match.record.id || null, matchedBy: match.matchedBy })) })
  })
  return { valid: errors.length === 0 && duplicates.length === 0, rows: mapped, errors, duplicates }
}

function createMergePlan(kind, primary, duplicate, { store, linkedKinds = CANDIDATE_LINKS } = {}) {
  if (!primary || !duplicate || !primary.id || !duplicate.id || primary.id === duplicate.id) throw new DataAdminError('Choose two distinct existing records to merge.', 422)
  const merged = { ...primary }
  const conflicts = []
  for (const [key, value] of Object.entries(duplicate)) {
    if (['id', 'createdAt', 'updatedAt', 'archivedAt', 'createdBy', 'updatedBy'].includes(key) || value == null || value === '') continue
    const current = merged[key]
    if (current == null || current === '') merged[key] = value
    else if (JSON.stringify(current) !== JSON.stringify(value)) conflicts.push({ field: key, primary: current, duplicate: value })
  }
  if (kind === 'candidates') {
    merged.skills = [...new Set([...asArray(primary.skills), ...asArray(duplicate.skills)])]
    merged.tags = [...new Set([...asArray(primary.tags), ...asArray(duplicate.tags)])]
    merged.alternateEmails = [...new Set([...asArray(primary.alternateEmails), ...asArray(duplicate.alternateEmails), ...(duplicate.email && duplicate.email !== primary.email ? [duplicate.email] : [])])]
    merged.alternatePhones = [...new Set([...asArray(primary.alternatePhones), ...asArray(duplicate.alternatePhones), ...(duplicate.phone && duplicate.phone !== primary.phone ? [duplicate.phone] : [])])]
    merged.mergedFrom = [...new Set([...(primary.mergedFrom || []), ...(duplicate.mergedFrom || []), duplicate.id])]
  }
  const linked = {}
  if (store) for (const relatedKind of linkedKinds) {
    linked[relatedKind] = store.list(relatedKind).filter(row => row.candidateId === duplicate.id || (row.relatedKind === kind && row.relatedId === duplicate.id)).map(row => row.id)
  }
  return { kind, primaryId: primary.id, duplicateId: duplicate.id, merged, conflicts, linked }
}

function mergeRecords(store, kind, primaryId, duplicateId, { actor = 'system', audit = () => {}, linkedKinds = CANDIDATE_LINKS } = {}) {
  const primary = store.get(kind, primaryId), duplicate = store.get(kind, duplicateId)
  if (!primary || !duplicate) throw new DataAdminError('Primary and duplicate records must both exist and be active.', 404)
  const plan = createMergePlan(kind, primary, duplicate, { store, linkedKinds })
  for (const relatedKind of Object.keys(plan.linked)) for (const id of plan.linked[relatedKind]) {
    const row = store.get(relatedKind, id)
    if (!row) continue
    store.put(relatedKind, { ...row, ...(row.candidateId === duplicateId ? { candidateId: primaryId } : {}), ...(row.relatedKind === kind && row.relatedId === duplicateId ? { relatedId: primaryId } : {}) }, actor)
  }
  const merged = store.put(kind, { ...plan.merged, mergedAt: now(), mergeReview: { duplicateId, conflicts: plan.conflicts } }, actor)
  const archived = store.archive(kind, duplicateId)
  audit('record.merged', kind, primaryId, { duplicateId, linked: Object.fromEntries(Object.entries(plan.linked).map(([key, ids]) => [key, ids.length])), conflicts: plan.conflicts.map(item => item.field) })
  return { record: merged, archived, plan }
}

function archiveRecord(store, kind, id, { actor = 'system', reason = '', audit = () => {} } = {}) {
  const record = store.get(kind, id)
  if (!record) throw new DataAdminError('Record not found or already archived.', 404)
  const archived = store.archive(kind, id)
  audit('record.archived', kind, id, { reason, actor })
  return archived
}
function restoreRecord(store, kind, id, { actor = 'system', audit = () => {}, config = {}, duplicateKeys } = {}) {
  const record = store.get(kind, id, { includeArchived: true })
  if (!record?.archivedAt) throw new DataAdminError('Archived record not found.', 404)
  // Restoring reintroduces the row into active workflows. Do not bypass the
  // duplicate guard that import and candidate-creation flows apply.
  if (kind === 'candidates') {
    const collisions = findDuplicates(record, store.list(kind), duplicateKeys || duplicateKeysFor(config, kind))
    if (collisions.length) throw new DataAdminError('Candidate cannot be restored while matching active records exist.', 409, {
      duplicates: collisions.map(match => ({ id: match.record.id || null, matchedBy: match.matchedBy }))
    })
  }
  const restored = store.put(kind, { ...record, restoredAt: now() }, actor)
  audit('record.restored', kind, id, { previousArchivedAt: record.archivedAt })
  return restored
}
function anonymizeRecord(store, kind, id, { actor = 'system', approved = false, config = {}, audit = () => {}, fields, onDocumentArchived = () => {} } = {}) {
  if (config?.privacy?.deletionApprovalRequired !== false && !approved) throw new DataAdminError('Deletion approval is required before anonymization.', 403)
  const record = store.get(kind, id)
  if (!record) throw new DataAdminError('Record not found or already archived.', 404)
  if (kind !== 'candidates') throw new DataAdminError('Anonymization is currently supported for candidate records only.', 422)
  const redacted = redactPii(record)
  // Store.put merges with the prior JSON record, so explicitly overwrite sensitive
  // values to null instead of omitting their keys.
  for (const key of fields || SENSITIVE_CANDIDATE_FIELDS) if (key in redacted) redacted[key] = null
  Object.assign(redacted, { name: 'Anonymized candidate', firstName: 'Anonymized', lastName: '', anonymized: true, anonymizedAt: now(), consentStatus: 'withdrawn', status: 'anonymized' })
  const result = store.put(kind, redacted, actor)
  for (const relatedKind of CANDIDATE_LINKS) for (const linked of store.list(relatedKind)) {
    const isLinked = linked.candidateId === id || (linked.relatedKind === kind && linked.relatedId === id)
    if (!isLinked) continue
    if (relatedKind === 'documents') {
      const archived = store.archive('documents', linked.id)
      if (archived) {
        const sanitized = sanitizeArchivedDocument(archived)
        // Let the route's SQL callback scrub the archived JSON in the active
        // transaction; writing through store.put would clear archived_at.
        onDocumentArchived(archived, sanitized)
      }
      continue
    }
    const scrubbed = redactPii(linked)
    for (const field of ['name', 'candidateName', 'personName']) if (field in linked) scrubbed[field] = 'Anonymized candidate'
    for (const field of ['body', 'text', 'content', 'message', 'comment', 'note', 'notes', 'description', 'summary']) {
      if (field in linked && typeof linked[field] === 'string') scrubbed[field] = REDACTED
    }
    scrubbed.anonymizedAt = now()
    store.put(relatedKind, scrubbed, actor)
  }
  audit('candidate.anonymized', kind, id, { fields: fields || SENSITIVE_CANDIDATE_FIELDS })
  return result
}
function documentStorageCleanup(store, { scrubArchivedRow = () => {}, deleteStorage = () => {}, afterCommit = callback => callback() } = {}) {
  return (archivedDocument, sanitizedDocument) => {
    const storageName = archivedDocument?.storageName
    if (!storageName) return false
    if (store.list('documents').some(document => !document.archivedAt && document.storageName === storageName)) return false
    // Caller performs DB-backed JSON scrub in the current transaction. Only the
    // physical-file callback is deferred until its commit succeeds.
    scrubArchivedRow(archivedDocument, sanitizedDocument)
    afterCommit(() => { if (!store.list('documents').some(document => !document.archivedAt && document.storageName === storageName)) deleteStorage(storageName, archivedDocument) })
    return true
  }
}
function deleteOrAnonymize(store, kind, id, { actor = 'system', approved = false, config = {}, audit = () => {}, onDocumentArchived } = {}) {
  if (config?.privacy?.deletionApprovalRequired !== false && !approved) throw new DataAdminError('Deletion approval is required before processing this request.', 403)
  if (config?.privacy?.anonymizeOnDeletion !== false) return anonymizeRecord(store, kind, id, { actor, approved: true, config, audit, onDocumentArchived })
  return archiveRecord(store, kind, id, { actor, reason: 'Approved deletion request', audit })
}

function retentionPlan(store, { config = {}, now: reference = new Date(), kinds = ['candidates'] } = {}) {
  const days = Number(config?.privacy?.retentionDays ?? config?.data?.retentionDays)
  if (!Number.isFinite(days) || days < 1) throw new DataAdminError('A positive retention period must be configured.', 422)
  const cutoff = new Date(reference).getTime() - days * 86400000
  const items = []
  for (const kind of kinds) for (const record of store.list(kind)) {
    const created = new Date(record.createdAt || record.appliedAt || record.updatedAt || '').getTime()
    if (Number.isFinite(created) && created < cutoff && !record.anonymized) items.push({ kind, id: record.id, createdAt: record.createdAt || null, action: config?.privacy?.anonymizeOnDeletion === false ? 'archive' : 'anonymize' })
  }
  return { cutoff: new Date(cutoff).toISOString(), retentionDays: days, items }
}
function applyRetention(store, plan, { actor = 'system', approved = false, config = {}, audit = () => {}, dryRun = true, onDocumentArchived } = {}) {
  if (!plan || !Array.isArray(plan.items)) throw new DataAdminError('A retention plan is required.', 422)
  if (!dryRun && config?.privacy?.deletionApprovalRequired !== false && !approved) throw new DataAdminError('Retention actions require approval.', 403)
  if (dryRun) return { ...plan, dryRun: true, processed: [] }
  const processed = plan.items.map(item => item.action === 'anonymize'
    ? anonymizeRecord(store, item.kind, item.id, { actor, approved: true, config, audit, onDocumentArchived })
    : archiveRecord(store, item.kind, item.id, { actor, reason: 'Retention period expired', audit }))
  return { ...plan, dryRun: false, processed: processed.map((record, index) => ({ id: record.id, kind: plan.items[index].kind })) }
}

function prepareDocumentVersion(store, input, { config = {}, actor = 'system' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DataAdminError('A document record is required.', 422)
  const categories = config?.documents?.categories || config?.taxonomies?.documentCategories || []
  const documentConfig = config?.documents || {}
  const explicitlyReplacing = input.replacesDocumentId != null && input.replacesDocumentId !== ''
  const requested = explicitlyReplacing
    ? store.get('documents', input.replacesDocumentId, { includeArchived: true })
    : null
  if (explicitlyReplacing && !requested) throw new DataAdminError('The document being replaced was not found.', 409)
  const category = input.category || requested?.category || documentConfig.defaultCategory || 'Other'
  if (categories.length && !categories.includes(category)) throw new DataAdminError(`Document category “${category}” is not configured.`, 422)
  const allowedVisibilities = Array.isArray(documentConfig.allowedVisibilities) && documentConfig.allowedVisibilities.length
    ? documentConfig.allowedVisibilities
    : ['public', 'restricted', 'private', 'internal', 'team']
  const matchingParent = doc => doc.relatedKind === input.relatedKind && doc.relatedId === input.relatedId
  const history = store.list('documents', { includeArchived: true })
    .filter(doc => matchingParent(doc) && doc.category === category)
    .sort((a, b) => Number(b.version || 1) - Number(a.version || 1) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
  if (explicitlyReplacing && (!requested || !matchingParent(requested) || requested.category !== category)) {
    throw new DataAdminError('The document being replaced must belong to the same parent record and category.', 409)
  }
  const current = explicitlyReplacing ? requested : history.find(doc => !doc.archivedAt)
  const previous = current || history[0]
  if (previous && documentConfig.allowReplacement !== true) throw new DataAdminError('Document replacement is disabled by configuration.', 409)
  if (input.visibility != null && !allowedVisibilities.includes(input.visibility)) {
    throw new DataAdminError('Document visibility is not allowed by configuration.', 422)
  }
  const visibility = input.visibility || previous?.visibility || documentConfig.defaultVisibility || 'restricted'
  if (!allowedVisibilities.includes(visibility)) throw new DataAdminError('Configured default document visibility is not allowed.', 422)
  if (previous && input.visibility != null && previous.visibility && input.visibility !== previous.visibility) {
    throw new DataAdminError('Document visibility cannot change when replacing a version.', 409)
  }
  if (explicitlyReplacing && history[0]?.id !== requested.id) {
    throw new DataAdminError('Only the latest document version can be replaced.', 409)
  }
  const version = Math.max(0, ...history.map(doc => Number(doc.version) || 0)) + 1
  const versionHistory = history.map(doc => ({
    id: doc.id, version: Number(doc.version) || 1, filename: doc.filename || null,
    mimeType: doc.mimeType || null, size: Number.isFinite(Number(doc.size)) ? Number(doc.size) : null,
    visibility: doc.visibility || null, uploadedAt: doc.uploadedAt || null,
  }))
  const prepared = {
    ...input,
    category,
    visibility,
    version,
    ...(previous ? { previousVersionId: previous.id, rootDocumentId: previous.rootDocumentId || previous.id } : { rootDocumentId: input.id || null }),
    versionHistory,
    ownerId: input.ownerId || actor,
    uploadedAt: input.uploadedAt || now()
  }
  delete prepared.replacesDocumentId
  return prepared
}

module.exports = {
  DataAdminError, parseCsv, stringifyCsv, mapImportRows, normalizeKey, findDuplicates,
  duplicateKeysFor, validateImportRows, createMergePlan, mergeRecords,
  archiveRecord, restoreRecord, anonymizeRecord, deleteOrAnonymize,
  retentionPlan, applyRetention, prepareDocumentVersion, redactPii,
  sanitizeArchivedDocument, documentStorageCleanup
}
