import test from 'node:test'
import assert from 'node:assert/strict'
import { isApplicationFieldVisible } from './application-conditions.mjs'

const form = {
  sections: [{ fields: [
    { field: 'hasPortfolio', type: 'checkbox' },
    { field: 'yearsExperience', type: 'number' },
    { field: 'preferredRoles', type: 'multiSelect' }
  ] }]
}

test('checkbox and numeric answers compare by their configured field types', () => {
  assert.equal(isApplicationFieldVisible({ field: 'portfolio', condition: { field: 'hasPortfolio', value: true } }, form, { hasPortfolio: 'false' }), false)
  assert.equal(isApplicationFieldVisible({ field: 'portfolio', condition: { field: 'hasPortfolio', value: false } }, form, { hasPortfolio: 'false' }), true)
  assert.equal(isApplicationFieldVisible({ field: 'minimumExperience', condition: { field: 'yearsExperience', value: 5 } }, form, { yearsExperience: '5' }), true)
})

test('field conditions honor visibility flags, show and hide rules, and operators', () => {
  const conditionalForm = {
    ...form,
    conditions: [
      { targetField: 'portfolio', when: { field: 'hasPortfolio', value: true } },
      { hideField: 'coverLetter', when: { field: 'hasPortfolio', value: true } }
    ]
  }
  assert.equal(isApplicationFieldVisible({ field: 'portfolio' }, conditionalForm, { hasPortfolio: true }), true)
  assert.equal(isApplicationFieldVisible({ field: 'portfolio' }, conditionalForm, { hasPortfolio: false }), false)
  assert.equal(isApplicationFieldVisible({ field: 'coverLetter' }, conditionalForm, { hasPortfolio: true }), false)
  assert.equal(isApplicationFieldVisible({ field: 'coverLetter' }, conditionalForm, { hasPortfolio: false }), true)
  assert.equal(isApplicationFieldVisible({ field: 'excluded', condition: { field: 'hasPortfolio', operator: 'notEquals', value: true } }, form, { hasPortfolio: false }), true)
  assert.equal(isApplicationFieldVisible({ field: 'roles', condition: { field: 'preferredRoles', operator: 'contains', value: 'engineer' } }, form, { preferredRoles: ['engineer'] }), true)
  assert.equal(isApplicationFieldVisible({ field: 'roles', condition: { field: 'preferredRoles', operator: 'in', value: ['engineer', 'designer'] } }, form, { preferredRoles: ['engineer'] }), true)
  assert.equal(isApplicationFieldVisible({ field: 'roles', condition: { field: 'preferredRoles', operator: 'not_in', value: ['designer'] } }, form, { preferredRoles: ['engineer'] }), true)
  assert.equal(isApplicationFieldVisible({ field: 'not-engineer', condition: { field: 'preferredRoles', operator: 'neq', value: 'engineer' } }, form, { preferredRoles: 'designer' }), true)
  assert.equal(isApplicationFieldVisible({ field: 'empty', condition: { field: 'missing', operator: 'isEmpty' } }, form, {}), true)
  assert.equal(isApplicationFieldVisible({ field: 'disabled', enabled: false }, form, {}), false)
  assert.equal(isApplicationFieldVisible({ field: 'hidden', visible: false }, form, {}), false)
})
