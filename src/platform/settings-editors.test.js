import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { choiceLabel, coerceConditionValue, createCustomQuestion, createNewApplicationForm, patchCollectionItem, removePipelineStage, reorderPipelineStages, rolesWithApprovalPermission, ROLE_SCOPES, updateChoiceList, updateCondition } from './settings-editors.js'

const require = createRequire(import.meta.url)
const { defaults, validateConfig } = require('../../shared/ats-config.cjs')

test('collection edits update the selected row field without numeric wrapper keys', () => {
  const source = [{ id: 'general', name: 'Hiring', enabled: true }, { id: 'agency', name: 'Agency' }]
  const result = patchCollectionItem(source, 0, '0.name', 'Engineering hiring')
  assert.equal(result[0].name, 'Engineering hiring')
  assert.equal(result[1].name, 'Agency')
  assert.equal(Object.hasOwn(result[0], '0'), false)
  assert.equal(source[0].name, 'Hiring')
})

test('nested collection edits update the selected child field', () => {
  const source = [{ id: 'general', stages: [{ id: 'applied', name: 'Applied' }] }]
  const result = patchCollectionItem(source[0].stages, 0, '0.name', 'Application received')
  assert.equal(result[0].name, 'Application received')
  assert.equal(Object.hasOwn(result[0], '0'), false)
})

test('pipeline reorder keeps transition references stable and removal clears only affected edges', () => {
  const pipeline = { stages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], transitions: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }
  const reordered = reorderPipelineStages(pipeline, 2, 0)
  assert.deepEqual(reordered.stages.map((stage) => stage.id), ['c', 'a', 'b'])
  assert.deepEqual(reordered.transitions, pipeline.transitions)
  const removed = removePipelineStage(reordered, 'b')
  assert.deepEqual(removed.stages.map((stage) => stage.id), ['c', 'a'])
  assert.deepEqual(removed.transitions, [])
})

test('role scope choices match the config contract and retain assigned scope', () => {
  const config = defaults('corporate')
  config.roles.find((role) => role.id === 'recruiter').scope = 'assigned'
  assert.deepEqual(validateConfig(config).errors, [])
  config.roles.find((role) => role.id === 'recruiter').scope = 'organization'
  assert.ok(validateConfig(config).errors.includes('roles[3].scope is invalid.'))
  assert.deepEqual(ROLE_SCOPES, ['all', 'owned', 'assigned', 'department', 'location'])
})

test('legacy nested conditions edit their evaluated when clause and retain typed answers', () => {
  const source = { targetField: 'workAuthorization', action: 'show', when: { field: 'sponsorship', operator: 'equals', value: 'yes' } }
  const updated = updateCondition(updateCondition(updateCondition(source, 'field', 'needsVisa'), 'operator', 'notEquals'), 'value', true)
  assert.deepEqual(updated, { ...source, when: { field: 'needsVisa', operator: 'notEquals', value: true } })
  assert.equal(coerceConditionValue('true', 'checkbox'), true)
  assert.equal(coerceConditionValue('false', 'checkbox'), false)
  assert.equal(coerceConditionValue('12.5', 'number'), 12.5)
})

test('new forms include protected API identity questions and custom questions have stable keys', () => {
  let counter = 0
  const makeId = (prefix) => `${prefix}-${++counter}`
  const form = createNewApplicationForm(makeId)
  const fields = form.sections.flatMap((section) => section.fields)
  assert.deepEqual(fields.map((field) => [field.field, field.type, field.required]), [
    ['fullName', 'shortText', true], ['email', 'email', true],
  ])
  const question = createCustomQuestion(makeId)
  assert.ok(question.key)
  assert.equal(question.field, question.key)
  assert.equal(question.id, question.key)
})

test('choice label edits preserve legacy object shapes', () => {
  const previous = [{ id: 'a', label: 'Poor', color: 'red' }, { value: 'good', title: 'Good' }]
  assert.deepEqual(previous.map(choiceLabel), ['Poor', 'good'])
  assert.deepEqual(updateChoiceList(previous, 'Needs work, Excellent'), [
    { id: 'a', label: 'Needs work', color: 'red' }, { value: 'Excellent', title: 'Good' },
  ])
})

test('approval role choices require module approval permission or global administer', () => {
  const roles = [
    { id: 'view-only', permissions: { offers: ['view'] } },
    { id: 'approver', permissions: { offers: ['approve'] } },
    { id: 'global-admin', permissions: { '*': ['administer'] } },
  ]
  assert.deepEqual(rolesWithApprovalPermission(roles, 'offers').map((role) => role.id), ['approver', 'global-admin'])
})
