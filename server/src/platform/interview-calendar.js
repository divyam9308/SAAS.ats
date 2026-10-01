'use strict'

class InterviewCalendarError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'InterviewCalendarError'
    this.status = status
  }
}

function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true } catch { return false }
}

function parseOffsetTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  const datePart = value.slice(0, 10)
  const [year, month, day] = datePart.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return time
}

function validateInterviewSchedule(payload = {}, config = {}) {
  const start = parseOffsetTimestamp(payload.startAt || payload.startsAt || payload.scheduledAt)
  if (start == null) throw new InterviewCalendarError('Interview start must be a valid ISO timestamp with an explicit timezone offset.')
  const duration = Number(payload.durationMinutes ?? payload.duration)
  if (!Number.isFinite(duration) || duration <= 0) throw new InterviewCalendarError('Interview duration must be a positive number of minutes.')
  const interviewTypes = Array.isArray(config.interviewTypes) ? config.interviewTypes : []
  const type = payload.type || payload.interviewType
  if (interviewTypes.length && !interviewTypes.some(item => (typeof item === 'string' ? item : item?.id || item?.key || item?.name) === type)) {
    throw new InterviewCalendarError('Select a configured interview type.')
  }
  const timeZone = payload.timeZone || payload.timezone || config.regional?.timezone || config.timezone
  if (!validTimeZone(timeZone)) throw new InterviewCalendarError('Interview workspace timezone must be a valid IANA timezone.')
  return { startAt: new Date(start).toISOString(), endAt: new Date(start + duration * 60000).toISOString(), durationMinutes: duration, type: type || null, timeZone }
}

function participantIds(interview) {
  const values = [...(Array.isArray(interview.interviewerIds) ? interview.interviewerIds : []), interview.interviewerId, interview.panelId]
  return new Set(values.filter(Boolean).map(String))
}

function findInterviewConflict(interviews = [], candidate = {}, excludeId = null) {
  const start = parseOffsetTimestamp(candidate.startAt || candidate.startsAt || candidate.scheduledAt)
  const duration = Number(candidate.durationMinutes ?? candidate.duration)
  if (start == null || !Number.isFinite(duration) || duration <= 0) throw new InterviewCalendarError('A valid start time and positive duration are required to check conflicts.')
  const end = start + duration * 60000
  const people = participantIds(candidate)
  return (Array.isArray(interviews) ? interviews : []).find(item => {
    if (!item || item.id === excludeId || ['cancelled', 'canceled'].includes(String(item.status || '').toLowerCase())) return false
    const otherStart = parseOffsetTimestamp(item.startAt || item.startsAt || item.scheduledAt)
    const otherDuration = Number(item.durationMinutes ?? item.duration)
    if (otherStart == null || !Number.isFinite(otherDuration) || otherDuration <= 0 || start >= otherStart + otherDuration * 60000 || otherStart >= end) return false
    const sharedPerson = [...people].some(id => participantIds(item).has(id))
    const sharedRoom = candidate.roomId && item.roomId && String(candidate.roomId) === String(item.roomId)
    return Boolean(sharedPerson || sharedRoom)
  }) || null
}

function createMockCalendarEvent(interview, { workspaceId = 'workspace', now = new Date().toISOString() } = {}) {
  const id = String(interview.id || 'interview')
  return {
    id: `mock-cal-${id}`,
    provider: 'local-mock',
    externalId: `mock-cal-${id}`,
    workspaceId: String(workspaceId),
    interviewId: id,
    status: 'scheduled',
    startAt: interview.startAt || interview.startsAt || interview.scheduledAt,
    durationMinutes: Number(interview.durationMinutes ?? interview.duration),
    createdAt: now,
    updatedAt: now
  }
}

function transitionMockCalendarEvent(event, action, interview, { now = new Date().toISOString() } = {}) {
  if (!event || event.provider !== 'local-mock') throw new InterviewCalendarError('A local mock calendar event is required.')
  if (!['cancel', 'reschedule'].includes(action)) throw new InterviewCalendarError('Calendar event action must be cancel or reschedule.')
  if (action === 'cancel') return { ...event, status: 'cancelled', cancelledAt: now, updatedAt: now }
  const startAt = interview?.startAt || interview?.startsAt || interview?.scheduledAt
  const durationMinutes = Number(interview?.durationMinutes ?? interview?.duration)
  if (parseOffsetTimestamp(startAt) == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new InterviewCalendarError('A valid start time and positive duration are required to reschedule.')
  return { ...event, status: 'scheduled', startAt, durationMinutes, rescheduledAt: now, updatedAt: now }
}

module.exports = { InterviewCalendarError, validTimeZone, parseOffsetTimestamp, validateInterviewSchedule, findInterviewConflict, createMockCalendarEvent, transitionMockCalendarEvent }
