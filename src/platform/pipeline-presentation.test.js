import test from 'node:test'
import assert from 'node:assert/strict'
import { pipelineStageChoices } from './pipeline-presentation.js'

const stages = [{ id: 'new', name: 'Applied' }, { id: 'screen', name: 'Screening' }, { id: 'hired', name: 'Hired' }]

test('stage choices respect explicit graphs, closed stages and legacy sequential pipelines', () => {
  assert.deepEqual(pipelineStageChoices({ stages, transitions: [] }, 'new'), [])
  assert.deepEqual(pipelineStageChoices({ stages, transitions: [{ from: 'new', to: 'hired' }] }, 'new'), [stages[2]])
  assert.deepEqual(pipelineStageChoices({ stages }, 'Applied'), [stages[1]])
  assert.deepEqual(pipelineStageChoices({ stages }, 'missing'), [])
  assert.deepEqual(pipelineStageChoices({ stages }, 'hired'), [])
})

test('legacy stage restrictions constrain graph destinations instead of opening unconfigured moves', () => {
  const restricted = [{ ...stages[0], allowedTransitions: ['Screening'] }, ...stages.slice(1)]
  assert.deepEqual(pipelineStageChoices({ stages: restricted }, 'new'), [stages[1]])
  assert.deepEqual(pipelineStageChoices({ stages: restricted, transitions: [{ from: 'new', to: 'hired' }] }, 'new'), [])
})
