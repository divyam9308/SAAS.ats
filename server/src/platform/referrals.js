'use strict'

class ReferralError extends Error {
  constructor(message, status = 422, details = null) {
    super(message)
    this.name = 'ReferralError'
    this.status = status
    this.details = details
  }
}

const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()
const enabled = config => config?.referrals?.enabled === true || config?.modules?.referrals === true
const list = value => Array.isArray(value) ? value : []

function assertEnabled(config) {
  if (!enabled(config)) throw new ReferralError('Employee referrals are disabled for this company.', 403)
}

function isEligibleReferrer({ actor, users = [], config = {} } = {}) {
  const rule = config?.referrals?.eligibility || 'employees'
  if (!actor?.id) return false
  const user = list(users).find(item => item.id === actor.id)
  if (!user || user.status === 'disabled' || user.active === false) return false
  if (rule === 'all' || rule === 'all-users') return true
  if (Array.isArray(rule)) return rule.includes(user.roleId)
  if (rule && typeof rule === 'object') {
    const roleIds = list(rule.roleIds || rule.roles)
    if (roleIds.length) return roleIds.includes(user.roleId)
    if (rule.employeeOnly === false) return true
  }
  // The default employee policy includes internal employees and recruiters, but
  // excludes external agency consultants and service/system identities.
  return !['agency-consultant', 'system', 'service'].includes(user.roleId)
}

function candidateIdentity(candidate) {
  return [candidate?.id, candidate?.email, candidate?.phone, candidate?.profileUrl, candidate?.linkedin]
    .map(lower).filter(Boolean)
}

function duplicateSummary({ candidate, jobId, referrals = [], applications = [] } = {}) {
  const identities = new Set(candidateIdentity(candidate))
  const referralMatch = list(referrals).some(referral => {
    const linked = (candidate?.id && referral.candidateId === candidate.id) || (referral.candidateEmail && identities.has(lower(referral.candidateEmail)))
    return linked && (!jobId || !referral.jobId || referral.jobId === jobId)
  })
  const applicationMatch = list(applications).some(application => {
    const linked = (candidate?.id && application.candidateId === candidate.id) || (application.candidateEmail && identities.has(lower(application.candidateEmail)))
    return linked && (!jobId || application.jobId === jobId)
  })
  return { hasDuplicate: referralMatch || applicationMatch, referralMatch, applicationMatch }
}

function findReferralDuplicates({ candidate, jobId, referrerId, referrals = [], applications = [] } = {}) {
  const summary = duplicateSummary({ candidate, jobId, referrals, applications })
  // This public helper deliberately exposes only aggregate match information.
  return summary.hasDuplicate ? [{ kind: 'duplicate' }] : []
}

function prepareReferralSubmission({ input = {}, actor, users = [], config = {}, candidates = [], jobs = [], referrals = [], applications = [], now = new Date() } = {}) {
  assertEnabled(config)
  if (!isEligibleReferrer({ actor, users, config })) throw new ReferralError('This user is not eligible to submit employee referrals.', 403)
  const candidateId = clean(input.candidateId)
  const jobId = clean(input.jobId) || null
  let candidate
  if (candidateId) {
    if (config?.referrals?.allowExistingCandidateSelection !== true) throw new ReferralError('Existing candidate selection is unavailable for employee referrals.', 403)
    candidate = list(candidates).find(item => item.id === candidateId)
    if (!candidate) throw new ReferralError('The selected candidate does not exist.', 404)
  } else {
    const details = input.candidateDetails || input
    const name = clean(details.name || [details.firstName, details.lastName].filter(Boolean).join(' '))
    const email = lower(details.email)
    const phone = clean(details.phone)
    if (!name || !email) throw new ReferralError('Candidate name and email are required.')
    if (input.consent !== true && details.consent !== true) throw new ReferralError('Candidate consent is required before submitting a referral.', 422)
    candidate = { name, email, phone, profileUrl: clean(details.profileUrl || details.linkedin) }
  }
  if (jobId && !list(jobs).some(item => item.id === jobId && !['closed', 'cancelled', 'archived'].includes(lower(item.status)))) {
    throw new ReferralError('The selected job is unavailable for referrals.', 404)
  }
  const duplicate = duplicateSummary({ candidate, jobId, referrals, applications })
  const policy = config?.referrals?.duplicatePolicy || 'review'
  if (duplicate.hasDuplicate && policy === 'block') throw new ReferralError('This candidate already has a referral or application for the selected job.', 409)
  const nowValue = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const status = duplicate.hasDuplicate && policy === 'review' ? 'duplicate_review' : 'submitted'
  return {
    candidateId: candidateId || null,
    candidateDetails: candidateId ? undefined : { name: candidate.name, email: candidate.email, phone: candidate.phone || '', profileUrl: candidate.profileUrl || '' },
    candidateName: candidate.name || candidate.fullName || [candidate.firstName, candidate.lastName].filter(Boolean).join(' '),
    candidateEmail: candidate.email || '',
    jobId,
    jobTitle: jobId ? list(jobs).find(item => item.id === jobId)?.title || '' : '',
    referrerId: actor.id,
    referrer: actor.name || list(users).find(item => item.id === actor.id)?.name || actor.email || '',
    source: 'Employee referral',
    sourceCategory: 'referral',
    status,
    duplicateReview: duplicate.hasDuplicate,
    submittedAt: nowValue,
    payoutStatus: list(config?.referrals?.payoutStatuses).includes('pending') ? 'pending' : (list(config?.referrals?.payoutStatuses)[0] || null),
    reward: null,
    rewardMilestone: null
  }
}

