'use strict'

const DAY_MS = 86400000
const TERMINAL_APPLICATION_STATUSES = new Set(['hired', 'rejected', 'withdrawn', 'closed', 'cancelled'])

class RetentionError extends Error {
  constructor(message, status = 422) { super(message); this.status = status }
}

function timestamp(value) {
  if (!value) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

function retentionDays(config) {
  const value = Number(config?.privacy?.retentionDays ?? config?.data?.retentionDays)
  if (!Number.isFinite(value) || value < 1) throw new RetentionError('A positive retention period must be configured.')
  return value
}

function candidateApplications(store, candidateId) {
  return (store.list('applications') || []).filter(application => application.candidateId === candidateId)
}

function candidateActivityTimes(candidate, applications) {
  const times = [
    candidate.lastActivityAt, candidate.updatedAt, candidate.consentAt,
    candidate.consentUpdatedAt, candidate.consentGrantedAt, candidate.consentTimestamp,
    candidate.createdAt, candidate.appliedAt
  ].map(timestamp).filter(value => value != null)
  for (const application of applications) {
    for (const value of [application.lastActivityAt, application.updatedAt, application.stageChangedAt, application.createdAt, application.appliedAt]) {
      const parsed = timestamp(value)
      if (parsed != null) times.push(parsed)
    }
  }
  return times.length ? Math.max(...times) : null
}

function approvalForCandidate(approvals, candidateId) {
  return (approvals || []).find(approval => approval.workflow === 'privacy-deletion' &&
    approval.recordKind === 'candidates' && approval.recordId === candidateId &&
    approval.status === 'approved' && approval.decidedBy && approval.decidedBy !== approval.requesterId) || null
}

function pendingRequestForCandidate(approvals, candidateId) {
  return (approvals || []).find(approval => approval.workflow === 'privacy-deletion' &&
    approval.recordKind === 'candidates' && approval.recordId === candidateId && approval.status === 'pending') || null
}

/**
 * Build a preview-only plan from persisted candidate, application and approval
 * records. It never changes the store. Every proposed action remains subject to
 * the normal approval and anonymization/archive workflow when executed.
 */
function buildRetentionPlan(store, { config = {}, now: reference = new Date() } = {}) {
  const days = retentionDays(config)
  const asOf = timestamp(reference)
  if (asOf == null) throw new RetentionError('A valid planning date is required.')
  const cutoffTime = asOf - days * DAY_MS
  const approvals = store.list('approvals') || []
  const candidates = store.list('candidates') || []
  const items = candidates.filter(candidate => !candidate.anonymized && !candidate.archivedAt && candidate.status !== 'anonymized').map(candidate => {
    const applications = candidateApplications(store, candidate.id)
    const activityTime = candidateActivityTimes(candidate, applications)
    const activeApplications = applications.filter(application => !TERMINAL_APPLICATION_STATUSES.has(String(application.status || '').toLowerCase()))
    const approval = approvalForCandidate(approvals, candidate.id)
    const pendingRequest = pendingRequestForCandidate(approvals, candidate.id)
    const isOldEnough = activityTime != null && activityTime <= cutoffTime
    const consentStatus = String(candidate.consentStatus || 'unknown').toLowerCase()
    const consentReviewRequired = !['granted', 'consented', 'approved'].includes(consentStatus)
    let status = 'eligible'
    let reason = 'Retention period elapsed; no active applications remain and an independent approval is recorded.'
    let recommendedAction = config?.privacy?.anonymizeOnDeletion === false ? 'archive' : 'anonymize'
    if (activeApplications.length) {
      status = 'blocked_active_application'
      reason = 'Candidate has an application that is not in a terminal state.'
      recommendedAction = 'review_active_application'
    } else if (!isOldEnough) {
      status = activityTime == null ? 'needs_activity_date' : 'within_retention_period'
      reason = activityTime == null ? 'No reliable activity date is available.' : 'Most recent candidate or application activity is within the configured retention period.'
      recommendedAction = 'retain'
    } else if (pendingRequest) {
      status = 'awaiting_approval'
      reason = 'A privacy request is already awaiting an independent decision.'
      recommendedAction = 'review_pending_request'
    } else if (config?.privacy?.deletionApprovalRequired !== false && !approval) {
      status = 'approval_required'
      reason = consentReviewRequired
        ? 'Consent is not recorded as granted and the retention period elapsed; review consent and obtain approval before processing.'
        : 'Retention period elapsed; obtain an independent approval before processing.'
      recommendedAction = 'request_approval'
    } else if (consentReviewRequired) {
      reason = 'Retention period elapsed and consent is not recorded as granted; review consent before processing.'
    }
    return {
      candidateId: candidate.id,
      status,
      reason,
      recommendedAction,
      consentStatus,
      consentReviewRequired,
      lastActivityAt: activityTime == null ? null : new Date(activityTime).toISOString(),
      activeApplicationCount: activeApplications.length,
      applicationCount: applications.length,
      approvalId: approval?.id || null,
      pendingApprovalId: pendingRequest?.id || null,
      retentionAction: recommendedAction === 'anonymize' || recommendedAction === 'archive' ? recommendedAction : null
    }
  })
  return {
    previewOnly: true,
    generatedAt: new Date(asOf).toISOString(),
    cutoff: new Date(cutoffTime).toISOString(),
    retentionDays: days,
    summary: {
      candidateCount: candidates.filter(candidate => !candidate.anonymized && !candidate.archivedAt && candidate.status !== 'anonymized').length,
      eligibleCount: items.filter(item => item.status === 'eligible').length,
      approvalRequiredCount: items.filter(item => item.status === 'approval_required').length,
      awaitingApprovalCount: items.filter(item => item.status === 'awaiting_approval').length,
      blockedActiveApplicationCount: items.filter(item => item.status === 'blocked_active_application').length,
      retainedCount: items.filter(item => ['within_retention_period', 'needs_activity_date'].includes(item.status)).length
    },
    items
  }
}

module.exports = { RetentionError, buildRetentionPlan }
