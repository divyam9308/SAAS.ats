'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateLinkedNote, createLinkedNote, updateLinkedNote, canReadLinkedNote, scopeLinkedNotes, projectTimeline } = require('./linked-notes')

test('linked note validation requires a supported parent, bounded body, visibility, and server author', () => {
  const input = { relatedKind: 'candidates', relatedId: 'c-1', body: '  Useful context  ', visibility: 'private', authorId: 'spoofed' }
  const result = validateLinkedNote(input, { authorId: 'user-1', id: 'n-1', at: '2026-01-01T00:00:00Z' })
  assert.equal(result.valid, true)
  assert.deepEqual(result.value, { id: 'n-1', relatedKind: 'candidates', relatedId: 'c-1', body: 'Useful context', visibility: 'private', authorId: 'user-1', createdAt: '2026-01-01T00:00:00Z' })
  assert.equal(validateLinkedNote(input, {}).valid, false)
  assert.equal(validateLinkedNote({ ...input, relatedKind: 'users' }, { authorId: 'u' }).valid, false)
  assert.equal(validateLinkedNote({ ...input, visibility: 'public' }, { authorId: 'u' }).valid, false)
  assert.equal(validateLinkedNote({ ...input, body: '   ' }, { authorId: 'u' }).valid, false)
})

test('note relation and author stay immutable when updating body or visibility', () => {
  const note = createLinkedNote({ relatedKind: 'jobs', relatedId: 'j-1', body: 'Initial', visibility: 'team' }, { authorId: 'u-1', id: 'n-1', at: '2026-01-01T00:00:00Z' })
  assert.equal(updateLinkedNote(note, { body: ' Revised ', visibility: 'private' }).body, 'Revised')
  assert.throws(() => updateLinkedNote(note, { relatedId: 'j-2' }), /relatedId is immutable/)
  assert.throws(() => updateLinkedNote(note, { relatedKind: 'clients' }), /relatedKind is immutable/)
  assert.throws(() => updateLinkedNote(note, { authorId: 'u-2' }), /authorId is immutable/)
})

test('private note visibility and related record access both constrain reads', () => {
  const notes = [
    { id: 'team', relatedKind: 'jobs', relatedId: 'j-1', visibility: 'team', authorId: 'u-1' },
    { id: 'mine', relatedKind: 'jobs', relatedId: 'j-1', visibility: 'private', authorId: 'u-1' },
    { id: 'theirs', relatedKind: 'jobs', relatedId: 'j-1', visibility: 'private', authorId: 'u-2' },
    { id: 'out-of-scope', relatedKind: 'jobs', relatedId: 'j-2', visibility: 'team', authorId: 'u-1' }
  ]
  const viewer = { id: 'u-1' }
  const options = { canAccessRelated: (kind, id) => kind === 'jobs' && id === 'j-1' }
  assert.deepEqual(scopeLinkedNotes(notes, viewer, options).map(note => note.id), ['team', 'mine'])
  assert.equal(canReadLinkedNote(notes[2], viewer, { ...options, isAdmin: true }), true)
  assert.equal(canReadLinkedNote(notes[0], null, options), false)
})

test('timeline is newest first and allowlists fields to prevent sensitive data bleed', () => {
  const feed = projectTimeline({
    audit: [{ id: 'a', action: 'offer.updated', at: '2026-02-01T00:00:00Z', actorId: 'u', details: { salary: 250000, token: 'secret' } }],
    notes: [
      { id: 'n1', relatedKind: 'jobs', relatedId: 'j', body: 'Visible note', visibility: 'team', authorId: 'u', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'n2', relatedKind: 'jobs', relatedId: 'j', body: 'Private text', visibility: 'private', authorId: 'other', createdAt: '2026-01-03T00:00:00Z' }
    ],
    tasks: [{ id: 't', title: 'Call candidate', status: 'open', dueAt: '2026-01-04T00:00:00Z', privateNotes: 'do not expose' }],
    interviews: [{ id: 'i', status: 'scheduled', scheduledAt: '2026-01-05T00:00:00Z', feedback: 'secret feedback' }],
    offers: [{ id: 'o', status: 'sent', sentAt: '2026-01-06T00:00:00Z', salary: 200000, compensation: { base: 200000 } }],
    applications: [{ id: 'app', stage: 'screen', updatedAt: '2026-01-02T00:00:00Z', candidateEmail: 'private@example.test' }]
  }, { viewer: { id: 'u' }, canReadNote: () => true })
  assert.deepEqual(feed.map(row => row.type), ['audit', 'offer', 'interview', 'task', 'note', 'application', 'note'])
  assert.equal(feed.find(row => row.id === 'o').salary, undefined)
  assert.equal(feed.find(row => row.id === 'i').feedback, undefined)
  assert.equal(feed.find(row => row.id === 'a').details, undefined)
  assert.equal(feed.find(row => row.id === 't').privateNotes, undefined)
  assert.equal(feed.find(row => row.id === 'n2').body, undefined)
  assert.equal(feed.find(row => row.id === 'n1').body, 'Visible note')
})
