'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { computePlatformMetrics } = require('./metrics')

test('pipeline conversion and stage durations use recorded stage movements', () => {
  const recordsByKind = {
    jobs: [{ id: 'j', pipelineId: 'p', status: 'open', department: 'Engineering', location: 'Remote' }],
    applications: [
      { id: 'a1', jobId: 'j', pipelineId: 'p', stage: 'interview', status: 'active', createdAt: '2026-09-01T00:00:00Z', stageChangedAt: '2026-09-05T00:00:00Z', stageHistory: [
        { stageId: 'applied', enteredAt: '2026-09-01T00:00:00Z', leftAt: '2026-09-02T00:00:00Z' },
        { stageId: 'screening', enteredAt: '2026-09-02T00:00:00Z', leftAt: '2026-09-05T00:00:00Z' },
        { stageId: 'interview', enteredAt: '2026-09-05T00:00:00Z', leftAt: null },
      ] },
      { id: 'a2', jobId: 'j', pipelineId: 'p', stage: 'rejected', status: 'rejected', createdAt: '2026-09-01T00:00:00Z', stageHistory: [
        { stageId: 'applied', enteredAt: '2026-09-01T12:00:00Z', leftAt: '2026-09-03T00:00:00Z' },
        { stageId: 'rejected', enteredAt: '2026-09-03T00:00:00Z', leftAt: null },
      ] },
    ],
  }
  const config = { pipelines: [{ id: 'p', name: 'Engineering', stages: [{ id: 'applied' }, { id: 'screening' }, { id: 'interview' }] }] }
  const metrics = computePlatformMetrics({ recordsByKind, config, nowValue: '2026-09-07T00:00:00Z' })
  const pipeline = metrics.pipeline.pipelines[0]
  assert.equal(pipeline.conversions[0].observedEntriesFrom, 2)
  assert.equal(pipeline.conversions[0].convertedToNext, 1)
  assert.equal(pipeline.conversions[0].conversionRatePercent, 50)
  assert.equal(pipeline.conversions[1].observedEntriesFrom, 1)
  assert.equal(pipeline.conversions[1].conversionRatePercent, 100)
  const screening = pipeline.stageAge.find(stage => stage.stage === 'screening')
  assert.equal(screening.completedVisits, 1)
  assert.equal(screening.completedAverageDays, 3)
  const interview = pipeline.stageAge.find(stage => stage.stage === 'interview')
  assert.equal(interview.currentAverageDays, 2)
  assert.equal(pipeline.dropOff.recordedTerminalTransitions, 1)
})

test('pipeline metrics do not invent conversion observations when stage history is missing', () => {
  const metrics = computePlatformMetrics({
    recordsByKind: { jobs: [{ id: 'j', pipelineId: 'p' }], applications: [{ id: 'a', jobId: 'j', stage: 'screening', status: 'active' }] },
    config: { pipelines: [{ id: 'p', stages: [{ id: 'applied' }, { id: 'screening' }] }] },
    nowValue: '2026-09-07T00:00:00Z',
  })
  const conversion = metrics.pipeline.pipelines[0].conversions[0]
  assert.equal(conversion.observedEntriesFrom, 0)
  assert.equal(conversion.convertedToNext, 0)
  assert.equal(conversion.conversionRatePercent, null)
})
