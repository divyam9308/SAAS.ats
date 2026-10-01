'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  OnboardingChecklistError,
  checklistFromTemplate,
  transitionChecklistItem,
  summarizeChecklist,
  completeOnboarding,
} = require('./onboarding-checklist')

const template = { id: 'standard', tasks: [
  { id: 'documents', title: 'Collect documents', required: true, daysFromJoining: -3 },
  { id: 'welcome', title: 'Prepare welcome', required: false, daysFromJoining: 0 },
] }

function onboarding() {
  return { id: 'onboard-1', status: 'in_progress', joiningDate: '2026-10-10', checklist: checklistFromTemplate(template, { joiningDate: '2026-10-10' }) }
}

test('builds checklist from configured template with derived due dates and defaults', () => {
  const plan = onboarding()
  assert.deepEqual(plan.checklist.map(item => [item.id, item.status, item.dueDate]), [
    ['documents', 'pending', '2026-10-07'],
    ['welcome', 'pending', '2026-10-10'],
  ])
  assert.equal(plan.checklist[0].required, true)
})

test('completes and reopens checklist items without mutating persisted input', () => {
  const plan = onboarding()
  const completed = transitionChecklistItem(plan, { itemId: 'documents', status: 'completed' }, { template })
  assert.equal(completed.checklist[0].status, 'completed')
  assert.equal(completed.checklist[0].completedAt != null, true)
  assert.equal(plan.checklist[0].status, 'pending')
  assert.equal(completed.checklistSummary.completionPercent, 50)
  const reopened = transitionChecklistItem(completed, { itemId: 'documents', status: 'pending', assigneeId: 'user-1', dueDate: '2026-10-08' }, { template })
  assert.equal(reopened.checklist[0].status, 'pending')
  assert.equal(reopened.checklist[0].completedAt, null)
  assert.equal(reopened.checklist[0].assigneeId, 'user-1')
  assert.equal(reopened.checklist[0].dueDate, '2026-10-08')
})

test('summarizes required completion and overdue checklist items', () => {
  const plan = onboarding()
  const summary = summarizeChecklist(plan, new Date('2026-10-09T12:00:00Z'))
  assert.equal(summary.total, 2)
  assert.equal(summary.completed, 0)
  assert.equal(summary.completionPercent, 0)
  assert.equal(summary.requiredIncomplete, 1)
  assert.equal(summary.overdue, 1)
  assert.equal(summary.canComplete, false)
})

test('blocks onboarding completion until required tasks are completed', () => {
  const plan = onboarding()
  assert.throws(() => completeOnboarding(plan), { name: 'OnboardingChecklistError', status: 409 })
  const requiredComplete = transitionChecklistItem(plan, { itemId: 'documents', status: 'completed' }, { template })
  assert.equal(completeOnboarding(requiredComplete).status, 'completed')
})

test('rejects unknown template items, invalid transitions and malformed assignment or due date', () => {
  const plan = onboarding()
  assert.throws(() => transitionChecklistItem(plan, { itemId: 'foreign', status: 'completed' }, { template }), OnboardingChecklistError)
  assert.throws(() => transitionChecklistItem(plan, { itemId: 'documents', status: 'done' }), /pending or completed/)
  assert.throws(() => transitionChecklistItem(plan, { itemId: 'documents', status: 'completed', assigneeId: '  ' }), /Assignee ID/)
  assert.throws(() => transitionChecklistItem(plan, { itemId: 'documents', status: 'completed', dueDate: '2026-02-30' }), /valid calendar date/)
  const completed = transitionChecklistItem(plan, { itemId: 'documents', status: 'completed' })
  assert.throws(() => transitionChecklistItem(completed, { itemId: 'documents', status: 'completed' }), /already completed/)
})
