'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DataAdminError, parseCsv, stringifyCsv, mapImportRows, findDuplicates,
  validateImportRows, createMergePlan, mergeRecords, archiveRecord,
  restoreRecord, anonymizeRecord, deleteOrAnonymize, retentionPlan,
  applyRetention, prepareDocumentVersion, documentStorageCleanup
} = require('./data-admin')

function memoryStore(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([kind, records]) => [kind, new Map(records.map(row => [row.id, structuredClone(row)]))]))
  let n = 0
  const getTable = kind => { if (!tables.has(kind)) tables.set(kind, new Map()); return tables.get(kind) }
  return {
    get(kind, id, { includeArchived = false } = {}) {
      const value = getTable(kind).get(id)
      return value && (!value.archivedAt || includeArchived) ? structuredClone(value) : null
    },
    list(kind, { includeArchived = false } = {}) { return [...getTable(kind).values()].filter(value => includeArchived || !value.archivedAt).map(value => structuredClone(value)) },
    put(kind, record, actor) {
      const id = record.id || `${kind}-${++n}`
      const prior = getTable(kind).get(id) || {}
      const next = { ...prior, ...structuredClone(record), id, updatedBy: actor }
      delete next.archivedAt
      getTable(kind).set(id, next)
      return structuredClone(next)
    },
    archive(kind, id) {
      const record = this.get(kind, id)
      if (!record) return null
      const archived = { ...record, archivedAt: new Date().toISOString() }
      getTable(kind).set(id, archived)
      return structuredClone(archived)
    }
  }
}
const throwsStatus = (fn, status) => assert.throws(fn, error => error instanceof DataAdminError && error.status === status)

test('CSV parsing handles BOM, escaped quotes, commas, embedded newlines, and malformed input', () => {
  const result = parseCsv('\uFEFFName,Email,Note\r\n"River, Lee",r@example.test,"said ""hello"""\r\nTaylor,t@example.test,"line one\nline two"')
  assert.deepEqual(result.headers, ['Name', 'Email', 'Note'])
  assert.equal(result.rows[0].Name, 'River, Lee')
  assert.equal(result.rows[0].Note, 'said "hello"')
  assert.equal(result.rows[1].Note, 'line one\nline two')
  assert.throws(() => parseCsv('Name,Name\na,b'), /must be unique/)
  assert.throws(() => parseCsv('Name,Note\na,"unfinished'), /inside a quoted value/)
})

test('CSV export quotes values and neutralizes spreadsheet formula cells', () => {
  const csv = stringifyCsv([{ name: 'River, Lee', note: 'Line 1\nLine 2', formula: '=1+1' }], ['name', 'note', 'formula'])
  assert.equal(csv, 'name,note,formula\r\n"River, Lee","Line 1\nLine 2",\'=1+1')
  const roundTrip = parseCsv(csv)
  assert.equal(roundTrip.rows[0].name, 'River, Lee')
  assert.equal(roundTrip.rows[0].formula, "'=1+1")
})

test('field mapping and import validation report required-field errors and duplicate matches', () => {
  const mapped = mapImportRows([{ 'Email Address': 'jane@example.test', Name: 'Jane Doe' }], { 'Email Address': 'email', Name: 'name' })
  assert.deepEqual(mapped[0], { email: 'jane@example.test', name: 'Jane Doe', __importRow: 2 })
  const config = { data: { duplicateKeys: ['email', 'phone', 'profileUrl', 'name'], duplicateSupportingFields: ['currentTitle', 'company'] }, customFields: { candidates: [{ id: 'sourceCode', label: 'Source code', required: true }] } }
  const existing = [{ id: 'old', email: 'jane@example.test', name: 'Jane Doe', currentTitle: 'Recruiter', company: 'Northstar' }]
  const result = validateImportRows('candidates', [{ name: 'Jane Doe', email: 'JANE@example.test', currentTitle: 'Recruiter', company: 'Northstar' }], { config, existing })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(error => error.field === 'sourceCode'))
  assert.ok(result.duplicates[0].matches[0].matchedBy.includes('email'))
})

