'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildWorkforcePlan, periodFor } = require('./workforce-plan')

test('corporate workforce plan compares hired applications with dimensional targets', () => {
  const result = buildWorkforcePlan({
    config: { mode: 'corporate', regional: { timezone: 'America/Los_Angeles' } },
    recordsByKind: {
      workforceTargets: [
        { id: 'eng', period: '2026-Q3', department: 'Engineering', location: 'Remote', role: 'Engineer', target: 2 },
        { id: 'sales', period: '2026-Q3', department: 'Sales', location: 'NYC', role: 'Account Executive', target: 1 },
      ],
      jobs: [
        { id: 'j1', department: 'Engineering', location: 'Remote', title: 'Engineer' },
        { id: 'j2', department: 'Sales', location: 'NYC', title: 'Account Executive' },
      ],
      applications: [
        { id: 'a1', jobId: 'j1', status: 'hired', hiredAt: '2026-07-01T06:30:00Z' }, // June 30 locally, Q2
        { id: 'a2', jobId: 'j1', status: 'hired', hiredAt: '2026-07-01T08:00:00Z' },
        { id: 'a3', jobId: 'j2', status: 'hired', hiredAt: '2026-08-01T12:00:00Z' },
        { id: 'a4', jobId: 'j2', status: 'active', hiredAt: '2026-08-02T12:00:00Z' },
      ],
      placements: [{ id: 'p1', placedAt: '2026-08-02T12:00:00Z' }],
    },
  })
  assert.equal(result.outcomeType, 'hires')
  assert.deepEqual(result.series.map(({ id, actualHires, variance, attainmentPercent }) => ({ id, actualHires, variance, attainmentPercent })), [
    { id: 'eng', actualHires: 1, variance: -1, attainmentPercent: 50 },
    { id: 'sales', actualHires: 1, variance: 0, attainmentPercent: 100 },
  ])
  assert.equal(result.summary.target, 3)
  assert.equal(result.summary.actualHires, 2)
})

test('agency workforce plan counts dated placements and does not count corporate application hires', () => {
  const result = buildWorkforcePlan({
    config: { mode: 'agency', regional: { timeZone: 'UTC' } },
    recordsByKind: {
      workforceTargets: [{ period: '2026-Q3', department: 'Data', location: 'London', role: 'Data Engineer', target: 2 }],
      jobs: [{ id: 'job', department: 'Data', location: 'London', title: 'Data Engineer' }],
      applications: [{ id: 'app', jobId: 'job', status: 'hired', hiredAt: '2026-08-01T00:00:00Z' }],
      placements: [
        { id: 'p1', jobId: 'job', status: 'placed', placedAt: '2026-08-01T00:00:00Z' },
        { id: 'p2', jobId: 'job', status: 'submitted', placedAt: '2026-08-02T00:00:00Z' },
        { id: 'p3', jobId: 'job', status: 'placed' },
      ],
    },
  })
  assert.equal(result.outcomeType, 'placements')
  assert.equal(result.series[0].actualHires, 1)
})

test('no targets means no fabricated target comparison, even when dated actual outcomes exist', () => {
  const result = buildWorkforcePlan({
    recordsByKind: { applications: [{ id: 'h', status: 'hired', hiredAt: '2026-08-01T00:00:00Z' }] },
  })
  assert.deepEqual(result.series, [])
  assert.equal(result.summary.hasTargets, false)
  assert.equal(result.summary.target, null)
  assert.equal(result.summary.actualHires, null)
  assert.equal(result.summary.actualAgainstTargetRows, 0)
})

test('overlapping broad and specific targets do not produce a misleading unique total', () => {
  const result = buildWorkforcePlan({
    recordsByKind: {
      workforceTargets: [
        { id: 'all', period: '2026-Q3', target: 2 },
        { id: 'eng', period: '2026-Q3', department: 'Engineering', target: 1 },
      ],
      jobs: [{ id: 'job', department: 'Engineering' }],
      applications: [{ id: 'hire', jobId: 'job', status: 'hired', hiredAt: '2026-08-01T00:00:00Z' }],
    },
  })
  assert.deepEqual(result.series.map(row => row.actualHires), [1, 1])
  assert.equal(result.periods[0].actualHires, null)
  assert.equal(result.summary.actualHires, null)
  assert.equal(result.summary.actualAgainstTargetRows, 2)
})

test('period calculation uses target granularity and regional local date', () => {
  const value = '2026-07-01T06:30:00Z'
  assert.equal(periodFor(value, '2026-Q2', 'America/Los_Angeles'), '2026-Q2')
  assert.equal(periodFor(value, '2026-06', 'America/Los_Angeles'), '2026-06')
  assert.equal(periodFor(value, '2026', 'America/Los_Angeles'), '2026')
  assert.equal(periodFor(value, 'FY26', 'UTC'), null)
})
