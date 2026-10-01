'use strict'

const { WorkflowError } = require('./workflows')

const PERIOD = /^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2])|\d{4}-Q[1-4])$/
const MAX_ROLE_LENGTH = 120

function normalizeDimension(value, entries, label) {
  if (value == null || value === '') return value
  if (typeof value !== 'string' || !value.trim()) throw new WorkflowError(`${label} must reference a configured organization dimension.`, 422)
  const normalized = value.trim()
  const item = (Array.isArray(entries) ? entries : []).find(candidate => candidate &&
    (String(candidate.id) === normalized || String(candidate.name || '').trim().toLowerCase() === normalized.toLowerCase()))
  if (!item) throw new WorkflowError(`${label} must match a configured organization ID or name.`, 422)
  return String(item.name).trim()
}

function validateWorkforceTarget(input, config = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkflowError('Workforce target must be an object.', 422)
  const data = { ...input }
  if (typeof data.period !== 'string' || !PERIOD.test(data.period)) throw new WorkflowError('period must be a year (YYYY), month (YYYY-MM), or quarter (YYYY-Q1 through YYYY-Q4).', 422)
  const rawTarget = data.target ?? data.headcount
  const target = typeof rawTarget === 'string' && /^\d+$/.test(rawTarget.trim()) ? Number(rawTarget.trim()) : rawTarget
  if (typeof target !== 'number' || !Number.isSafeInteger(target) || target <= 0) throw new WorkflowError('target must be a positive whole-number headcount.', 422)
  data.target = target
  if (Object.hasOwn(data, 'headcount')) delete data.headcount
  const org = config.organization || {}
  for (const [field, idField, entries, label] of [
    ['department', 'departmentId', org.units, 'department'],
    ['location', 'locationId', org.locations, 'location'],
  ]) {
    const supplied = data[field] ?? data[idField]
    if (supplied != null && supplied !== '') data[field] = normalizeDimension(supplied, entries, label)
    else if (supplied === '') data[field] = ''
    delete data[idField]
  }
  if (data.role != null && (typeof data.role !== 'string' || data.role.trim().length === 0 || data.role.trim().length > MAX_ROLE_LENGTH)) {
    throw new WorkflowError(`role must be a non-empty string of at most ${MAX_ROLE_LENGTH} characters.`, 422)
  }
  if (typeof data.role === 'string') data.role = data.role.trim()
  return data
}

function validateWorkforceTargetEdit(before, delta, config = {}) {
  const merged = { ...before, ...delta }
  if (Object.hasOwn(delta, 'headcount') && !Object.hasOwn(delta, 'target')) merged.target = delta.headcount
  if (Object.hasOwn(delta, 'departmentId') && !Object.hasOwn(delta, 'department')) merged.department = delta.departmentId
  if (Object.hasOwn(delta, 'locationId') && !Object.hasOwn(delta, 'location')) merged.location = delta.locationId
  const normalized = validateWorkforceTarget(merged, config)
  const patch = { ...delta }
  for (const field of ['period', 'department', 'location', 'role', 'target']) {
    if (Object.hasOwn(delta, field) ||
      (field === 'department' && Object.hasOwn(delta, 'departmentId')) ||
      (field === 'location' && Object.hasOwn(delta, 'locationId')) ||
      (field === 'target' && Object.hasOwn(delta, 'headcount'))) patch[field] = normalized[field]
  }
  delete patch.departmentId
  delete patch.locationId
  delete patch.headcount
  return patch
}

module.exports = { validateWorkforceTarget, validateWorkforceTargetEdit, MAX_ROLE_LENGTH }
