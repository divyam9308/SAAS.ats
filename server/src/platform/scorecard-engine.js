'use strict'

/** Pure helpers for resolving a configured interview scorecard and validating feedback. */
class ScorecardError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'ScorecardError'
    this.status = status
  }
}

const list = value => Array.isArray(value) ? value : []
const idOf = item => item?.id || item?.key || item?.name
const first = (...values) => values.find(value => value != null && value !== '')

/** Resolve by explicitly selected scorecard, then plan/round, job, role, then legacy default. */
function resolveScorecard(config = {}, interview = {}, context = {}) {
  const cards = list(config.scorecards)
  if (!cards.length) return null
  const job = context.job || {}
  const role = context.role || {}
  const plan = list(config.interviewPlans).find(item => item.id === first(interview.interviewPlanId, interview.planId))
  const round = list(plan?.rounds).find(item => item.id === first(interview.roundId, interview.round))
  const explicitId = first(interview.scorecardId, round?.scorecardId)
  if (explicitId) return cards.find(item => item.id === explicitId) || null

  const jobScorecardId = first(interview.jobScorecardId, job.scorecardId, job.interviewScorecardId)
  if (jobScorecardId) return cards.find(item => item.id === jobScorecardId) || null

  const roleScorecardId = first(interview.roleScorecardId, role.scorecardId, role.interviewScorecardId)
  if (roleScorecardId) return cards.find(item => item.id === roleScorecardId) || null

  const matches = (card, entity, entityId) => {
    const selectors = card?.[entity] ?? card?.[`${entity}Ids`] ?? card?.[`for${entity[0].toUpperCase()}${entity.slice(1)}`]
    const values = Array.isArray(selectors) ? selectors : selectors == null ? [] : [selectors]
    return values.includes(entityId)
  }
  const jobId = first(interview.jobId, job.id)
  const roleId = first(interview.roleId, job.roleId, job.jobRoleId, role.id)
  const byJob = cards.find(card => matches(card, 'job', jobId))
  if (byJob) return byJob
  const byRole = cards.find(card => matches(card, 'role', roleId))
  if (byRole) return byRole
  return cards.find(card => card.default === true) || cards[0] || null
}

function criteriaForScorecard(scorecard, context = {}) {
  if (!scorecard) return []
  const interviewerId = context.interviewerId
  const criteria = list(scorecard.competencies || scorecard.criteria || scorecard.questions)
  // An interviewer-specific map may replace criteria, or append specific criteria.
  const specific = scorecard.interviewerCriteria?.[interviewerId]
    || list(scorecard.interviewerCriteria).find(entry => entry?.interviewerId === interviewerId)?.criteria
  return specific ? list(specific) : criteria
}

/** Validate and normalize feedback. Throws ScorecardError with HTTP-friendly status. */
function evaluateScorecard(scorecard, payload = {}, context = {}) {
  const criteria = criteriaForScorecard(scorecard, context)
  const answers = payload.answers || payload.ratings || {}
  const required = criteria.filter(item => item.required !== false)
  const missing = required.filter(item => answers[idOf(item)] == null || answers[idOf(item)] === '')
  if (missing.length) throw new ScorecardError(`Complete required scorecard items: ${missing.map(item => item.name || item.label || idOf(item)).join(', ')}.`)

  const scale = scorecard?.ratingScale || {}
  for (const item of criteria) {
    const key = idOf(item)
    const score = answers[key]
    if (score == null || score === '') continue
    if (typeof score !== 'number' || !Number.isFinite(score) || (scale.min != null && score < Number(scale.min)) || (scale.max != null && score > Number(scale.max))) {
      throw new ScorecardError(`Score for ${item.name || key} is outside the configured rating scale.`)
    }
  }

  const comments = String(first(payload.comments, payload.feedback, '')).trim()
  if ((scorecard?.mandatoryFeedback || scorecard?.commentsRequired) && !comments) throw new ScorecardError('Written interview feedback is required before submission.')
  if (scorecard?.recommendationRequired && !payload.recommendation) throw new ScorecardError('A recommendation is required before submission.')
  if (payload.recommendation && list(scorecard?.recommendations).length && !list(scorecard.recommendations).includes(payload.recommendation)) throw new ScorecardError('Select a configured recommendation.')

  const rated = criteria.filter(item => answers[idOf(item)] != null && answers[idOf(item)] !== '')
  const totalWeight = rated.reduce((sum, item) => sum + (Number(item.weight) > 0 ? Number(item.weight) : 1), 0)
  const weightedScore = totalWeight ? rated.reduce((sum, item) => sum + answers[idOf(item)] * (Number(item.weight) > 0 ? Number(item.weight) : 1), 0) / totalWeight : null
  return { answers, comments, recommendation: payload.recommendation || null, criteria, weightedScore }
}

/** Enforce one immutable submitted feedback record per interviewer and interview. */
function assertFeedbackSubmissionAvailable(feedbackRows = [], interviewId, interviewerId) {
  const submitted = list(feedbackRows).some(item => item.interviewId === interviewId && item.interviewerId === interviewerId && item.status === 'submitted')
  if (submitted) throw new ScorecardError('Submitted feedback is locked and cannot be changed.', 409)
}

module.exports = { ScorecardError, resolveScorecard, criteriaForScorecard, evaluateScorecard, assertFeedbackSubmissionAvailable }
