'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateSla } = require('./sla-rules')

test('evaluates application review, stage duration, feedback, and offer approval from stored timestamps', () => {
  const recordsByKind = {
    applications: [
      { id: 'app-1', status: 'new', appliedAt: '2026-09-20T12:00:00Z', stage: 'screen', stageChangedAt: '2026-09-22T12:00:00Z' },
    ],
    interviews: [{ id: 'int-1', applicationId: 'app-1', status: 'completed', completedAt: '2026-09-22T12:00:00Z' }],
    feedback: [],
    offers: [{ id: 'offer-1', status: 'pending_approval', submittedAt: '2026-09-23T12:00:00Z' }],
  }
  const before = structuredClone(recordsByKind)
  const result = evaluateSla({ recordsByKind, config: { sla: {
    applicationReview: { days: 2 }, pipelineStage: { default: { days: 1 } },
    interviewFeedback: { hours: 24 }, offerApproval: { days: 1 },
  } }, now: '2026-09-24T12:00:00Z' })

  assert.deepEqual(result.items.map(item => item.type), ['application_review', 'pipeline_stage', 'interview_feedback', 'offer_approval'])
  assert.equal(result.items.filter(item => item.overdue).length, 4)
  assert.equal(result.items[0].overdueReason, 'application_review_sla_exceeded')
  assert.equal(result.summary.overdue, 4)
  assert.deepEqual(recordsByKind, before, 'evaluation must not mutate source records')
})

test('does not emit disabled or non-applicable items and reports no SLA items when rules are absent', () => {
  const recordsByKind = {
    applications: [
      { id: 'disabled', status: 'new', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'closed', status: 'rejected', createdAt: '2026-01-01T00:00:00Z' },
    ],
    interviews: [{ id: 'done', status: 'completed', completedAt: '2026-01-01T00:00:00Z' }],
    offers: [{ id: 'approved', status: 'approved', submittedAt: '2026-01-01T00:00:00Z' }],
  }
  const result = evaluateSla({ recordsByKind, config: { sla: {
    applicationReview: { enabled: false, days: 1 }, interviewFeedback: { enabled: false, hours: 1 },
    offerApproval: { days: 1 },
  } }, now: '2026-01-10T00:00:00Z' })
  assert.deepEqual(result.items, [])
  assert.deepEqual(result.summary, { total: 0, overdue: 0, onTrack: 0, byType: {} })
  assert.equal(evaluateSla({ recordsByKind, config: {}, now: '2026-01-10T00:00:00Z' }).summary.total, 0)
})

test('supports legacy flat ATS SLA fields and gives structured rules precedence', () => {
  const result = evaluateSla({
    recordsByKind: {
      applications: [{ id: 'app', status: 'new', stage: 'interview', createdAt: '2026-09-01T12:00:00Z', stageChangedAt: '2026-09-01T12:00:00Z' }],
      interviews: [{ id: 'interview', status: 'completed', completedAt: '2026-09-01T12:00:00Z' }],
      offers: [{ id: 'offer', status: 'pending_approval', submittedAt: '2026-09-01T12:00:00Z' }],
    },
    config: { sla: {
      applicationReviewHours: 72, interviewFeedbackHours: 24, offerApprovalHours: 48, defaultStageDays: 14,
      applicationReview: { hours: 12 },
    } },
    now: '2026-09-24T12:00:00Z',
  })
  const byType = Object.fromEntries(result.items.map(item => [item.type, item]))
  assert.deepEqual(Object.keys(byType).sort(), ['application_review', 'interview_feedback', 'offer_approval', 'pipeline_stage'])
  assert.deepEqual(byType.application_review.threshold, { amount: 12, unit: 'hours' }, 'structured threshold overrides the legacy 72-hour default')
  assert.deepEqual(byType.pipeline_stage.threshold, { amount: 14, unit: 'days' })
  assert.deepEqual(byType.interview_feedback.threshold, { amount: 24, unit: 'hours' })
  assert.deepEqual(byType.offer_approval.threshold, { amount: 48, unit: 'hours' })
  assert.equal(result.summary.overdue, 4, 'legacy defaults should produce aging items rather than an empty SLA snapshot')
})

test('working-hour threshold carries across weekend in configured regional timezone', () => {
  const result = evaluateSla({
    recordsByKind: { applications: [{ id: 'app', status: 'new', createdAt: '2026-09-25T20:00:00Z' }] },
    config: { regional: { timeZone: 'America/New_York', workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], workingHours: { start: '09:00', end: '17:00' } }, sla: { workingHours: { start: '09:00', end: '17:00' }, applicationReview: { hours: 2 } } },
    now: '2026-09-28T14:00:00Z',
  })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].dueAt, '2026-09-28T14:00:00.000Z')
  assert.equal(result.items[0].status, 'overdue', 'deadline instant counts as overdue')
})

test('working-day duration skips Saturday and Sunday and stage overrides are selected', () => {
  const result = evaluateSla({
    recordsByKind: { applications: [{ id: 'app', status: 'active', stage: 'interview', stageChangedAt: '2026-09-25T15:30:00Z' }] },
    config: { sla: { pipelineStage: { default: { days: 5 }, stages: { interview: { days: 1 } } } } },
    now: '2026-09-28T15:30:00Z',
  })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].type, 'pipeline_stage')
  assert.equal(result.items[0].dueAt, '2026-09-28T15:30:00.000Z')
  assert.equal(result.items[0].overdue, true)
})

test('missing or invalid timestamps are omitted; completed feedback suppresses its interview SLA', () => {
  const result = evaluateSla({
    recordsByKind: {
      applications: [{ id: 'missing', status: 'new' }, { id: 'bad', status: 'new', createdAt: 'not-a-date' }],
      interviews: [
        { id: 'submitted', applicationId: 'app-1', status: 'completed', completedAt: '2026-09-01T00:00:00Z' },
        { id: 'missing-start', status: 'completed' },
      ],
      feedback: [{ id: 'f1', interviewId: 'submitted', status: 'submitted', submittedAt: '2026-09-01T01:00:00Z' }],
      offers: [{ id: 'no-time', status: 'pending_approval' }],
    },
    config: { sla: { applicationReview: { days: 1 }, interviewFeedback: { days: 1 }, offerApproval: { days: 1 } } },
    now: '2026-09-24T00:00:00Z',
  })
  assert.deepEqual(result.items, [])
})

test('invalid injected now is rejected instead of reading the system clock', () => {
  assert.throws(() => evaluateSla({ now: 'invalid' }), /now must be a valid date/)
})
