import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRegionalDate, formatRegionalDateTime } from './regional-format.js'

test('formats datetime with configured 12-hour clock and date pattern', () => {
  assert.equal(formatRegionalDateTime('2026-01-02T17:05:00Z', {
    dateFormat: 'DD/MM/YYYY', timeFormat: '12h', timezone: 'UTC',
  }), '02/01/2026 5:05 PM')
})

test('formats datetime with configured 24-hour clock and timezone', () => {
  assert.equal(formatRegionalDateTime('2026-01-02T17:05:00Z', {
    dateFormat: 'YYYY-MM-DD', timeFormat: '24h', timezone: 'Asia/Kolkata',
  }), '2026-01-02 22:35')
})

test('date-only format retains dateFormat and applies configured timezone', () => {
  assert.equal(formatRegionalDate('2026-01-02T01:30:00Z', {
    dateFormat: 'MM/DD/YYYY', timezone: 'America/Los_Angeles',
  }), '01/01/2026')
})
