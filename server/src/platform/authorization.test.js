'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { canAccessRecord, maskRecord, moduleEnabled, linkedRecords } = require('./authorization')

function setup({ scope = 'owned', sensitive = [], permissions = {}, modules = {} } = {}) {
  const user = { id: 'u1', roleId: 'recruiter', departmentId: 'eng', locationId: 'london' }
  const config = { modules, roles: [{ id: 'recruiter', scope, sensitive, permissions }] }
  const records = new Map()
  const put = (kind, row) => records.set(`${kind}:${row.id}`, { ...row, __kind: kind })
  return { user, config, put, context: { get: (kind, id) => records.get(`${kind}:${id}`) || null } }
}

test('per-kind scope overrides the role default and missing permissions never grant access', () => {
  const { user, put, context } = setup({
    scope: 'all', permissions: { jobs: ['view'], clients: ['view'] }
  })
  const job = { id: 'j1', recruiterId: 'u2', __kind: 'jobs' }
  assert.equal(canAccessRecord(user, job, { roles: [{ id: 'recruiter', scope: { jobs: 'owned' }, permissions: { jobs: ['view'] } }] }), false)
  assert.equal(canAccessRecord(user, { id: 'client', __kind: 'clients' }, { roles: [{ id: 'recruiter', permissions: {} }] }), false)
  put('jobs', { id: 'j1', recruiterId: 'u2' })
  assert.equal(canAccessRecord(user, { id: 'j1', recruiterId: 'u2', __kind: 'jobs' }, { roles: [{ id: 'recruiter', scope: 'all', permissions: { jobs: ['view'] } }] }, context), true)
})

test('owned scope denies linked docs, notes, tasks and submissions when neither record nor parent is owned', () => {
  const { user, config, put, context } = setup({ permissions: { documents: ['view'], notes: ['view'], tasks: ['view'], submissions: ['view'], jobs: ['view'], candidates: ['view'], clients: ['view'] } })
  put('jobs', { id: 'job-1', recruiterId: 'u2' })
  put('candidates', { id: 'cand-1', ownerId: 'u2' })
  put('clients', { id: 'client-1', ownerId: 'u2' })
  const examples = [
    { __kind: 'documents', id: 'doc', relatedKind: 'jobs', relatedId: 'job-1' },
    { __kind: 'notes', id: 'note', candidateId: 'cand-1' },
    { __kind: 'tasks', id: 'task', relatedKind: 'clients', relatedId: 'client-1' },
    { __kind: 'submissions', id: 'sub', clientId: 'client-1', candidateId: 'cand-1', jobId: 'job-1' }
  ]
  for (const row of examples) assert.equal(canAccessRecord(user, row, config, context), false, row.__kind)
})

test('owned scope permits linked work only when its related record is owned', () => {
  const { user, config, put, context } = setup({ permissions: { documents: ['view'], notes: ['view'], tasks: ['view'], submissions: ['view'], jobs: ['view'], candidates: ['view'], clients: ['view'] } })
  put('jobs', { id: 'job-1', recruiterId: user.id })
  put('candidates', { id: 'cand-1', ownerId: user.id })
  put('clients', { id: 'client-1', ownerId: user.id })
  assert.equal(canAccessRecord(user, { __kind: 'documents', id: 'doc', visibility: 'team', relatedKind: 'jobs', relatedId: 'job-1' }, config, context), true)
  assert.equal(canAccessRecord(user, { __kind: 'notes', id: 'note', candidateId: 'cand-1' }, config, context), true)
  assert.equal(canAccessRecord(user, { __kind: 'tasks', id: 'task', relatedKind: 'clients', relatedId: 'client-1' }, config, context), true)
  assert.equal(canAccessRecord(user, { __kind: 'submissions', id: 'sub', clientId: 'client-1', candidateId: 'cand-1', jobId: 'job-1' }, config, context), true)
  put('clients', { id: 'foreign-client', ownerId: 'u2' })
  assert.equal(canAccessRecord(user, { __kind: 'submissions', id: 'foreign-sub', clientId: 'foreign-client', candidateId: 'cand-1', jobId: 'job-1' }, config, context), false)
  assert.equal(linkedRecords({ __kind: 'submissions', clientId: 'client-1' }, context)[0].__kind, 'clients')
})

