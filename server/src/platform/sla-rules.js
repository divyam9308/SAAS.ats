'use strict'

const TERMINAL_APPLICATION = new Set(['hired', 'rejected', 'withdrawn', 'archived', 'closed'])
const REVIEW_STATUSES = new Set(['new', 'submitted', 'pending', 'review', 'in_review', 'screening', 'applied'])
const APPROVAL_STATUSES = new Set(['pending', 'pending_approval', 'approval_pending', 'awaiting_approval', 'submitted'])
const DAY_MS = 24 * 60 * 60 * 1000

function validDate(value) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function rows(records, kind) { return Array.isArray(records?.[kind]) ? records[kind] : [] }
function firstDate(record, keys) {
  for (const key of keys) {
    const date = validDate(record?.[key])
    if (date) return date
  }
  return null
}
function keyValue(value) { return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') }
function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { year: +values.year, month: +values.month, day: +values.day, hour: +values.hour, minute: +values.minute, second: +values.second, weekday: values.weekday }
}
function localDateTimeToUtc(parts, timeZone) {
  // Iteratively correct the UTC guess against the requested regional wall clock.
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0)
  let guess = desired
  for (let index = 0; index < 3; index++) {
    const actual = localParts(new Date(guess), timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    guess += desired - represented
  }
  return new Date(guess)
}
function shiftLocalDate(parts, delta) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}
function normalizeWorkingDays(value) {
  const names = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 }
  if (!Array.isArray(value)) return new Set([1, 2, 3, 4, 5])
  return new Set(value.map(day => Number.isInteger(day) ? day : names[String(day).toLowerCase()]).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))
}
function isWorkingDay(parts, workingDays, timeZone) {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  return workingDays.has(weekday)
}
function clockHour(value, fallback) {
  if (Number.isFinite(value)) return Math.max(0, Math.min(24, value))
  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2})(?::(\d{2}))?$/)
    if (match && +match[1] <= 24 && +(match[2] || 0) < 60) return +match[1] + +(match[2] || 0) / 60
  }
  return fallback
}
function wallTime(dateParts, hour, timeZone) {
  const wholeHours = Math.floor(hour)
  const minutes = Math.round((hour - wholeHours) * 60)
  return localDateTimeToUtc({ ...dateParts, hour: wholeHours, minute: minutes, second: 0 }, timeZone)
}
function addWorkingHours(start, hours, settings) {
  let cursor = new Date(start)
  let remaining = hours * 60 * 60 * 1000
  const { timeZone, workingDays, openHour, closeHour } = settings
  for (let guard = 0; guard < 3660 && remaining > 0; guard++) {
    const parts = localParts(cursor, timeZone)
    if (!isWorkingDay(parts, workingDays, timeZone)) {
      cursor = wallTime(shiftLocalDate(parts, 1), openHour, timeZone)
      continue
    }
    const opening = wallTime(parts, openHour, timeZone)
    const closing = wallTime(parts, closeHour, timeZone)
    if (cursor < opening) cursor = opening
    if (cursor >= closing) {
      cursor = wallTime(shiftLocalDate(parts, 1), openHour, timeZone)
      continue
    }
    const available = closing.getTime() - cursor.getTime()
    if (remaining <= available) return new Date(cursor.getTime() + remaining)
    remaining -= available
    cursor = wallTime(shiftLocalDate(parts, 1), openHour, timeZone)
  }
  return remaining <= 0 ? cursor : null
}
function addWorkingDays(start, days, settings) {
  const { timeZone, workingDays } = settings
  const local = localParts(start, timeZone)
  let date = { year: local.year, month: local.month, day: local.day }
  let cursor = new Date(start)
  let remaining = days
  // Fractional working days are represented as a fraction of a 24-hour workday.
  const whole = Math.floor(remaining)
  const fraction = remaining - whole
  for (let count = 0, guard = 0; count < whole && guard < 3660; guard++) {
    date = shiftLocalDate(date, 1)
    const check = localParts(wallTime(date, local.hour + local.minute / 60, timeZone), timeZone)
    if (workingDays.has(new Date(Date.UTC(check.year, check.month - 1, check.day)).getUTCDay())) {
      cursor = wallTime(date, local.hour + local.minute / 60, timeZone)
      count++
    }
  }
  if (whole > 0 && cursor.getTime() === start.getTime()) return null
  if (fraction) {
    const fractional = addWorkingHours(cursor, fraction * 24, settings)
    if (!fractional) return null
    cursor = fractional
  }
  return cursor
}
function dueDate(start, amount, unit, config) {
  const regional = config?.regional || {}
  const timezone = regional.timeZone || regional.timezone || config?.company?.timezone || 'UTC'
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { return null }
  const sla = config?.sla || {}
  const workingDays = normalizeWorkingDays(sla.workingDays || regional.workingDays)
  const hours = sla.workingHours || regional.workingHours || {}
  const openHour = clockHour(hours.start ?? hours.open, 9)
  const closeHour = clockHour(hours.end ?? hours.close, 17)
  if (closeHour <= openHour) return null
  const settings = { timeZone: timezone, workingDays, openHour, closeHour }
  const numeric = Number(amount)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  if (unit.startsWith('day')) {
    if (sla.calendarDays === true) return new Date(start.getTime() + numeric * DAY_MS)
    return addWorkingDays(start, numeric, settings)
  }
  if (unit.startsWith('hour') && (sla.workingHours || regional.workingHours)) return addWorkingHours(start, numeric, settings)
  return new Date(start.getTime() + numeric * 60 * 60 * 1000)
}
function thresholdFor(rule) {
  if (typeof rule === 'number') return { amount: rule, unit: 'days' }
  if (typeof rule === 'string' && /^\s*\d+(?:\.\d+)?\s*(h|hours?|d|days?)?\s*$/i.test(rule)) {
    const match = rule.trim().match(/^(\d+(?:\.\d+)?)\s*(h|hours?|d|days?)?$/i)
    return { amount: Number(match[1]), unit: /^h/i.test(match[2] || '') ? 'hours' : 'days' }
  }
  if (!rule || typeof rule !== 'object') return null
  if (rule.enabled === false) return { disabled: true }
  const amount = rule.hours ?? rule.days ?? rule.value ?? rule.duration
  const unit = rule.hours != null || /^h/i.test(String(rule.unit || '')) ? 'hours' : 'days'
  return Number.isFinite(Number(amount)) && Number(amount) >= 0 ? { amount: Number(amount), unit } : null
}
function selectRule(sla, type, stage) {
  const aliases = {
    application_review: ['applicationReview', 'application_review', 'review'],
    pipeline_stage: ['pipelineStage', 'pipeline_stage', 'stageDuration'],
    interview_feedback: ['interviewFeedback', 'interview_feedback', 'feedback'],
    offer_approval: ['offerApproval', 'offer_approval', 'approval'],
  }
  const configuredRule = aliases[type].map(key => sla?.[key]).find(value => value != null)
  // The older ATS configuration stores thresholds as flat hour/day fields.
  // Structured rules above always win, including an explicit disabled rule.
  const legacyRule = {
    application_review: sla?.applicationReviewHours == null ? null : { hours: sla.applicationReviewHours },
    pipeline_stage: sla?.defaultStageDays == null ? null : { default: { days: sla.defaultStageDays } },
    interview_feedback: sla?.interviewFeedbackHours == null ? null : { hours: sla.interviewFeedbackHours },
    offer_approval: sla?.offerApprovalHours == null ? null : { hours: sla.offerApprovalHours },
  }[type]
  const rule = configuredRule ?? legacyRule
  if (type !== 'pipeline_stage' || !rule || typeof rule !== 'object') return thresholdFor(rule)
  const stageRules = rule.stages || rule.byStage || rule.stageThresholds || {}
  const stageRule = stageRules[stage] ?? stageRules[keyValue(stage)]
  return thresholdFor(stageRule ?? rule.default ?? rule)
}
function hasStatus(record, defaults, configured) {
  if (Array.isArray(configured)) return configured.map(keyValue).includes(keyValue(record.status))
  return defaults.has(keyValue(record.status))
}
function activeApplication(record) { return !TERMINAL_APPLICATION.has(keyValue(record.status)) }
function itemFor(type, record, startedAt, rule, config, now, stage = null) {
  if (!rule || rule.disabled || !startedAt) return null
  const dueAt = dueDate(startedAt, rule.amount, rule.unit, config)
  if (!dueAt) return null
  const overdue = now.getTime() >= dueAt.getTime()
  return {
    type, recordId: record.id || null, applicationId: record.applicationId || (type === 'application_review' || type === 'pipeline_stage' ? record.id || null : null),
    ...(stage ? { stage } : {}), startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString(),
    threshold: { amount: rule.amount, unit: rule.unit }, status: overdue ? 'overdue' : 'on_track',
    overdue, overdueReason: overdue ? `${type}_sla_exceeded` : null,
  }
}
function completedFeedback(interview, feedbackRows) {
  return feedbackRows.some(feedback => (feedback.interviewId === interview.id || feedback.interviewId == null && feedback.applicationId === interview.applicationId) &&
    (feedback.submittedAt || ['submitted', 'complete', 'completed'].includes(keyValue(feedback.status))))
}
function buildSlaItems(recordsByKind, config, now) {
  const sla = config?.sla || {}
  const items = []
  const applications = rows(recordsByKind, 'applications')
  for (const record of applications) {
    if (!activeApplication(record)) continue
    const reviewRule = selectRule(sla, 'application_review')
    const configuredReviewStatuses = sla.applicationReview?.statuses || sla.application_review?.statuses || sla.review?.statuses
    if (hasStatus(record, REVIEW_STATUSES, configuredReviewStatuses) ||
      (record.stage && hasStatus({ status: record.stage }, REVIEW_STATUSES, configuredReviewStatuses))) {
      const started = firstDate(record, ['appliedAt', 'submittedAt', 'createdAt'])
      const item = itemFor('application_review', record, started, reviewRule, config, now)
      if (item) items.push(item)
    }
    const stageRule = selectRule(sla, 'pipeline_stage', record.stage)
    if (stageRule) {
      const started = firstDate(record, ['stageChangedAt', 'stageEnteredAt']) || (() => {
        const history = Array.isArray(record.stageHistory) ? record.stageHistory : Array.isArray(record.stageChanges) ? record.stageChanges : []
        const current = [...history].reverse().find(entry => (entry?.stageId || entry?.stage || entry?.to || entry) === record.stage)
        return firstDate(current, ['enteredAt', 'at'])
      })()
      const item = itemFor('pipeline_stage', record, started, stageRule, config, now, record.stage || null)
      if (item) items.push(item)
    }
  }
  const feedbackRows = rows(recordsByKind, 'feedback')
  const feedbackRule = selectRule(sla, 'interview_feedback')
  for (const interview of rows(recordsByKind, 'interviews')) {
    const status = keyValue(interview.status)
    if (!(status === 'completed' || interview.completedAt || interview.endedAt) || completedFeedback(interview, feedbackRows)) continue
    const started = firstDate(interview, ['completedAt', 'endedAt', 'scheduledAt'])
    const item = itemFor('interview_feedback', interview, started, feedbackRule, config, now)
    if (item) items.push(item)
  }
  const approvalRule = selectRule(sla, 'offer_approval')
  for (const offer of rows(recordsByKind, 'offers')) {
    if (['approved', 'accepted', 'rejected', 'declined', 'withdrawn', 'cancelled'].includes(keyValue(offer.status))) continue
    const approvalStatus = offer.approvalStatus || offer.approval?.status
    if (approvalStatus && !APPROVAL_STATUSES.has(keyValue(approvalStatus))) continue
    if (!approvalStatus && !APPROVAL_STATUSES.has(keyValue(offer.status))) continue
    const started = firstDate(offer, ['approvalRequestedAt', 'submittedAt', 'createdAt'])
    const item = itemFor('offer_approval', offer, started, approvalRule, config, now)
    if (item) items.push(item)
  }
  return items
}

/** Pure SLA snapshot. Records/config are read-only; `now` may be a Date or timestamp. */
function evaluateSla({ recordsByKind = {}, config = {}, now = new Date() } = {}) {
  const asOf = validDate(now)
  if (!asOf) throw new TypeError('now must be a valid date or timestamp')
  if (config?.sla?.enabled === false) return { asOf: asOf.toISOString(), items: [], summary: { total: 0, overdue: 0, onTrack: 0, byType: {} } }
  const items = buildSlaItems(recordsByKind, config, asOf)
  const counts = items.reduce((result, item) => {
    result[item.type] = result[item.type] || { total: 0, overdue: 0, onTrack: 0 }
    result[item.type].total++
    if (item.overdue) result[item.type].overdue++
    else result[item.type].onTrack++
    return result
  }, {})
  return { asOf: asOf.toISOString(), items, summary: { total: items.length, overdue: items.filter(item => item.overdue).length, onTrack: items.filter(item => !item.overdue).length, byType: counts } }
}

module.exports = { evaluateSla, dueDate }