test('import validation rejects ambiguous mappings and reserved mapping targets', () => {
  const ambiguous = validateImportRows('candidates', [{ Email: 'one@example.test', Contact: 'two@example.test', Name: 'Riley' }], {
    mapping: { Email: 'email', Contact: 'email', Name: 'name' }
  })
  assert.equal(ambiguous.valid, false)
  assert.ok(ambiguous.errors.some(error => error.field === 'email' && /Multiple source columns/.test(error.message)))

  const reserved = mapImportRows([{ Name: 'Riley', Row: 'forged' }], { Name: '__importRow', Row: '__proto__' })
  assert.deepEqual(reserved[0], { __importRow: 2 })
  const invalidTarget = validateImportRows('candidates', [{ Name: 'Riley' }], { mapping: { Name: '__importRow' } })
  assert.ok(invalidTarget.errors.some(error => /not allowed/.test(error.message)))
})

test('duplicate matching normalizes email, phone, and profile URL and requires support for names', () => {
  const records = [
    { id: '1', email: 'person@example.test', phone: '+1 (555) 111-2222', profileUrl: 'https://www.linkedin.com/in/person/?trk=x', name: 'Jordan Doe', currentTitle: 'Engineer' },
    { id: '2', name: 'Jordan Doe', currentTitle: 'Designer' }
  ]
  const matches = findDuplicates({ email: ' PERSON@example.test ', phone: '15551112222', profileUrl: 'linkedin.com/in/person', name: 'Jordan Doe', currentTitle: 'Engineer' }, records, ['email', 'phone', 'profileUrl', 'name'])
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0].matchedBy, ['email', 'phone', 'profileUrl', 'name+currentTitle'])
})

test('merge preview shows conflicts and merge relinks records before archiving duplicate', () => {
  const store = memoryStore({
    candidates: [{ id: 'primary', name: 'Avery Kim', email: 'avery@example.test', skills: ['SQL'], tags: ['Lead'] }, { id: 'duplicate', name: 'Avery K.', email: 'avery.alt@example.test', skills: ['Python'], phone: '555-0100' }],
    applications: [{ id: 'app', candidateId: 'duplicate', jobId: 'job' }],
    notes: [{ id: 'note', relatedKind: 'candidates', relatedId: 'duplicate', body: 'Follow up' }]
  })
  const primary = store.get('candidates', 'primary'), duplicate = store.get('candidates', 'duplicate')
  const plan = createMergePlan('candidates', primary, duplicate, { store })
  assert.ok(plan.conflicts.some(item => item.field === 'name'))
  assert.deepEqual(plan.linked.applications, ['app'])
  const events = []
  const result = mergeRecords(store, 'candidates', 'primary', 'duplicate', { actor: 'admin', audit: (...args) => events.push(args) })
  assert.deepEqual(store.get('candidates', 'primary').skills, ['SQL', 'Python'])
  assert.equal(store.get('applications', 'app').candidateId, 'primary')
  assert.equal(store.get('notes', 'note').relatedId, 'primary')
  assert.ok(store.get('candidates', 'duplicate', { includeArchived: true }).archivedAt)
  assert.equal(events[0][0], 'record.merged')
  assert.ok(result.archived.archivedAt)
})

test('archive and restore are reversible and emit audit callbacks', () => {
  const store = memoryStore({ candidates: [{ id: 'c', name: 'Taylor' }] })
  const events = []
  const archived = archiveRecord(store, 'candidates', 'c', { reason: 'Requested', audit: (...args) => events.push(args) })
  assert.ok(archived.archivedAt)
  assert.equal(store.get('candidates', 'c'), null)
  const restored = restoreRecord(store, 'candidates', 'c', { audit: (...args) => events.push(args) })
  assert.equal(restored.name, 'Taylor')
  assert.equal(restored.archivedAt, undefined)
  assert.deepEqual(events.map(event => event[0]), ['record.archived', 'record.restored'])
})