test('placement and invoice access follows their submission and client ownership', () => {
  const { user, config, put, context } = setup({ permissions: { placements: ['view'], invoices: ['view'], submissions: ['view'], clients: ['view'] } })
  put('clients', { id: 'client-1', ownerId: user.id })
  put('submissions', { id: 'submission-1', ownerId: user.id, clientId: 'client-1' })
  put('placements', { id: 'placement-1', ownerId: user.id, submissionId: 'submission-1', clientId: 'client-1' })
  put('invoices', { id: 'invoice-1', placementId: 'placement-1', clientId: 'client-1' })
  assert.equal(canAccessRecord(user, { __kind: 'placements', id: 'placement-1', submissionId: 'submission-1', clientId: 'client-1' }, config, context), true)
  assert.equal(canAccessRecord(user, { __kind: 'invoices', id: 'invoice-1', placementId: 'placement-1', clientId: 'client-1' }, config, context), true)
  put('clients', { id: 'client-2', ownerId: 'u2' })
  put('placements', { id: 'placement-2', submissionId: 'submission-1', clientId: 'client-2' })
  assert.equal(canAccessRecord(user, { __kind: 'placements', id: 'placement-2', submissionId: 'submission-1', clientId: 'client-2' }, config, context), false)
})

test('notifications are user-specific unless the actor can administer notifications', () => {
  const { user, config } = setup({ permissions: { notifications: ['view'] } })
  assert.equal(canAccessRecord(user, { __kind: 'notifications', id: 'n', userId: 'u2' }, config), false)
  assert.equal(canAccessRecord(user, { __kind: 'notifications', id: 'n', userId: 'u1' }, config), true)
  const adminConfig = { roles: [{ id: user.roleId, scope: 'all', permissions: { notifications: ['view', 'administer'] } }] }
  assert.equal(canAccessRecord(user, { __kind: 'notifications', id: 'n', userId: 'u2' }, adminConfig), true)
})

test('private notes and restricted documents are denied at record access, not only masked in the UI', () => {
  const { user, config } = setup({ permissions: { notes: ['view'], documents: ['view'] } })
  assert.equal(canAccessRecord(user, { __kind: 'notes', id: 'n', visibility: 'private', authorId: 'u2' }, config), false)
  assert.equal(canAccessRecord(user, { __kind: 'documents', id: 'd', visibility: 'restricted', ownerId: 'u2' }, config), false)
  const teamConfig = { roles: [{ id: user.roleId, scope: 'all', permissions: { documents: ['view'] } }] }
  assert.equal(canAccessRecord(user, { __kind: 'documents', id: 'team-doc', visibility: 'team', ownerId: 'u2' }, teamConfig), true)
})

test('department and location scopes reject missing and mismatched classification', () => {
  const { user } = setup({ scope: 'department', permissions: { jobs: ['view'] } })
  const role = [{ id: user.roleId, scope: 'department', permissions: { jobs: ['view'] } }]
  assert.equal(canAccessRecord(user, { __kind: 'jobs', id: 'j', departmentId: 'sales' }, { roles: role }), false)
  assert.equal(canAccessRecord(user, { __kind: 'jobs', id: 'j' }, { roles: role }), false)
  const locationRole = [{ id: user.roleId, scope: { jobs: 'location' }, permissions: { jobs: ['view'] } }]
  assert.equal(canAccessRecord(user, { __kind: 'jobs', id: 'j', locationId: 'nyc' }, { roles: locationRole }), false)
})

