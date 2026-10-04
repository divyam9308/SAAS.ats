import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { interviewScorecard, scorecardCriteria, scorecardLabelList, scorecardRatings } from './scorecard-presentation.js'
const { resolveScorecard, criteriaForScorecard } = createRequire(import.meta.url)('../../server/src/platform/scorecard-engine.js')

test('feedback display selects the same scorecard as the backend for explicit, plan, job, role and default interviews', () => {
  const config = { scorecards: [{ id: 'first' }, { id: 'default', default: true }, { id: 'plan' }, { id: 'job', jobIds: ['job-1'] }, { id: 'role', roleIds: ['role-1'] }], interviewPlans: [{ id: 'plan-1', rounds: [{ id: 'round-1', scorecardId: 'plan' }] }] }
  for (const interview of [{}, { scorecardId: 'first' }, { scorecardId: 'missing' }, { interviewPlanId: 'plan-1', roundId: 'round-1' }, { jobId: 'job-1' }, { roleId: 'role-1' }, { jobScorecardId: 'job' }]) assert.equal(interviewScorecard(config, interview)?.id, resolveScorecard(config, interview)?.id)
})

test('interviewer-specific criteria match the backend for both legacy maps and configured arrays', () => {
  for (const interviewerCriteria of [{ 'user-a': [{ id: 'technical' }] }, [{ interviewerId: 'user-a', criteria: [{ id: 'technical' }] }]]) {
    const card = { competencies: [{ id: 'general' }], interviewerCriteria }
    for (const interviewerId of ['user-a', 'user-b']) assert.deepEqual(scorecardCriteria(card, interviewerId), criteriaForScorecard(card, { interviewerId }))
  }
})

test('configured rating labels align with the actual lowest and highest ratings', () => {
  assert.deepEqual(scorecardRatings({ ratingScale: { min: 0, max: 2, labels: ['Low', 'Medium', 'High'] } }), [{ value: 0, label: '0 · Low' }, { value: 1, label: '1 · Medium' }, { value: 2, label: '2 · High' }])
  assert.deepEqual(scorecardRatings({ ratingScale: { min: 3, max: 4, labels: { 3: 'Good', 4: 'Great' } } }), [{ value: 3, label: '3 · Good' }, { value: 4, label: '4 · Great' }])
  assert.deepEqual(scorecardRatings({ ratingScale: { min: 6, max: 1 } }), [])
  assert.deepEqual(scorecardLabelList({ min: 3, max: 4, labels: { 4: 'Great', 3: 'Good' } }), ['Good', 'Great'])
  assert.deepEqual(scorecardLabelList({ min: 0, max: 2, labels: ['Low', 'Medium', 'High'] }), ['Low', 'Medium', 'High'])
})