test('candidate restore is blocked when an active duplicate has appeared', () => {
  const store = memoryStore({ candidates: [
    { id: 'archived', email: 'person@example.test', name: 'Jordan Doe', archivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'active', email: 'person@example.test', name: 'Jordan Doe' }
  ] })
  assert.throws(() => restoreRecord(store, 'candidates', 'archived'), error => {
    assert.ok(error instanceof DataAdminError)
    assert.equal(error.status, 409)
    assert.equal(error.details.duplicates[0].id, 'active')
    return true
  })
  assert.equal(store.get('candidates', 'archived'), null)
})

test('deletion workflow requires approval and anonymizes linked personal data while retaining relationships', () => {
  const store = memoryStore({
    candidates: [{ id: 'c', name: 'Taylor Doe', email: 'taylor@example.test', phone: '555', expectedSalary: 120000, privateNotes: 'private', status: 'active' }],
    applications: [{ id: 'a', candidateId: 'c', candidateName: 'Taylor Doe', email: 'taylor@example.test' }],
    notes: [{ id: 'n', candidateId: 'c', body: 'Taylor prefers email.' }],
    documents: [{ id: 'd', relatedKind: 'candidates', relatedId: 'c', storageName: 'resume.bin' }]
  })
  const config = { privacy: { deletionApprovalRequired: true, anonymizeOnDeletion: true } }
  throwsStatus(() => deleteOrAnonymize(store, 'candidates', 'c', { config }), 403)
  const archivedDocs = []
  const result = deleteOrAnonymize(store, 'candidates', 'c', { config, approved: true, onDocumentArchived: doc => archivedDocs.push(doc.id) })
  assert.equal(result.name, 'Anonymized candidate')
  assert.equal(result.email, null)
  assert.equal(result.expectedSalary, null)
  assert.equal(result.status, 'anonymized')
  assert.equal(store.get('applications', 'a').candidateId, 'c')
  assert.equal(store.get('applications', 'a').candidateName, 'Anonymized candidate')
  assert.equal(store.get('applications', 'a').email, null)
  assert.equal(store.get('notes', 'n').body, '[redacted by approved privacy request]')
  assert.equal(store.get('documents', 'd'), null)
  assert.deepEqual(archivedDocs, ['d'])
})

test('anonymization scrubs nested linked metadata, outbox, feedback, notes, and archived document JSON', () => {
  const store = memoryStore({
    candidates: [{ id: 'c', name: 'Taylor Doe', email: 'taylor@example.test', phone: '555' }],
    feedback: [{ id: 'f', candidateId: 'c', metadata: { contact: { email: 'taylor@example.test', phone: '555' }, rating: 4 }, notes: 'Taylor follow up', candidateName: 'Taylor Doe' }],
    outbox: [{ id: 'o', candidateId: 'c', payload: { recipientEmail: 'taylor@example.test', text: 'Taylor Doe', status: 'sent' }, body: 'Taylor private note' }],
    documents: [{ id: 'd', relatedKind: 'candidates', relatedId: 'c', storageName: 'shared.bin', filename: 'Taylor-Doe-resume.pdf', metadata: { email: 'taylor@example.test', nested: { phone: '555' }, category: 'Resume' }, notes: 'Taylor resume', archivedAt: undefined }]
  })
  const archived = []
  anonymizeRecord(store, 'candidates', 'c', { approved: true, onDocumentArchived: (doc, clean) => archived.push({ doc, clean }) })
  const feedback = store.get('feedback', 'f')
  assert.equal(feedback.metadata.contact.email, null)
  assert.equal(feedback.metadata.contact.phone, null)
  assert.equal(feedback.candidateName, 'Anonymized candidate')
  assert.equal(feedback.notes, '[redacted by approved privacy request]')
  const outbox = store.get('outbox', 'o')
  assert.equal(outbox.payload.recipientEmail, null)
  assert.equal(outbox.payload.text, 'Taylor Doe') // untyped prose is retained outside explicit free-text fields
  assert.equal(outbox.body, '[redacted by approved privacy request]')
  const document = store.get('documents', 'd', { includeArchived: true })
  assert.ok(document.archivedAt)
  assert.equal(document.filename, 'Taylor-Doe-resume.pdf') // archived DB JSON scrub is delegated to the route transaction callback
  assert.equal(archived[0].doc.storageName, 'shared.bin')
  assert.equal(archived[0].clean.storageName, null)
  assert.equal(archived[0].clean.filename, null)
  assert.deepEqual(archived[0].clean.metadata, {})
  assert.equal(archived[0].clean.notes, null)
})