test('masking applies salary, fee, offer, contact, feedback and private-note categories recursively', () => {
  const { user, config } = setup({ sensitive: [] })
  const input = {
    __kind: 'placements', salary: 100, fee: 200, amount: 300,
    candidate: { email: 'private@example.test', phone: '555-0100', name: 'Visible' },
    offerDetails: { salary: 100 }, score: 4, recommendation: 'yes',
    nested: { currentSalary: 90, agencyFees: 10 }
  }
  assert.deepEqual(maskRecord(input, user, config), {
    __kind: 'placements', candidate: { name: 'Visible' }, nested: {}
  })
  const allSensitive = { ...config, roles: [{ ...config.roles[0], sensitive: ['*'] }] }
  assert.deepEqual(maskRecord(input, user, allSensitive), input)
})

test('agency fees, offer details, feedback and private notes are independently gated', () => {
  const user = { id: 'u1', roleId: 'reviewer' }
  const makeConfig = sensitive => ({ roles: [{ id: 'reviewer', permissions: {}, sensitive }] })
  const offer = { __kind: 'offers', salary: 100, amount: 200, fee: 300, feedback: 'secret', candidate: { email: 'x@y.test' } }
  const masked = maskRecord(offer, user, makeConfig(['offerDetails', 'agencyFees']))
  assert.deepEqual(masked, { __kind: 'offers', amount: 200, fee: 300, candidate: {} })
  const privateNote = { __kind: 'notes', visibility: 'private', authorId: 'u2', body: 'confidential' }
  assert.deepEqual(maskRecord(privateNote, user, makeConfig(['privateNotes'])), { __kind: 'notes', visibility: 'private', authorId: 'u2' })
  assert.equal(maskRecord({ ...privateNote, authorId: user.id }, user, makeConfig([])).body, 'confidential')
})

test('candidate-only PII is masked recursively without contact sensitivity', () => {
  const { user } = setup({ sensitive: [] });
  const input = {
    __kind: 'applications',
    fullName: 'Unrelated entity name',
    candidate: {
      fullName: 'Candidate Name', alternateEmails: ['a@example.test'], alternatePhones: ['555'],
      profileUrl: 'https://example.test/profile', linkedin: 'https://linkedin.test/in/name',
      portfolio: 'https://example.test/work', address: 'Private address',
      nested: [{ fullName: 'Nested Candidate Name', profileUrl: 'https://example.test/nested' }]
    },
    candidates: [{ fullName: 'Array Candidate', address: 'Private' }]
  };
  const masked = maskRecord(input, user, { roles: [{ id: 'recruiter', sensitive: [], permissions: {} }] });
  assert.deepEqual(masked, {
    __kind: 'applications', fullName: 'Unrelated entity name',
    candidate: { fullName: 'Candidate Name', nested: [{ fullName: 'Nested Candidate Name' }] },
    candidates: [{ fullName: 'Array Candidate' }]
  });

  const authorized = { roles: [{ id: 'recruiter', sensitive: ['contact'], permissions: {} }] };
  assert.deepEqual(maskRecord(input, user, authorized), input);
});

test('module flags deny agency records and documents can remain available independently', () => {
  const config = { modules: { agency: false, documents: false } }
  assert.equal(moduleEnabled(config, 'submissions'), false)
  assert.equal(moduleEnabled(config, 'placements'), false)
  assert.equal(moduleEnabled(config, 'invoices'), false)
  assert.equal(moduleEnabled(config, 'documents'), false)
  assert.equal(moduleEnabled({ modules: { candidates: true } }, 'documents'), true)
  assert.equal(moduleEnabled({ modules: { candidates: true } }, 'notes'), true)
  assert.equal(moduleEnabled({ modules: { interviews: true } }, 'feedback'), true)
  assert.equal(moduleEnabled({ modules: { requisitions: false, offers: false, agency: true, invoices: true } }, 'approvals'), true)
  assert.equal(moduleEnabled({ modules: { requisitions: false, offers: false, agency: false, invoices: false } }, 'approvals'), false)
})