function rewardForMilestone(config, milestone, referral = {}) {
  const normalized = lower(milestone)
  const reward = list(config?.referrals?.rewards).find(item => lower(item.milestone || item.when || item.stage) === normalized && (item.enabled !== false))
  if (!reward) return null
  if (reward.jobId && reward.jobId !== referral.jobId) return null
  if (reward.employmentType && reward.employmentType !== referral.employmentType) return null
  return { id: reward.id || null, name: reward.name || `${milestone} referral reward`, amount: Number(reward.amount ?? reward.value ?? 0), currency: reward.currency || config?.regional?.currency || 'USD', milestone: normalized }
}

function recordReferralMilestone(referral, milestone, config = {}, { now = new Date() } = {}) {
  assertEnabled(config)
  const key = lower(milestone)
  const configured = list(config?.referrals?.milestones).map(lower)
  if (!key || !configured.includes(key)) throw new ReferralError('This referral milestone is not configured.', 422, { milestone })
  const milestones = list(referral?.milestonesCompleted)
  if (milestones.some(item => lower(typeof item === 'string' ? item : item?.key) === key)) return { ...referral }
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const reward = rewardForMilestone(config, key, referral)
  const statuses = list(config?.referrals?.payoutStatuses)
  return {
    ...referral,
    milestonesCompleted: [...milestones, { key, completedAt: at }],
    reward: reward || referral.reward || null,
    rewardMilestone: reward ? key : (referral.rewardMilestone || null),
    payoutStatus: reward ? (statuses.includes('pending') ? 'pending' : statuses[0] || null) : referral.payoutStatus,
    ...(reward ? { rewardEarnedAt: at } : {})
  }
}

function updatePayoutStatus(referral, status, config = {}, { actorId, now = new Date() } = {}) {
  assertEnabled(config)
  const allowed = list(config?.referrals?.payoutStatuses)
  const target = lower(status)
  if (!allowed.includes(target)) throw new ReferralError('The requested payout status is not configured.', 422, { allowed })
  if (!referral?.reward) throw new ReferralError('A referral reward must be earned before tracking its payout.', 409)
  const current = lower(referral.payoutStatus || allowed[0] || '')
  if (target === current) return { ...referral }
  const order = ['pending', 'approved', 'paid']
  if (order.includes(current) && order.includes(target) && order.indexOf(target) < order.indexOf(current)) {
    throw new ReferralError('Payout status cannot move backwards.', 409)
  }
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  return { ...referral, payoutStatus: target, payoutUpdatedAt: at, payoutUpdatedBy: actorId || null, ...(target === 'paid' ? { paidAt: at } : {}) }
}

function referralSourceAttribution(referral) {
  return { source: referral?.source || 'Employee referral', sourceCategory: 'referral', referralId: referral?.id || null, referrerId: referral?.referrerId || null }
}

module.exports = { ReferralError, isEligibleReferrer, findReferralDuplicates, prepareReferralSubmission, rewardForMilestone, recordReferralMilestone, updatePayoutStatus, referralSourceAttribution }
