'use strict'

const { now } = require('./database')

class AgencyGuaranteeError extends Error {
  constructor(message, status = 409) { super(message); this.name = 'AgencyGuaranteeError'; this.status = status }
}

function configFor(config = {}) { return config?.agency?.guarantees || {} }
function dateOnly(value, label = 'Date') {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AgencyGuaranteeError(`${label} must be a valid date.`, 422)
  return date.toISOString().slice(0, 10)
}
function addDays(value, days) {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Resolve expiry from placement dates and agency.guarantees configuration. */
function calculateGuaranteeExpiry(placement = {}, config = {}, options = {}) {
  const policy = configFor(config)
  const days = Number(options.guaranteeDays ?? placement.guaranteeDays ?? policy.defaultDays ?? policy.durationDays ?? config?.agency?.defaultGuaranteeDays ?? 0)
  if (!Number.isFinite(days) || days < 0) throw new AgencyGuaranteeError('Guarantee duration must be a non-negative number of days.', 422)
  const start = dateOnly(options.startDate ?? placement.startDate ?? placement.placedAt ?? options.today ?? new Date().toISOString(), 'Guarantee start date')
  return days ? addDays(start, days) : null
}

function history(placement) { return Array.isArray(placement.guaranteeHistory) ? placement.guaranteeHistory : [] }
function appendHistory(placement, event) {
  return [...history(placement), Object.freeze({ ...event })]
}
function replacePlacement(store, placement, delta, actor) {
  return store.put('placements', { ...placement, ...delta }, actor)
}
function requireReason(reason) {
  const value = typeof reason === 'string' ? reason.trim() : ''
  if (!value) throw new AgencyGuaranteeError('A reason is required to request a guarantee replacement.', 422)
  if (value.length > 2000) throw new AgencyGuaranteeError('The reason must be 2,000 characters or fewer.', 422)
  return value
}
function assertCurrent(placement, config, at = new Date()) {
  if (configFor(config).enabled === false) throw new AgencyGuaranteeError('Agency guarantees are disabled by configuration.', 409)
  if (!placement.guaranteeExpiry) throw new AgencyGuaranteeError('This placement has no guarantee period.', 409)
  const expiry = dateOnly(placement.guaranteeExpiry, 'Guarantee expiry')
  if (expiry < dateOnly(at)) throw new AgencyGuaranteeError('The guarantee period has expired.', 409)
}

function requestGuaranteeReplacement(store, placement, { reason, requestedAt } = {}, context = {}) {
  const actor = context.actor || context.user?.id || 'system'
  assertCurrent(placement, context.config || {}, requestedAt ? new Date(requestedAt) : new Date())
  if (placement.guaranteeStatus === 'under_review' || placement.guaranteeStatus === 'approved') throw new AgencyGuaranteeError('A guarantee request is already being reviewed or approved.', 409)
  const why = requireReason(reason)
  const timestamp = requestedAt ? new Date(requestedAt).toISOString() : now()
  const request = { id: context.requestId, status: 'requested', reason: why, requestedAt: timestamp, requestedBy: actor }
  const updated = replacePlacement(store, placement, {
    guaranteeStatus: 'requested', guaranteeRequest: request,
    guaranteeHistory: appendHistory(placement, { type: 'requested', ...request })
  }, actor)
  context.audit?.('placement.guarantee.requested', placement.id, { reason: why })
  return updated
}

function startGuaranteeReview(store, placement, { comment = '', reviewedAt } = {}, context = {}) {
  const actor = context.actor || context.user?.id || 'system'
  if (placement.guaranteeStatus !== 'requested') throw new AgencyGuaranteeError('Only a requested guarantee can enter review.')
  const timestamp = reviewedAt ? new Date(reviewedAt).toISOString() : now()
  const request = { ...placement.guaranteeRequest, status: 'under_review', reviewStartedAt: timestamp, reviewStartedBy: actor, reviewComment: String(comment || '').trim() }
  const updated = replacePlacement(store, placement, { guaranteeStatus: 'under_review', guaranteeRequest: request, guaranteeHistory: appendHistory(placement, { type: 'review_started', at: timestamp, actor, comment: request.reviewComment }) }, actor)
  context.audit?.('placement.guarantee.review_started', placement.id, {})
  return updated
}

function decideGuaranteeReview(store, placement, decision, { reason = '', decidedAt } = {}, context = {}) {
  const actor = context.actor || context.user?.id || 'system'
  if (placement.guaranteeStatus !== 'under_review') throw new AgencyGuaranteeError('A guarantee must be under review before it can be approved or denied.')
  if (!['approve', 'deny'].includes(decision)) throw new AgencyGuaranteeError('Decision must be approve or deny.', 422)
  const explanation = String(reason || '').trim()
  if (decision === 'deny' && !explanation) throw new AgencyGuaranteeError('A reason is required to deny a guarantee replacement.', 422)
  const timestamp = decidedAt ? new Date(decidedAt).toISOString() : now()
  const status = decision === 'approve' ? 'approved' : 'denied'
  const request = { ...placement.guaranteeRequest, status, decision, decisionAt: timestamp, decidedBy: actor, decisionReason: explanation }
  const updated = replacePlacement(store, placement, { guaranteeStatus: status, guaranteeRequest: request, guaranteeHistory: appendHistory(placement, { type: status, at: timestamp, actor, reason: explanation }) }, actor)
  context.audit?.(`placement.guarantee.${status}`, placement.id, { reason: explanation })
  return updated
}

function submitReplacement(store, placement, submissionInput = {}, context = {}) {
  const actor = context.actor || context.user?.id || 'system'
  if (placement.guaranteeStatus !== 'approved') throw new AgencyGuaranteeError('An approved guarantee is required before submitting a replacement.')
  if (placement.guaranteeRequest?.replacementSubmissionId) throw new AgencyGuaranteeError('A replacement submission has already been created for this guarantee.', 409)
  if (!placement.clientId || submissionInput.clientId !== placement.clientId) throw new AgencyGuaranteeError('A guarantee replacement must be submitted to the original client.', 422)
  const submission = store.put('submissions', {
    ...submissionInput,
    clientId: placement.clientId,
    replacementForPlacementId: placement.id,
    guaranteeRequestId: placement.guaranteeRequest?.id || null,
    status: submissionInput.status || 'submitted'
  }, actor)
  const timestamp = now()
  const request = { ...placement.guaranteeRequest, replacementSubmissionId: submission.id, replacementSubmittedAt: timestamp, status: 'replacement_submitted' }
  const updated = replacePlacement(store, placement, {
    guaranteeStatus: 'replacement_submitted', replacementSubmissionId: submission.id,
    guaranteeRequest: request,
    guaranteeHistory: appendHistory(placement, { type: 'replacement_submitted', at: timestamp, actor, submissionId: submission.id })
  }, actor)
  context.audit?.('placement.guarantee.replacement_submitted', placement.id, { submissionId: submission.id })
  return { placement: updated, submission }
}

module.exports = {
  AgencyGuaranteeError,
  calculateGuaranteeExpiry,
  requestGuaranteeReplacement,
  startGuaranteeReview,
  decideGuaranteeReview,
  submitReplacement
}
