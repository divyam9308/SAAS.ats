import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromInterviewISO, toInterviewISO } from './interview-datetime.js'

test('converts datetime-local wall time through configured IANA timezone', () => {
  assert.equal(toInterviewISO('2026-01-02T22:35', 'Asia/Kolkata'), '2026-01-02T17:05:00.000Z')
  assert.equal(fromInterviewISO('2026-01-02T17:05:00Z', 'Asia/Kolkata'), '2026-01-02T22:35')
})

test('rejects impossible dates, invalid zones, DST gaps, and ambiguous fall-back times', () => {
  assert.throws(() => toInterviewISO('2026-02-30T10:00', 'UTC'), /real local date/)
  assert.throws(() => toInterviewISO('2026-01-02T10:00', 'Bad/Zone'), /IANA/)
  assert.throws(() => toInterviewISO('2026-03-08T02:30', 'America/New_York'), /does not exist/)
  assert.throws(() => toInterviewISO('2026-11-01T01:30', 'America/New_York'), /ambiguous/)
})

test('round trips normal daylight and standard local times', () => {
  for (const local of ['2026-07-01T09:45', '2026-12-01T09:45']) {
    const iso = toInterviewISO(local, 'America/New_York')
    assert.equal(fromInterviewISO(iso, 'America/New_York'), local)
  }
})
