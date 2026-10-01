'use strict'

class OnboardingChecklistError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'OnboardingChecklistError'
    this.status = status
  }
}

const allowedStatuses = new Set(['pending', 'completed'])

function normalizeDueDate(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OnboardingChecklistError('Due date must use YYYY-MM-DD format.')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new OnboardingChecklistError('Due date is not a valid calendar date.')
  }
  return value
}

function checklistFromTemplate(template, { joiningDate = null, ownerId = null } = {}) {
  const tasks = template?.tasks || template?.checklist || []
  const joinDate = joiningDate && new Date(`${joiningDate}T00:00:00.000Z`)
  return tasks.map((task, index) => {
    const item = typeof task === 'string' ? { title: task } : task
    const id = item.id || `onboarding-task-${index + 1}`
    let dueDate = item.dueDate || null
    if (!dueDate && joinDate && Number.isFinite(joinDate.valueOf()) && Number.isFinite(Number(item.daysFromJoining))) {
      const due = new Date(joinDate)
      due.setUTCDate(due.getUTCDate() + Number(item.daysFromJoining))
      dueDate = due.toISOString().slice(0, 10)
    }
    return {
      id,
      title: item.title || item.name || `Onboarding task ${index + 1}`,
      required: item.required !== false,
      status: 'pending',
      assigneeId: item.assigneeId || ownerId || null,
      dueDate: normalizeDueDate(dueDate),
    }
  })
}

function templateItemIds(template) {
  const tasks = template?.tasks || template?.checklist
  if (!Array.isArray(tasks)) return null
  return new Set(tasks.map((item, index) => typeof item === 'string' ? `onboarding-task-${index + 1}` : (item.id || `onboarding-task-${index + 1}`)))
}

function transitionChecklistItem(onboarding, { itemId, status, assigneeId, dueDate } = {}, { template } = {}) {
  if (!onboarding || !Array.isArray(onboarding.checklist)) throw new OnboardingChecklistError('Onboarding checklist was not found.', 404)
  if (typeof itemId !== 'string' || !itemId.trim()) throw new OnboardingChecklistError('A checklist item ID is required.')
  if (!allowedStatuses.has(status)) throw new OnboardingChecklistError('Checklist status must be pending or completed.')
  const ids = templateItemIds(template)
  if (ids && !ids.has(itemId)) throw new OnboardingChecklistError('Checklist item does not belong to the configured template.', 404)
  const index = onboarding.checklist.findIndex(item => item.id === itemId)
  if (index < 0) throw new OnboardingChecklistError('Checklist item was not found.', 404)
  const current = onboarding.checklist[index]
  const completing = status === 'completed'
  if (current.status === status) throw new OnboardingChecklistError(`Checklist item is already ${status}.`, 409)
  if (completing && current.status !== 'pending') throw new OnboardingChecklistError('Only pending checklist items can be completed.', 409)
  if (!completing && current.status !== 'completed') throw new OnboardingChecklistError('Only completed checklist items can be reopened.', 409)

  const next = { ...current, status, completedAt: completing ? new Date().toISOString() : null }
  if (assigneeId !== undefined) {
    if (assigneeId !== null && (typeof assigneeId !== 'string' || !assigneeId.trim())) throw new OnboardingChecklistError('Assignee ID must be a non-empty string or null.')
    next.assigneeId = assigneeId
  }
  if (dueDate !== undefined) next.dueDate = normalizeDueDate(dueDate)
  const checklist = onboarding.checklist.map((item, itemIndex) => itemIndex === index ? next : item)
  return { ...onboarding, checklist, checklistSummary: summarizeChecklist({ ...onboarding, checklist }) }
}

function summarizeChecklist(onboarding, now = new Date()) {
  const checklist = Array.isArray(onboarding?.checklist) ? onboarding.checklist : []
  const completed = checklist.filter(item => item.status === 'completed').length
  const required = checklist.filter(item => item.required !== false)
  const requiredIncomplete = required.filter(item => item.status !== 'completed').length
  const today = new Date(now).toISOString().slice(0, 10)
  const overdue = checklist.filter(item => item.status !== 'completed' && item.dueDate && item.dueDate < today).length
  return {
    total: checklist.length,
    completed,
    completionPercent: checklist.length ? Math.round((completed / checklist.length) * 100) : 100,
    requiredIncomplete,
    overdue,
    canComplete: requiredIncomplete === 0,
  }
}

function completeOnboarding(onboarding) {
  const summary = summarizeChecklist(onboarding)
  if (!summary.canComplete) throw new OnboardingChecklistError('Required onboarding checklist items must be completed first.', 409)
  return { ...onboarding, status: 'completed', completedAt: new Date().toISOString(), checklistSummary: summary }
}

module.exports = { OnboardingChecklistError, checklistFromTemplate, transitionChecklistItem, summarizeChecklist, completeOnboarding }
