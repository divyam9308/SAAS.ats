'use strict'

const { buildRetentionPlan } = require('./retention')
const { anonymizeRecord, archiveRecord } = require('./data-admin')

const DEFAULT_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 100
const WORKFLOW = 'privacy-deletion'

class RetentionProcessError extends Error {
  constructor(message, status = 422) { super(message); this.status = status }
}

function auditEvent(audit, action, candidateId, details = {}) {
  audit(action, 'candidates', candidateId, details)
}

function approvedRequest(store, candidateId) {
  return (store.list('approvals') || []).find(row => row.workflow === WORKFLOW &&
    row.recordKind === 'candidates' && row.recordId === candidateId && row.status === 'approved' &&
    row.decidedBy && row.decidedBy !== row.requesterId)
}

/** Create a persisted approval request; requester cannot decide their own request. */
function requestRetentionApproval(store, candidateId, { actor, audit = () => {}, reason = 'Retention period elapsed' } = {}) {
  if (!actor || !candidateId) throw new RetentionProcessError('An actor and candidate ID are required.', 400)
  const candidate = store.get('candidates', candidateId)
  if (!candidate) throw new RetentionProcessError('Candidate not found or already archived.', 404)
  const pending = (store.list('approvals') || []).find(row => row.workflow === WORKFLOW && row.recordKind === 'candidates' && row.recordId === candidateId && row.status === 'pending')
  if (pending) return pending
  const request = store.put('approvals', {
    workflow: WORKFLOW, recordKind: 'candidates', recordId: candidateId,
    status: 'pending', requesterId: actor, requestedAt: new Date().toISOString(), reason
  }, actor)
  auditEvent(audit, 'retention.approval_requested', candidateId, { approvalId: request.id, requesterId: actor })
  return request
}

/** Persist an independent decision. The caller supplies identity, never an approved boolean. */
function decideRetentionApproval(store, approvalId, { actor, decision, audit = () => {} } = {}) {
  if (!actor || !approvalId) throw new RetentionProcessError('An actor and approval ID are required.', 400)
  if (!['approved', 'rejected'].includes(decision)) throw new RetentionProcessError('Decision must be approved or rejected.', 422)
  const approval = store.get('approvals', approvalId)
  if (!approval || approval.workflow !== WORKFLOW || approval.recordKind !== 'candidates') throw new RetentionProcessError('Retention approval request not found.', 404)
  if (approval.status !== 'pending') throw new RetentionProcessError('Retention approval request has already been decided.', 409)
  if (approval.requesterId === actor) throw new RetentionProcessError('The requester cannot decide their own retention request.', 403)
  const updated = store.put('approvals', { ...approval, status: decision, decidedBy: actor, decidedAt: new Date().toISOString() }, actor)
  auditEvent(audit, `retention.approval_${decision}`, approval.recordId, { approvalId, decidedBy: actor })
  return updated
}

/**
 * Dry-run-first retention execution. A non-dry run is bounded, re-plans each
 * candidate immediately before mutation, and requires an independently persisted approval.
 *
 * onDocumentArchived contract: callback(archivedDocument, sanitizedDocument) runs
 * during anonymization's store transaction. Implementations may scrub the archived
 * database row synchronously and defer physical storage deletion until commit (see
 * data-admin.documentStorageCleanup); do not delete a file before transaction commit.
 */
function processRetention(store, {
  config = {}, now = new Date(), dryRun = true, candidateIds,
  batchSize = DEFAULT_BATCH_SIZE, actor = 'system', audit = () => {}, onDocumentArchived
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) throw new RetentionProcessError(`Batch size must be between 1 and ${MAX_BATCH_SIZE}.`, 422)
  const fullPlan = buildRetentionPlan(store, { config, now })
  // The preview includes held and approval-needed rows so operators can see
  // why candidates are not yet processable. The execution path rechecks status.
  const allowedIds = candidateIds == null ? fullPlan.items.map(item => item.candidateId) : candidateIds
  if (!Array.isArray(allowedIds) || allowedIds.some(id => typeof id !== 'string')) throw new RetentionProcessError('candidateIds must be an array of candidate IDs.', 422)
  const selected = [...new Set(allowedIds)].slice(0, batchSize)
  const previewItems = selected.map(id => fullPlan.items.find(item => item.candidateId === id) || { candidateId: id, status: 'not_in_plan', retentionAction: null })
  if (dryRun) return { dryRun: true, batchSize, selectedCount: selected.length, processed: [], items: previewItems, plan: fullPlan }

  const results = []
  for (const candidateId of selected) {
    const currentPlan = buildRetentionPlan(store, { config, now })
    const current = currentPlan.items.find(item => item.candidateId === candidateId)
    if (!current || current.status !== 'eligible') {
      results.push({ candidateId, status: current?.status || 'not_eligible', processed: false })
      auditEvent(audit, 'retention.processing_skipped', candidateId, { reason: current?.status || 'not_eligible' })
      continue
    }
    const approval = approvedRequest(store, candidateId)
    if (config?.privacy?.deletionApprovalRequired !== false && !approval) {
      results.push({ candidateId, status: 'approval_required', processed: false })
      auditEvent(audit, 'retention.processing_skipped', candidateId, { reason: 'approval_required' })
      continue
    }
    auditEvent(audit, 'retention.processing_intent', candidateId, { action: current.retentionAction, approvalId: approval?.id || null, actor })
    try {
      const record = current.retentionAction === 'archive'
        ? archiveRecord(store, 'candidates', candidateId, { actor, reason: 'Retention period expired', audit })
        : anonymizeRecord(store, 'candidates', candidateId, { actor, approved: true, config, audit, onDocumentArchived })
      results.push({ candidateId, status: 'processed', processed: true, action: current.retentionAction, recordId: record.id })
      auditEvent(audit, 'retention.processing_result', candidateId, { outcome: 'processed', action: current.retentionAction, approvalId: approval?.id || null })
    } catch (error) {
      auditEvent(audit, 'retention.processing_result', candidateId, { outcome: 'failed', message: error.message, approvalId: approval?.id || null })
      throw error
    }
  }
  return { dryRun: false, batchSize, selectedCount: selected.length, processed: results.filter(item => item.processed), results, items: previewItems }
}

module.exports = { RetentionProcessError, requestRetentionApproval, decideRetentionApproval, processRetention, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE }
