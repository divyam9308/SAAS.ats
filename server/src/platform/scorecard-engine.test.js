'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { assertFeedbackSubmissionAvailable, evaluateScorecard, resolveScorecard, ScorecardError } = require('./scorecard-engine')

const config = {
  scorecards: [
    { id: 'legacy', competencies: [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 3 }], ratingScale: { min: 1, max: 5 }, mandatoryFeedback: true },
    { id: 'role-card', roleIds: ['designer'], competencies: [{ id: 'craft', name: 'Craft', weight: 2 }] },
    { id: 'job-card', jobIds: ['job-1'], competencies: [{ id: 'delivery', name: 'Delivery' }] },
    { id: 'default-card', default: true, competencies: [{ id: 'general', name: 'General' }] }
  ],
  interviewPlans: [{ id: 'plan', rounds: [{ id: 'round', scorecardId: 'legacy' }] }]
}

test('scorecard resolution honors round and explicit selection, then job, role, default, legacy first', () => {
  assert.equal(resolveScorecard(config, { planId: 'plan', round: 'round' }).id, 'legacy')
  assert.equal(resolveScorecard(config, { scorecardId: 'job-card', planId: 'plan', roundId: 'round' }).id, 'job-card')
  assert.equal(resolveScorecard(config, { jobId: 'job-1' }).id, 'job-card')
  assert.equal(resolveScorecard(config, { roleId: 'designer' }).id, 'role-card')
  assert.equal(resolveScorecard({ scorecards: [config.scorecards[0]] }, {}).id, 'legacy')
  assert.equal(resolveScorecard({ scorecards: [] }, {}), null)
})

test('weighted score uses only rated criteria with positive weights and legacy defaults', () => {
  const result = evaluateScorecard(config.scorecards[0], { answers: { a: 2, b: 4 }, comments: 'Clear evidence' })
  assert.equal(result.weightedScore, 3.5)
  assert.equal(result.comments, 'Clear evidence')
})

test('required criteria, valid rating range, comments, and recommendation are enforced', () => {
  const card = { competencies: [{ id: 'a', name: 'A', required: true }], ratingScale: { min: 1, max: 5 }, mandatoryFeedback: true, recommendationRequired: true, recommendations: ['yes', 'no'] }
  assert.throws(() => evaluateScorecard(card, { answers: {}, comments: 'x', recommendation: 'yes' }), ScorecardError)
  assert.throws(() => evaluateScorecard(card, { answers: { a: 6 }, comments: 'x', recommendation: 'yes' }), ScorecardError)
  assert.throws(() => evaluateScorecard(card, { answers: { a: 4 }, comments: ' ', recommendation: 'yes' }), /Written interview feedback/)
  assert.throws(() => evaluateScorecard(card, { answers: { a: 4 }, comments: 'x' }), /recommendation is required/)
  assert.throws(() => evaluateScorecard(card, { answers: { a: 4 }, comments: 'x', recommendation: 'maybe' }), /configured recommendation/)
})

test('interviewer-specific criteria can replace standard criteria', () => {
  const card = { competencies: [{ id: 'general' }], interviewerCriteria: { 'user-1': [{ id: 'architecture', required: true }] } }
  const result = evaluateScorecard(card, { answers: { architecture: 4 } }, { interviewerId: 'user-1' })
  assert.deepEqual(result.criteria.map(item => item.id), ['architecture'])
})

test('submitted feedback is locked for the same interviewer, while other interviewers may submit', () => {
  const rows = [{ interviewId: 'i1', interviewerId: 'u1', status: 'submitted' }]
  assert.throws(() => assertFeedbackSubmissionAvailable(rows, 'i1', 'u1'), error => error.status === 409)
  assert.doesNotThrow(() => assertFeedbackSubmissionAvailable(rows, 'i1', 'u2'))
})
