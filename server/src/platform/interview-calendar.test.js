'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMockCalendarEvent, findInterviewConflict, parseOffsetTimestamp, transitionMockCalendarEvent, validateInterviewSchedule } = require('./interview-calendar')

test('requires strict ISO timestamps with an explicit offset and validates schedule configuration', () => {
  assert.equal(parseOffsetTimestamp('2026-05-02T09:30'), null)
  assert.equal(parseOffsetTimestamp('2026-02-30T09:30Z'), null)
  assert.equal(parseOffsetTimestamp('2026-05-02T09:30+05:30'), Date.parse('2026-05-02T09:30+05:30'))
  const config = { interviewTypes: ['technical', 'culture'], regional: { timezone: 'Asia/Kolkata' } }
  assert.deepEqual(validateInterviewSchedule({ startAt: '2026-05-02T09:30+05:30', durationMinutes: 45, type: 'technical' }, config), {
    startAt: '2026-05-02T04:00:00.000Z', endAt: '2026-05-02T04:45:00.000Z', durationMinutes: 45, type: 'technical', timeZone: 'Asia/Kolkata'
  })
  assert.throws(() => validateInterviewSchedule({ startAt: '2026-05-02T09:30Z', durationMinutes: 0, type: 'technical' }, config), /positive/)
  assert.throws(() => validateInterviewSchedule({ startAt: '2026-05-02T09:30Z', durationMinutes: 30, type: 'unknown' }, config), /configured interview type/)
  assert.throws(() => validateInterviewSchedule({ startAt: '2026-05-02T09:30Z', durationMinutes: 30, type: 'technical', timeZone: 'Mars/Olympus' }, config), /IANA/)
})

test('detects overlapping active panel/interviewer and room conflicts, ignoring cancelled and unrelated events', () => {
  const rows = [
    { id: 'cancelled', status: 'cancelled', startAt: '2026-05-02T09:00Z', durationMinutes: 90, interviewerIds: ['u1'] },
    { id: 'other', startAt: '2026-05-02T09:00Z', durationMinutes: 90, interviewerIds: ['u9'] },
    { id: 'match', startAt: '2026-05-02T09:00Z', durationMinutes: 90, interviewerIds: ['u1'] }
  ]
  const candidate = { startAt: '2026-05-02T09:30Z', durationMinutes: 30, interviewerIds: ['u1'] }
  assert.equal(findInterviewConflict(rows, candidate)?.id, 'match')
  assert.equal(findInterviewConflict(rows, { ...candidate, interviewerIds: ['u5'] }), null)
  assert.equal(findInterviewConflict([{ id: 'r', startAt: '2026-05-02T09:00Z', durationMinutes: 90, roomId: 'room-a' }], { ...candidate, interviewerIds: [], roomId: 'room-a' })?.id, 'r')
  assert.equal(findInterviewConflict(rows, candidate, 'match'), null)
})

test('mock event metadata is deterministic and transitions without external calendar calls', () => {
  const event = createMockCalendarEvent({ id: 'iv-1', startAt: '2026-05-02T09:00Z', durationMinutes: 30 }, { workspaceId: 'ws-2', now: '2026-01-01T00:00:00Z' })
  assert.equal(event.id, 'mock-cal-iv-1')
  assert.equal(event.provider, 'local-mock')
  const moved = transitionMockCalendarEvent(event, 'reschedule', { startAt: '2026-05-03T10:00Z', durationMinutes: 60 }, { now: '2026-01-02T00:00:00Z' })
  assert.equal(moved.startAt, '2026-05-03T10:00Z')
  assert.equal(moved.status, 'scheduled')
  const cancelled = transitionMockCalendarEvent(moved, 'cancel', null, { now: '2026-01-03T00:00:00Z' })
  assert.equal(cancelled.status, 'cancelled')
  assert.throws(() => transitionMockCalendarEvent({}, 'cancel'), /local mock/)
})
