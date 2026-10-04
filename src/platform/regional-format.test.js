import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRegionalDate, formatRegionalDateTime, formatRegionalMoney } from './regional-format.js'

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

test('date-only values preserve their calendar day in western time zones', () => {
  assert.equal(formatRegionalDate('2026-01-02', {
    dateFormat: 'DD/MM/YYYY', timezone: 'America/Los_Angeles',
  }), '02/01/2026')
})

test('timestamp values still convert through the configured timezone', () => {
  assert.equal(formatRegionalDate('2026-01-02T01:30:00Z', {
    dateFormat: 'MM/DD/YYYY', timezone: 'America/Los_Angeles',
  }), '01/01/2026')
})

test('money uses configured locale and record currency', () => {
  assert.equal(formatRegionalMoney(1234.5, { numberLocale: 'de-DE', currency: 'USD' }), '1.234,50 $')
  assert.equal(formatRegionalMoney(1234.5, { numberLocale: 'en-US', currency: 'EUR' }), '€1,234.50')
  assert.equal(formatRegionalMoney({ amount: 1000, currency: 'GBP' }, { numberLocale: 'en-US', currency: 'USD' }), '£1,000.00')
})

test('money handles absent values and malformed legacy regional settings', () => {
  assert.equal(formatRegionalMoney(null), '')
  assert.equal(formatRegionalMoney(''), '')
  assert.equal(formatRegionalMoney(1234.5, { numberLocale: 'not_a_locale', currency: 'bad-code' }), '1,234.5')
})
