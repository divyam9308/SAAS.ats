'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceOptions, normalizeSource, configuredSource } = require('./source-options')

test('enabled configured sources expose their current labels and accept id or label', () => {
  const config = { sources: [{ id: 'career', name: 'Our jobs page', enabled: true }, { id: 'legacy', name: 'Old', enabled: false }] }
  assert.deepEqual(sourceOptions(config), [{ id: 'career', label: 'Our jobs page' }])
  assert.deepEqual(normalizeSource('career', config), { valid: true, value: 'Our jobs page', id: 'career' })
  assert.deepEqual(normalizeSource('Our jobs page', config), { valid: true, value: 'Our jobs page', id: 'career' })
  assert.equal(normalizeSource('Old', config).valid, false)
  assert.equal(configuredSource(config, 'career').label, 'Our jobs page')
})

test('missing source configuration preserves legacy free-form writes', () => {
  assert.equal(sourceOptions({}), null)
  assert.deepEqual(normalizeSource('Imported source', {}), { valid: true, value: 'Imported source' })
})
