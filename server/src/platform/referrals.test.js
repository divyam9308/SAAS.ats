'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ReferralError, isEligibleReferrer, findReferralDuplicates, prepareReferralSubmission, recordReferralMilestone, updatePayoutStatus, referralSourceAttribution } = require('./referrals')

const config = { modules: { referrals: true }, referrals: { enabled: true, eligibility: 'employees', duplicatePolicy: 'review', rewards: [{ id: 'joined-bonus', milestone: 'joined', amount: 500, currency: 'USD' }], milestones: ['hired', 'joined'], payoutStatuses: ['pending', 'approved', 'paid'] }, regional: { currency: 'USD' } }
const users = [{ id: 'employee-1', name: 'Sam Rivera', roleId: 'employee' }, { id: 'agency-1', roleId: 'agency-consultant' }, { id: 'inactive', roleId: 'employee', active: false }]
const candidates = [{ id: 'candidate-1', name: 'Ari Singh', email: 'ari@example.test' }]
const jobs = [{ id: 'job-1', title: 'Designer', status: 'open' }, { id: 'job-closed', title: 'Closed role', status: 'closed' }]

test('eligible employee can submit consented candidate details; attribution and fields are normalized', () => {
  const result = prepareReferralSubmission({ input: { candidateDetails: { name: ' Ari Singh ', email: 'ARI@example.test' }, consent: true, jobId: 'job-1' }, actor: { id: 'employee-1' }, users, candidates, jobs, config, now: '2026-01-02T03:04:05Z' })
  assert.equal(result.status, 'submitted')
  assert.equal(result.candidateName, 'Ari Singh')
  assert.equal(result.candidateId, null)
  assert.equal(result.candidateDetails.email, 'ari@example.test')
  assert.equal(result.referrer, 'Sam Rivera')
  assert.equal(result.sourceCategory, 'referral')
  assert.equal(result.payoutStatus, 'pending')
  assert.deepEqual(referralSourceAttribution({ ...result, id: 'r1' }), { source: 'Employee referral', sourceCategory: 'referral', referralId: 'r1', referrerId: 'employee-1' })
})

test('disabled module, inactive user, ineligible consultant and missing records are rejected', () => {
  assert.throws(() => prepareReferralSubmission({ actor: { id: 'employee-1' }, users, candidates, config: { modules: { referrals: false }, referrals: { enabled: false } } }), error => error instanceof ReferralError && error.status === 403)
  assert.equal(isEligibleReferrer({ actor: { id: 'agency-1' }, users, config }), false)
  assert.equal(isEligibleReferrer({ actor: { id: 'inactive' }, users, config }), false)
  assert.throws(() => prepareReferralSubmission({ input: { candidateId: 'candidate-1' }, actor: { id: 'employee-1' }, users, config, candidates, jobs }), error => error.status === 403)
  assert.throws(() => prepareReferralSubmission({ input: { candidateDetails: { name: 'Ari Singh', email: 'ari@example.test' } }, actor: { id: 'employee-1' }, users, config, candidates, jobs }), error => error.status === 422)
  assert.throws(() => prepareReferralSubmission({ input: { candidateDetails: { name: 'Ari Singh', email: 'ari@example.test' }, consent: true, jobId: 'job-closed' }, actor: { id: 'employee-1' }, users, config, candidates, jobs }), error => error.status === 404)
})

test('duplicate referral and application are marked for review without exposing existing IDs', () => {
  const referrals = [{ id: 'prior', candidateId: 'candidate-1', jobId: 'job-1', referrerId: 'someone-else' }]
  const applications = [{ id: 'app-1', candidateId: 'candidate-1', candidateEmail: 'ari@example.test', jobId: 'job-1' }]
  const duplicates = findReferralDuplicates({ candidate: candidates[0], jobId: 'job-1', referrerId: 'employee-1', referrals, applications })
  assert.deepEqual(duplicates, [{ kind: 'duplicate' }])
  const review = prepareReferralSubmission({ input: { candidateDetails: { name: 'Ari Singh', email: 'ARI@example.test' }, consent: true, jobId: 'job-1' }, actor: { id: 'employee-1' }, users, candidates, jobs, referrals, applications, config })
  assert.equal(review.status, 'duplicate_review')
  assert.equal(review.duplicateReview, true)
  assert.equal(JSON.stringify(review).includes('prior'), false)
  assert.equal(JSON.stringify(review).includes('app-1'), false)
  assert.throws(() => prepareReferralSubmission({ input: { candidateDetails: { name: 'Ari Singh', email: 'ari@example.test' }, consent: true, jobId: 'job-1' }, actor: { id: 'employee-1' }, users, candidates, jobs, referrals, applications, config: { ...config, referrals: { ...config.referrals, duplicatePolicy: 'block' } } }), error => error.status === 409 && !error.details)
})

test('existing-candidate selection works only when explicitly enabled', () => {
  const result = prepareReferralSubmission({ input: { candidateId: 'candidate-1' }, actor: { id: 'employee-1' }, users, candidates, jobs, config: { ...config, referrals: { ...config.referrals, allowExistingCandidateSelection: true } } })
  assert.equal(result.candidateId, 'candidate-1')
  assert.equal(result.candidateDetails, undefined)
})

test('configured milestone earns a local reward once; unconfigured milestone is rejected', () => {
  const first = recordReferralMilestone({ id: 'r1', jobId: 'job-1', milestonesCompleted: [] }, 'joined', config, { now: '2026-02-01T00:00:00Z' })
  assert.deepEqual(first.reward, { id: 'joined-bonus', name: 'joined referral reward', amount: 500, currency: 'USD', milestone: 'joined' })
  assert.equal(first.payoutStatus, 'pending')
  assert.equal(first.milestonesCompleted.length, 1)
  assert.equal(recordReferralMilestone(first, 'joined', config).milestonesCompleted.length, 1)
  assert.throws(() => recordReferralMilestone(first, 'offered', config), error => error.status === 422)
})

test('payout tracking is configured and monotonic; no payment provider is invoked', () => {
  const referral = { id: 'r1', reward: { amount: 500 }, payoutStatus: 'pending' }
  const approved = updatePayoutStatus(referral, 'approved', config, { actorId: 'finance-1', now: '2026-02-02T00:00:00Z' })
  assert.equal(approved.payoutUpdatedBy, 'finance-1')
  const paid = updatePayoutStatus(approved, 'paid', config, { actorId: 'finance-1', now: '2026-02-03T00:00:00Z' })
  assert.equal(paid.paidAt, '2026-02-03T00:00:00.000Z')
  assert.deepEqual(updatePayoutStatus(paid, 'paid', config, { actorId: 'other', now: '2026-02-04T00:00:00Z' }), paid)
  assert.throws(() => updatePayoutStatus(paid, 'pending', config), error => error.status === 409)
  assert.throws(() => updatePayoutStatus({ payoutStatus: 'pending' }, 'paid', config), error => error.status === 409)
  assert.throws(() => updatePayoutStatus(referral, 'cancelled', config), error => error.status === 422)
})
