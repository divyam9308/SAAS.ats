'use strict'

// The task UI and existing automation use these values when a company has no
// task policy configured. Keep the defaults aligned with shared/ats-config.cjs.
const DEFAULT_TASK_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent'])
const DEFAULT_TASK_STATUSES = Object.freeze(['open', 'in_progress', 'done', 'cancelled'])
// These remain valid even when a tenant customizes its visible task statuses:
// existing create/reopen/complete workflows rely on the lifecycle endpoints.
const REQUIRED_WORKFLOW_STATUSES = Object.freeze(['open', 'done'])
const LEGACY_TERMINAL_STATUSES = Object.freeze(['done', 'completed', 'complete', 'cancelled', 'canceled'])

class TaskPolicyError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'TaskPolicyError'
    this.status = status
  }
}

function configuredValues(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const cleaned = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue
    const label = item.trim()
    const normalized = key(label)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    cleaned.push(label)
  }
  return cleaned.length ? cleaned : [...fallback]
}

function getTaskPolicy(config = {}) {
  const taskConfig = config?.tasks || {}
  return {
    priorities: configuredValues(taskConfig.priorities, DEFAULT_TASK_PRIORITIES),
    statuses: (() => {
      const configured = configuredValues(taskConfig.statuses, DEFAULT_TASK_STATUSES)
      const byKey = new Map(configured.map(value => [key(value), value]))
      for (const status of REQUIRED_WORKFLOW_STATUSES) {
        if (!byKey.has(key(status))) byKey.set(key(status), status)
      }
      return [...byKey.values()]
    })(),
    // Historical task records use these terminal names even when a tenant has
    // since customized its current status choices.
    terminalStatuses: [...new Set([
      ...LEGACY_TERMINAL_STATUSES,
      ...(Array.isArray(taskConfig.terminalStatuses) ? taskConfig.terminalStatuses : []),
    ].filter(value => typeof value === 'string').map(value => value.trim().toLowerCase()).filter(Boolean))],
  }
}

// Map lifecycle actions to tenant-configured status values, falling back to
// the historical canonical statuses. Custom values are accepted when included
// in tasks.statuses; `open` and `done` are always available for compatibility.
function taskWorkflowStatus(config, actionName) {
  const taskConfig = config?.tasks || {}
  const target = actionName === 'complete'
    ? (taskConfig.completedStatus || 'done')
    : actionName === 'reopen'
      ? (taskConfig.openStatus || 'open')
      : null
  if (!target) throw new TaskPolicyError('Task action must be complete or reopen.', 400)
  return normalizeChoice(target, getTaskPolicy(config).statuses, 'status')
}

function key(value) {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeChoice(value, allowed, field, aliases = {}) {
  const choices = new Map(allowed.map(choice => [key(choice), choice]))
  const normalized = key(value)
  const aliasTarget = aliases[normalized]
  const result = choices.get(normalized) || (aliasTarget ? choices.get(key(aliasTarget)) : null)
  if (!result) throw new TaskPolicyError(`Task ${field} must be one of: ${allowed.join(', ')}.`)
  return result
}

function normalizeTaskPriority(value, config) {
  const policy = getTaskPolicy(config)
  return normalizeChoice(value, policy.priorities, 'priority', { medium: 'normal', med: 'normal' })
}

function normalizeTaskStatus(value, config) {
  const policy = getTaskPolicy(config)
  return normalizeChoice(value, policy.statuses, 'status', {
    complete: 'done', completed: 'done',
    'in-progress': 'in_progress',
    canceled: 'cancelled',
  })
}

function normalizeTaskDueDate(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new TaskPolicyError('Task due date must be a YYYY-MM-DD date or ISO timestamp.')
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new TaskPolicyError('Task due date is not a valid calendar date.')
    }
    return value
  }
  const parsed = new Date(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(parsed.valueOf())) {
    throw new TaskPolicyError('Task due date must be a YYYY-MM-DD date or ISO timestamp.')
  }
  return parsed.toISOString()
}

// Full normalization supplies the established defaults. Partial normalization
// is intended for PATCH routes and only returns fields present in the payload.
function normalizeTaskFields(input = {}, config, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaskPolicyError('Task data must be an object.', 400)
  const value = {}
  if (!partial || Object.hasOwn(input, 'priority')) {
    value.priority = normalizeTaskPriority(input.priority || 'normal', config)
  }
  if (!partial || Object.hasOwn(input, 'status')) {
    value.status = normalizeTaskStatus(input.status || 'open', config)
  }
  if (!partial || Object.hasOwn(input, 'dueDate')) {
    value.dueDate = normalizeTaskDueDate(input.dueDate)
  }
  return value
}

function isTaskOverdue(task = {}, { asOf = new Date(), config } = {}) {
  const due = task.dueDate ?? task.dueAt
  if (due === undefined || due === null || due === '') return false
  const status = key(task.status || 'open')
  if (getTaskPolicy(config).terminalStatuses.includes(status)) return false
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf)
  if (!Number.isFinite(asOfDate.valueOf())) throw new TypeError('asOf must be a valid date.')
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const parsed = new Date(`${due}T00:00:00.000Z`)
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== due) return false
    return due < asOfDate.toISOString().slice(0, 10)
  }
  const dueAt = new Date(due)
  return Number.isFinite(dueAt.valueOf()) && dueAt.valueOf() <= asOfDate.valueOf()
}

module.exports = {
  DEFAULT_TASK_PRIORITIES,
  DEFAULT_TASK_STATUSES,
  TaskPolicyError,
  getTaskPolicy,
  taskWorkflowStatus,
  normalizeTaskDueDate,
  normalizeTaskFields,
  normalizeTaskPriority,
  normalizeTaskStatus,
  isTaskOverdue,
}