test('document storage cleanup scrubs archived SQL row now and defers physical deletion until commit', () => {
  const store = memoryStore({ documents: [
    { id: 'archived', storageName: 'shared.bin', archivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'active', storageName: 'shared.bin' }
  ] })
  const removed = [], scrubbed = [], commitCallbacks = []
  const cleanup = documentStorageCleanup(store, {
    scrubArchivedRow: (document, clean) => scrubbed.push([document.id, clean]),
    deleteStorage: name => removed.push(name),
    afterCommit: callback => commitCallbacks.push(callback)
  })
  const originalArchived = store.get('documents', 'archived', { includeArchived: true })
  const sanitized = { ...originalArchived, storageName: null, filename: null }
  assert.equal(cleanup(originalArchived, sanitized), false)
  assert.deepEqual(removed, [])
  assert.deepEqual(scrubbed, [])
  store.archive('documents', 'active')
  assert.equal(cleanup(originalArchived, sanitized), true)
  assert.deepEqual(scrubbed, [['archived', sanitized]])
  assert.deepEqual(removed, [])
  commitCallbacks[0]()
  assert.deepEqual(removed, ['shared.bin'])
})

test('retention is preview-only by default and requires approval to process', () => {
  const oldDate = '2024-01-01T00:00:00.000Z'
  const reference = new Date('2026-01-01T00:00:00.000Z')
  const store = memoryStore({ candidates: [{ id: 'old', createdAt: oldDate, email: 'old@example.test' }, { id: 'new', createdAt: '2025-12-15T00:00:00.000Z', email: 'new@example.test' }] })
  const config = { data: { retentionDays: 365 }, privacy: { retentionDays: 365, deletionApprovalRequired: true, anonymizeOnDeletion: true } }
  const plan = retentionPlan(store, { config, now: reference })
  assert.deepEqual(plan.items.map(item => item.id), ['old'])
  assert.equal(applyRetention(store, plan, { config }).dryRun, true)
  throwsStatus(() => applyRetention(store, plan, { config, dryRun: false }), 403)
  const result = applyRetention(store, plan, { config, approved: true, dryRun: false })
  assert.equal(result.processed[0].kind, 'candidates')
  assert.equal(store.get('candidates', 'old').anonymized, true)
})

test('document categories and version replacement follow configuration', () => {
  const store = memoryStore({ documents: [{ id: 'doc-1', relatedKind: 'candidates', relatedId: 'c', category: 'Resume', version: 1 }] })
  const first = prepareDocumentVersion(store, { id: 'doc-2', relatedKind: 'candidates', relatedId: 'c', filename: 'resume.pdf', category: 'Resume' }, { config: { documents: { categories: ['Resume', 'Offer'], allowReplacement: true } }, actor: 'admin' })
  assert.equal(first.version, 2)
  assert.equal(first.previousVersionId, 'doc-1')
  assert.equal(first.rootDocumentId, 'doc-1')
  throwsStatus(() => prepareDocumentVersion(store, { relatedKind: 'candidates', relatedId: 'c', category: 'Unknown' }, { config: { documents: { categories: ['Resume'], allowReplacement: true } } }), 422)
  throwsStatus(() => prepareDocumentVersion(store, { relatedKind: 'candidates', relatedId: 'c', category: 'Resume' }, { config: { documents: { categories: ['Resume'], allowReplacement: false } } }), 409)
})

