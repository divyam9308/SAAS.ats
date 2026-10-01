'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateWorkforceTarget, validateWorkforceTargetEdit } = require('./workforce-target-policy')

const config = { organization: {
  units: [{ id: 'unit-eng', name: 'Engineering' }],
  locations: [{ id: 'loc-ny', name: 'New York' }],
} }

test('accepts supported periods and normalizes configured organization IDs and names', () => {
  for (const period of ['2026', '2026-02', '2026-12', '2026-Q1', '2026-Q4']) {
    assert.equal(validateWorkforceTarget({ period, target: 3, departmentId: 'unit-eng', location: 'new york' }, config).department, 'Engineering')
  }
  assert.equal(validateWorkforceTarget({ period: '2026-Q2', target: 1, department: ' Engineering ' }, config).department, 'Engineering')
})

test('rejects malformed period, non-positive/non-whole target, unknown dimensions and invalid role', () => {
  for (const input of [
    { period: '2026-13', target: 1 }, { period: 'FY26', target: 1 }, { period: '2026-Q5', target: 1 },
    { period: '2026', target: 0 }, { period: '2026', target: -1 }, { period: '2026', target: 1.5 },
    { period: '2026', target: 1, department: 'Unknown' }, { period: '2026', target: 1, locationId: 'missing' },
    { period: '2026', target: 1, role: '' }, { period: '2026', target: 1, role: 'x'.repeat(121) },
  ]) assert.throws(() => validateWorkforceTarget(input, config), { status: 422 })
})

test('edit validation checks the merged record, including fields omitted by the edit', () => {
  assert.throws(() => validateWorkforceTargetEdit({ period: '2026', target: 2 }, { period: '2026-00' }, config), { status: 422 })
  assert.equal(validateWorkforceTargetEdit({ period: '2026', target: 2 }, { target: 4 }, config).target, 4)
})

test('edit normalization returns only requested fields and maps legacy aliases', () => {
  const before = { id: 'target-1', period: '2026', target: 2, createdBy: 'admin', createdAt: '2026-01-01' }
  assert.deepEqual(validateWorkforceTargetEdit(before, { headcount: '4', departmentId: 'unit-eng' }, config), {
    target: 4,
    department: 'Engineering',
  })
})
