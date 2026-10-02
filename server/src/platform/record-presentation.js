'use strict'

// Human-readable, permission-aware projections for linked records in table rows.
// Contract: get(kind, id) returns a record or null; canView(kind) checks the
// actor's module and view permission; readable(kind, record) checks row scope.
function projectRecordLabels(kind, row, { get, canView, readable, users = [] } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const result = { ...row }
  const descriptors = {
    applications: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    interviews: { candidate: [['candidateId', 'candidates'], ['applicationId', 'applications', 'candidateId', 'candidates']], job: [['jobId', 'jobs'], ['applicationId', 'applications', 'jobId', 'jobs']], contact: [['contactId', 'contacts']] },
    offers: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    agencySubmissions: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    agency_submissions: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    submissions: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    placements: { candidate: [['candidateId', 'candidates']], job: [['jobId', 'jobs']], client: [['clientId', 'clients']], contact: [['contactId', 'contacts']] },
    invoices: { client: [['clientId', 'clients'], ['placementId', 'placements', 'clientId', 'clients']], placement: [['placementId', 'placements']] },
  }
  const fields = descriptors[kind] || {}
  const labelKeys = { candidate: 'candidateName', job: 'jobTitle', client: 'clientName', contact: 'contactName', placement: 'placementName' }
  const unavailable = { candidate: 'Candidate unavailable', job: 'Job unavailable', client: 'Client unavailable', contact: 'Contact unavailable', placement: 'Placement unavailable' }
  const display = (record, mode) => {
    if (!record || typeof record !== 'object') return ''
    if (mode === 'candidate') {
      const full = [record.firstName, record.lastName].filter(Boolean).join(' ').trim()
      return record.name || record.fullName || full
    }
    if (mode === 'job') return record.title || record.jobTitle || record.name || ''
    if (mode === 'client') return record.name || record.companyName || ''
    if (mode === 'contact') return record.name || record.fullName || [record.firstName, record.lastName].filter(Boolean).join(' ').trim()
    if (mode === 'placement') return record.name || record.title || ''
    return ''
  }
  for (const [mode, links] of Object.entries(fields)) {
    const key = labelKeys[mode]
    // Always discard persisted projections: they may have been created under
    // different permissions or become stale after a relationship changed.
    delete result[key]
    let hasLink = false
    for (const [idField, linkedKind, viaField, viaKind] of links) {
      const id = row[idField]
      if (!id) continue
      hasLink = true
      if (typeof get !== 'function' || typeof canView !== 'function' || typeof readable !== 'function') continue
      if (!canView(linkedKind)) continue
      let linked = get(linkedKind, id)
      if (!linked || !readable(linkedKind, linked)) continue
      if (viaField && viaKind) {
        const nestedId = linked[viaField]
        if (!nestedId || !canView(viaKind)) continue
        linked = get(viaKind, nestedId)
        if (!linked || !readable(viaKind, linked)) continue
      }
      const label = display(linked, mode)
      if (label) { result[key] = label; break }
    }
    if (!result[key] && hasLink) result[key] = unavailable[mode]
  }
  // Owner labels are resolved only from the already-authorized roster passed
  // by the caller. Never copy contact details into the projection.
  delete result.ownerName
  const ownerId = row.ownerId || row.recruiterId || row.assignedTo || row.assigneeId
  if (ownerId && Array.isArray(users)) {
    const owner = users.find(user => user && user.id === ownerId)
    const name = owner && (owner.name || owner.fullName || [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim())
    if (name) result.ownerName = name
  }
  return result
}

module.exports = { projectRecordLabels }