test('document versions preserve a monotonic immutable history and replacement identity', () => {
  const config = { documents: { categories: ['Resume', 'Offer'], allowReplacement: true, defaultVisibility: 'private' } }
  const store = memoryStore({ documents: [
    { id: 'doc-1', relatedKind: 'candidates', relatedId: 'c-1', category: 'Resume', version: 1, filename: 'resume-v1.pdf', mimeType: 'application/pdf', size: 12, visibility: 'private', uploadedAt: '2026-01-01T00:00:00.000Z' },
  ] })
  const second = prepareDocumentVersion(store, {
    id: 'doc-2', relatedKind: 'candidates', relatedId: 'c-1', replacesDocumentId: 'doc-1',
    filename: 'resume-v2.pdf', mimeType: 'application/pdf', size: 14,
  }, { config, actor: 'admin' })
  assert.equal(second.version, 2)
  assert.equal(second.previousVersionId, 'doc-1')
  assert.equal(second.rootDocumentId, 'doc-1')
  assert.equal(second.visibility, 'private')
  assert.equal(second.versionHistory[0].filename, 'resume-v1.pdf')
  assert.equal(second.replacesDocumentId, undefined)

  store.put('documents', second, 'admin')
  const third = prepareDocumentVersion(store, {
    id: 'doc-3', relatedKind: 'candidates', relatedId: 'c-1', replacesDocumentId: 'doc-2',
    category: 'Resume', filename: 'resume-v3.pdf', visibility: 'private',
  }, { config, actor: 'admin' })
  assert.equal(third.version, 3)
  assert.equal(third.previousVersionId, 'doc-2')
  assert.equal(third.rootDocumentId, 'doc-1')
  assert.deepEqual(third.versionHistory.map(item => item.id), ['doc-2', 'doc-1'])
  assert.equal(store.get('documents', 'doc-1').filename, 'resume-v1.pdf')
})

test('document replacement rejects parent, category, visibility, and configuration tampering', () => {
  const store = memoryStore({ documents: [
    { id: 'doc-1', relatedKind: 'candidates', relatedId: 'c-1', category: 'Resume', version: 1, visibility: 'private' },
    { id: 'doc-other', relatedKind: 'candidates', relatedId: 'c-2', category: 'Resume', version: 1, visibility: 'private' },
  ] })
  const config = { documents: { categories: ['Resume', 'Offer'], allowReplacement: true } }
  const base = { replacesDocumentId: 'doc-1', relatedKind: 'candidates', relatedId: 'c-1', filename: 'next.pdf' }
  throwsStatus(() => prepareDocumentVersion(store, { ...base, relatedId: 'c-2' }, { config }), 409)
  throwsStatus(() => prepareDocumentVersion(store, { ...base, category: 'Offer' }, { config }), 409)
  throwsStatus(() => prepareDocumentVersion(store, { ...base, visibility: 'team' }, { config }), 409)
  throwsStatus(() => prepareDocumentVersion(store, { ...base, visibility: 'mystery' }, { config }), 422)
  throwsStatus(() => prepareDocumentVersion(store, base, { config: { documents: { categories: ['Resume'], allowReplacement: false } } }), 409)
  throwsStatus(() => prepareDocumentVersion(store, { ...base, replacesDocumentId: 'missing' }, { config }), 409)
})

test('initial document versions use configured defaults and validate allowed visibility', () => {
  const result = prepareDocumentVersion(memoryStore(), {
    id: 'doc-new', relatedKind: 'jobs', relatedId: 'job-1', filename: 'brief.pdf',
  }, { config: { documents: { categories: ['Resume'], defaultCategory: 'Resume', defaultVisibility: 'team', allowedVisibilities: ['team', 'private'] } }, actor: 'recruiter' })
  assert.equal(result.category, 'Resume')
  assert.equal(result.visibility, 'team')
  assert.equal(result.version, 1)
  assert.equal(result.rootDocumentId, 'doc-new')
  assert.deepEqual(result.versionHistory, [])
  throwsStatus(() => prepareDocumentVersion(memoryStore(), {
    relatedKind: 'jobs', relatedId: 'job-1', category: 'Resume', filename: 'brief.pdf', visibility: 'public',
  }, { config: { documents: { categories: ['Resume'], allowedVisibilities: ['team', 'private'] } } }), 422)
})
