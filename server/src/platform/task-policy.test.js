'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_TASK_PRIORITIES,
  DEFAULT_TASK_STATUSES,
  TaskPolicyError,
  getTaskPolicy,
  normalizeTaskDueDate,
  normalizeTaskFields,
  normalizeTaskPriority,
  normalizeTaskStatus,
  taskWorkflowStatus,
  isTaskOverdue,
} = require('./task-policy')

test('task policy defaults remain backward compatible', () => {
  assert.deepEqual(getTaskPolicy({}).priorities, [...DEFAULT_TASK_PRIORITIES])
  assert.deepEqual(getTaskPolicy({}).statuses, [...DEFAULT_TASK_STATUSES])
  assert.deepEqual(normalizeTaskFields({}), { priority: 'normal', status: 'open', dueDate: null })
  assert.equal(normalizeTaskPriority('medium'), 'normal')
  assert.equal(normalizeTaskStatus('completed'), 'done')
})

test('configured task choices are normalized against tenant values', () => {
  const config = { tasks: { priorities: [' P3 ', 'P2', 'P1'], statuses: ['To Do', 'Doing', 'Finished'] } }
  assert.equal(normalizeTaskPriority(' p2 ', config), 'P2')
  assert.equal(normalizeTaskStatus('to-do', config), 'To Do')
  assert.equal(normalizeTaskStatus('FINISHED', config), 'Finished')
  assert.throws(() => normalizeTaskPriority('urgent', config), TaskPolicyError)
  assert.throws(() => normalizeTaskStatus('unknown', config), TaskPolicyError)
  // Canonical create/complete states remain available to existing workflows.
  assert.equal(normalizeTaskStatus('open', config), 'open')
  assert.equal(normalizeTaskStatus('done', config), 'done')
})

test('workflow actions use optional configured lifecycle targets', () => {
  const config = { tasks: {
    statuses: ['todo', 'doing', 'finished'],
    openStatus: 'todo',
    completedStatus: 'finished',
  } }
  assert.equal(taskWorkflowStatus(config, 'reopen'), 'todo')
  assert.equal(taskWorkflowStatus(config, 'complete'), 'finished')
  assert.equal(taskWorkflowStatus({}, 'complete'), 'done')
  assert.equal(taskWorkflowStatus({}, 'reopen'), 'open')
  assert.throws(() => taskWorkflowStatus(config, 'archive'), TaskPolicyError)
  assert.throws(() => taskWorkflowStatus({ tasks: { completedStatus: 'archived' } }, 'complete'), TaskPolicyError)
})

test('partial updates only return supplied fields; full updates retain defaults', () => {
  assert.deepEqual(normalizeTaskFields({ status: 'in-progress' }, undefined, { partial: true }), { status: 'in_progress' })
  assert.deepEqual(normalizeTaskFields({ dueDate: null }, undefined, { partial: true }), { dueDate: null })
  assert.throws(() => normalizeTaskFields([], undefined), /object/)
})

test('due dates accept calendar dates and ISO timestamps, rejecting malformed dates', () => {
  assert.equal(normalizeTaskDueDate('2026-04-30'), '2026-04-30')
  assert.equal(normalizeTaskDueDate('2026-04-30T10:15:00+02:00'), '2026-04-30T08:15:00.000Z')
  assert.equal(normalizeTaskDueDate(null), null)
  assert.throws(() => normalizeTaskDueDate('2026-02-30'), /valid calendar date/)
  assert.throws(() => normalizeTaskDueDate('2026-04-30Tnot-a-time'), /ISO timestamp/)
})

test('due-date aging excludes terminal tasks and handles date-only boundaries', () => {
  const asOf = new Date('2026-04-30T12:00:00.000Z')
  assert.equal(isTaskOverdue({ dueDate: '2026-04-29', status: 'open' }, { asOf }), true)
  assert.equal(isTaskOverdue({ dueDate: '2026-04-30', status: 'open' }, { asOf }), false)
  assert.equal(isTaskOverdue({ dueAt: '2026-04-30T11:59:00Z', status: 'doing' }, { asOf, config: { tasks: { terminalStatuses: ['finished'] } } }), true)
  assert.equal(isTaskOverdue({ dueDate: '2026-04-29', status: 'finished' }, { asOf, config: { tasks: { terminalStatuses: ['finished'] } } }), false)
  assert.equal(isTaskOverdue({ status: 'open' }, { asOf }), false)
})
