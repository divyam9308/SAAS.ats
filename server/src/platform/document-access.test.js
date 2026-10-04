'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { canViewDocument } = require('./document-access')

const viewer = { id: 'viewer' }
const administer = (_actor, permission) => permission === 'documents:administer'

test('public and team documents can be viewed after parent scope has passed', () => {
  for (const visibility of ['public', 'team']) {
    assert.equal(canViewDocument({ visibility, ownerId: 'other' }, viewer), true)
  }
})

test('private and restricted documents require ownership or document administration', () => {
  for (const visibility of ['private', 'restricted']) {
    assert.equal(canViewDocument({ visibility, ownerId: 'other' }, viewer), false)
    assert.equal(canViewDocument({ visibility, ownerId: viewer.id }, viewer), true)
    assert.equal(canViewDocument({ visibility, ownerId: 'other' }, viewer, administer), true)
  }
})

test('missing documents and actors are denied', () => {
  assert.equal(canViewDocument(null, viewer), false)
  assert.equal(canViewDocument({ visibility: 'team' }, null), false)
})
