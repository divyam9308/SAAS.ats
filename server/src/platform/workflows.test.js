'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { action, validateTransition, WorkflowError } = require('./workflows')

function memoryStore(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([kind, rows]) => [kind, new Map(rows.map(row => [row.id, structuredClone(row)]))]))
  let sequence = 0
  const table = kind => { if (!tables.has(kind)) tables.set(kind, new Map()); return tables.get(kind) }
  return {
    get(kind, id) { const row = table(kind).get(id); return row ? structuredClone(row) : null },
    list(kind) { return [...table(kind).values()].map(row => structuredClone(row)) },
    put(kind, row, actor) {
      const value = { ...structuredClone(row), id: row.id || `${kind}-${++sequence}`, updatedBy: actor }
      table(kind).set(value.id, value)
      return structuredClone(value)
    },
    archive(kind, id) { const row = this.get(kind, id); if (!row) return null; table(kind).delete(id); return { ...row, archived: true } }
  }
}

function context(config = {}, roleId = 'admin', id = 'u-admin', store) {
  const events = [], audits = []
  return {
    user: { id, roleId }, config, canApproveAny: false,
    audit: (...args) => audits.push(args), emit: (...args) => events.push(args),
    events, audits, store
  }
}
function rejectStatus(fn, status) {
  assert.throws(fn, error => error instanceof WorkflowError && error.status === status)
}

test('pipeline transitions enforce configured edges, stage roles, and requirements', () => {
  const store = memoryStore({ interviews: [], feedback: [] })
  const config = { pipelines: [{ id: 'p', stages: [
    { id: 'applied' }, { id: 'interview', requires: ['interview'], allowedRoles: ['recruiter'] }, { id: 'hired' }
  ], transitions: [{ from: 'applied', to: 'interview' }, { from: 'interview', to: 'hired' }] }] }
  const app = { id: 'a', jobId: 'j', pipelineId: 'p', stage: 'applied' }
  rejectStatus(() => validateTransition(config, app, 'hired', store), 409)
  rejectStatus(() => validateTransition(config, { ...app, __actorRole: 'admin' }, 'interview', store), 403)
  rejectStatus(() => validateTransition(config, { ...app, __actorRole: 'recruiter' }, 'interview', store), 409)
  store.put('interviews', { id: 'i', applicationId: 'a', status: 'completed' })
  assert.equal(validateTransition(config, { ...app, __actorRole: 'recruiter' }, 'interview', store).target.id, 'interview')
})

test('scorecard is a compatibility alias for submitted feedback requirements', () => {
  const application = { id: 'a', jobId: 'j', candidateId: 'c', pipelineId: 'p', stage: 'screening' }
  const config = { pipelines: [{ id: 'p', stages: [{ id: 'screening' }, { id: 'interview', requires: ['scorecard'] }] }] }
  assert.throws(() => validateTransition(config, application, 'interview', memoryStore({ jobs: [{ id: 'j' }] })), error => error instanceof WorkflowError && error.status === 409)
  assert.doesNotThrow(() => validateTransition(config, application, 'interview', memoryStore({
    jobs: [{ id: 'j' }], feedback: [{ id: 'f', applicationId: 'a', status: 'submitted' }]
  })))
})

test('an explicit empty transition graph denies moves while legacy missing graphs retain sequential moves', () => {
  const store = memoryStore()
  const pipeline = { id: 'p', stages: [{ id: 'applied' }, { id: 'screening' }, { id: 'hired' }], transitions: [] }
  const config = { pipelines: [pipeline] }
  const application = { id: 'a', pipelineId: 'p', stage: 'applied' }
  rejectStatus(() => validateTransition(config, application, 'screening', store), 409)
  delete pipeline.transitions
  assert.equal(validateTransition(config, application, 'screening', store).target.id, 'screening')
  rejectStatus(() => validateTransition(config, application, 'hired', store), 409)
})

test('client requirements resolve an active client through application or job', () => {
  const application = { id: 'a', jobId: 'j', candidateId: 'c', pipelineId: 'p', stage: 'screening' }
  const config = { pipelines: [{ id: 'p', stages: [{ id: 'screening' }, { id: 'submitted', requires: ['client'] }] }] }
  assert.throws(() => validateTransition(config, application, 'submitted', memoryStore({ jobs: [{ id: 'j' }] })), error => error instanceof WorkflowError && error.status === 409)
  assert.throws(() => validateTransition(config, application, 'submitted', memoryStore({
    jobs: [{ id: 'j', clientId: 'client' }], clients: [{ id: 'client', archivedAt: '2026-01-01T00:00:00.000Z' }]
  })), error => error instanceof WorkflowError && error.status === 409)
  assert.doesNotThrow(() => validateTransition(config, application, 'submitted', memoryStore({
    jobs: [{ id: 'j', clientId: 'client' }], clients: [{ id: 'client', status: 'active' }]
  })))
})

test('placement requirements match this application or its candidate and job and require an active placement', () => {
  const application = { id: 'a', jobId: 'j', candidateId: 'c', pipelineId: 'p', stage: 'interview' }
  const config = { pipelines: [{ id: 'p', stages: [{ id: 'interview' }, { id: 'placed', requires: ['placement'] }] }] }
  assert.throws(() => validateTransition(config, application, 'placed', memoryStore({ jobs: [{ id: 'j' }] })), error => error instanceof WorkflowError && error.status === 409)
  assert.throws(() => validateTransition(config, application, 'placed', memoryStore({
    jobs: [{ id: 'j' }], placements: [{ id: 'cancelled', applicationId: 'a', status: 'cancelled' }]
  })), error => error instanceof WorkflowError && error.status === 409)
  assert.throws(() => validateTransition(config, application, 'placed', memoryStore({
    jobs: [{ id: 'j' }], placements: [{ id: 'unrelated', candidateId: 'other', jobId: 'j', status: 'placed' }]
  })), error => error instanceof WorkflowError && error.status === 409)
  assert.doesNotThrow(() => validateTransition(config, application, 'placed', memoryStore({
    jobs: [{ id: 'j' }], placements: [{ id: 'same-pair', candidateId: 'c', jobId: 'j', status: 'placed' }]
  })))
  assert.doesNotThrow(() => validateTransition(config, application, 'placed', memoryStore({
    jobs: [{ id: 'j' }], placements: [{ id: 'same-app', applicationId: 'a', status: 'active' }]
  })))
})

test('unknown application stage requirements fail closed', () => {
  const application = { id: 'a', jobId: 'j', pipelineId: 'p', stage: 'screening' }
  const config = { pipelines: [{ id: 'p', stages: [{ id: 'screening' }, { id: 'next', requires: ['unsupported-policy'] }] }] }
  assert.throws(() => validateTransition(config, application, 'next', memoryStore({ jobs: [{ id: 'j' }] })), error => error instanceof WorkflowError && error.status === 422)
})

test('sequential approval checks approver role and completes only after each configured step', () => {
  const store = memoryStore()
  const config = { requisitions: { approvalWorkflowId: 'req' }, approvalWorkflows: [{ id: 'req', module: 'requisitions', sequential: true, steps: [{ roleId: 'manager' }, { roleId: 'hr' }] }], roles: [] }
  const record = { id: 'r', status: 'pending', budget: 80000 }
  rejectStatus(() => action(store, 'requisitions', record, 'approve', {}, context(config, 'hr', 'hr')), 403)
  const first = action(store, 'requisitions', record, 'approve', {}, context(config, 'manager', 'manager'))
  assert.equal(first.status, 'pending')
  const second = action(store, 'requisitions', first, 'approve', {}, context(config, 'hr', 'hr'))
  assert.equal(second.status, 'approved')
  assert.deepEqual(second.approvalsCompleted, ['manager', 'hr'])
})

test('parallel approvals require every configured step and delegation grants only its configured delegate', () => {
  const config = { approvalWorkflows: [{ id: 'req', module: 'requisitions', sequential: false, steps: [{ roleId: 'manager' }, { roleId: 'hr' }] }], requisitions: {}, roles: [] }
  const store = memoryStore()
  const record = { id: 'r', status: 'pending', approvals: ['manager', 'hr'] }
  const first = action(store, 'requisitions', record, 'approve', {}, context(config, 'manager', 'manager'))
  assert.equal(first.status, 'pending')
  rejectStatus(() => action(store, 'requisitions', first, 'approve', {}, context(config, 'manager', 'manager')), 403)
  assert.equal(action(store, 'requisitions', first, 'approve', {}, context(config, 'hr', 'hr')).status, 'approved')

  const delegatedConfig = { ...config, approvalWorkflows: [{ id: 'req', module: 'requisitions', steps: [{ roleId: 'manager' }] }], delegations: [{ roleId: 'manager', delegateRoleId: 'finance' }], users: [{ id: 'finance-user', roleId: 'finance' }] }
  const delegatedStore = memoryStore()
  const pending = { id: 'd', status: 'pending' }
  rejectStatus(() => action(delegatedStore, 'requisitions', pending, 'delegate', { userId: 'demo-hr' }, context(delegatedConfig, 'manager', 'manager')), 403)
  const delegated = action(delegatedStore, 'requisitions', pending, 'delegate', { userId: 'finance-user' }, context(delegatedConfig, 'manager', 'manager'))
  assert.equal(action(delegatedStore, 'requisitions', delegated, 'approve', {}, context(delegatedConfig, 'finance', 'finance-user')).status, 'approved')
})

test('temporary delegation only grants authority inside its inclusive date window', () => {
  const today = new Date().toISOString().slice(0, 10)
  const shiftDate = (days) => {
    const date = new Date(`${today}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }
  const baseConfig = {
    approvalWorkflows: [{ id: 'req', module: 'requisitions', steps: [{ roleId: 'manager' }] }],
    delegations: [{ roleId: 'manager', delegateRoleId: 'backup', startsOn: shiftDate(0), endsOn: shiftDate(0) }],
    users: [{ id: 'backup-user', roleId: 'backup' }], roles: []
  }
  const record = { id: 'r', status: 'pending', budget: 1000 }

  const activeStore = memoryStore()
  const delegated = action(activeStore, 'requisitions', record, 'delegate', { userId: 'backup-user' }, context(baseConfig, 'manager', 'manager'))
  assert.equal(action(activeStore, 'requisitions', delegated, 'approve', {}, context(baseConfig, 'backup', 'backup-user')).status, 'approved')

  const expiredConfig = { ...baseConfig, delegations: [{ ...baseConfig.delegations[0], endsOn: shiftDate(-1) }] }
  rejectStatus(() => action(memoryStore(), 'requisitions', record, 'delegate', { userId: 'backup-user' }, context(expiredConfig, 'manager', 'manager')), 403)
  const storedDelegation = { ...record, delegatedApprovers: { 0: 'backup-user' } }
  rejectStatus(() => action(memoryStore(), 'requisitions', storedDelegation, 'approve', {}, context(expiredConfig, 'backup', 'backup-user')), 403)

  const futureConfig = { ...baseConfig, delegations: [{ ...baseConfig.delegations[0], startsOn: shiftDate(1) }] }
  rejectStatus(() => action(memoryStore(), 'requisitions', record, 'delegate', { userId: 'backup-user' }, context(futureConfig, 'manager', 'manager')), 403)
})

test('configured approvers may reject and record the rejection reason', () => {
  const config = { approvalWorkflows: [{ id: 'offer', module: 'offers', steps: [{ roleId: 'hr' }] }], offers: {}, roles: [] }
  const rejected = action(memoryStore(), 'offers', { id: 'o', status: 'pending_approval' }, 'reject', { reason: 'Outside budget' }, context(config, 'hr', 'hr-user'))
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.rejectionReason, 'Outside budget')
})

test('an explicit empty approval workflow reference disables legacy definition fallback', () => {
  const store = memoryStore()
  const config = {
    requisitions: { approvalWorkflowId: '' },
    approvalWorkflows: [{ id: 'legacy-requisition', module: 'requisitions', steps: [{ roleId: 'manager' }] }],
    roles: [{ id: 'manager', permissions: { requisitions: ['approve'] } }]
  }
  const record = { id: 'req-disabled', status: 'pending', approvals: ['manager'] }
  rejectStatus(() => action(store, 'requisitions', record, 'approve', {}, context(config, 'manager', 'manager-user')), 409)
  assert.equal(store.get('requisitions', record.id), null)
})

test('an explicitly selected approval workflow must match the record module', () => {
  const store = memoryStore()
  const config = {
    requisitions: { approvalWorkflowId: 'offer-flow' },
    approvalWorkflows: [{ id: 'offer-flow', module: 'offers', steps: [{ roleId: 'manager' }] }],
    roles: [{ id: 'manager', permissions: { requisitions: ['approve'] } }]
  }
  const record = { id: 'req-wrong-flow', status: 'pending' }
  for (const reference of ['offer-flow', 'missing-flow']) {
    config.requisitions.approvalWorkflowId = reference
    for (const operation of ['approve', 'create-job']) rejectStatus(() => action(store, 'requisitions', record, operation, {}, context(config, 'manager', 'manager-user')), 422)
  }
  assert.equal(store.get('requisitions', record.id), null)
  assert.deepEqual(store.list('jobs'), [])
})

test('offers with approval disabled bypass a stale workflow definition', () => {
  const store = memoryStore()
  const config = {
    offers: { approvalWorkflowId: '', requireApproval: false },
    approvalWorkflows: [{ id: 'offer-flow', module: 'offers', steps: [{ roleId: 'manager' }] }],
    roles: [{ id: 'manager', permissions: { offers: ['approve'] } }]
  }
  const sent = action(store, 'offers', { id: 'offer-optional', status: 'draft' }, 'approve', {}, context(config, 'manager', 'manager-user'))
  assert.equal(sent.status, 'sent')
  assert.equal(sent.workflowBypassed, false)
})

test('legacy approval configs without an explicit reference still use the module workflow', () => {
  const store = memoryStore()
  const config = {
    approvalWorkflows: [{ id: 'legacy-offer', module: 'offers', steps: [{ roleId: 'manager' }] }],
    roles: [{ id: 'manager', permissions: { offers: ['approve'] } }]
  }
  const sent = action(store, 'offers', { id: 'legacy', status: 'pending_approval' }, 'approve', {}, context(config, 'manager', 'manager-user'))
  assert.equal(sent.status, 'sent')
  assert.deepEqual(sent.approvalsCompleted, ['manager-user'])
})

test('threshold approvals are bypassed below the configured amount', () => {
  const config = { approvalWorkflows: [{ id: 'invoice', module: 'invoices', threshold: 5000, steps: [{ roleId: 'finance' }] }], roles: [{ id: 'admin', permissions: { '*': ['*'] } }] }
  const store = memoryStore()
  const row = action(store, 'invoices', { id: 'i', status: 'draft', amount: 1000 }, 'approve', {}, context(config))
  assert.equal(row.status, 'approved')
  assert.equal(row.workflowBypassed, true)
})

test('scorecard requires configured mandatory criteria and locks submitted feedback', () => {
  const store = memoryStore({ feedback: [] })
  const config = { scorecards: [{ id: 's', mandatoryFeedback: true, ratingScale: { min: 1, max: 5 }, competencies: [{ id: 'a', name: 'A', weight: 1 }, { id: 'b', name: 'B', weight: 3 }] }] }
  const interview = { id: 'i', status: 'scheduled', applicationId: 'app', scorecardId: 's' }
  rejectStatus(() => action(store, 'interviews', interview, 'submit-feedback', { answers: { a: 4 }, comments: 'Good' }, context(config)), 422)
  rejectStatus(() => action(store, 'interviews', interview, 'submit-feedback', { answers: { a: 6, b: 4 }, comments: 'Good' }, context(config)), 422)
  action(store, 'interviews', interview, 'submit-feedback', { answers: { a: 2, b: 4 }, comments: 'Clear evidence.' }, context(config, 'interviewer', 'person-1'))
  const feedback = store.list('feedback')[0]
  assert.equal(feedback.weightedScore, 3.5)
  assert.ok(feedback.lockedAt)
  rejectStatus(() => action(store, 'interviews', interview, 'submit-feedback', { answers: { a: 3, b: 3 }, comments: 'Changed' }, context(config, 'interviewer', 'person-1')), 409)
})

test('feedback resolves job scorecards and enforces recommendation rules through the engine', () => {
  const store = memoryStore({ jobs: [{ id: 'job-1', roleId: 'designer' }] })
  const config = { roles: [{ id: 'designer' }], scorecards: [
    { id: 'default', default: true, competencies: [{ id: 'general' }] },
    { id: 'job-card', jobIds: ['job-1'], ratingScale: { min: 1, max: 5 }, recommendationRequired: true, recommendations: ['yes', 'no'], competencies: [{ id: 'craft', weight: 2 }, { id: 'collaboration', required: false, weight: 1 }] }
  ] }
  const interview = { id: 'i-job', status: 'scheduled', applicationId: 'app', jobId: 'job-1' }
  rejectStatus(() => action(store, 'interviews', interview, 'submit-feedback', { ratings: { craft: 4 }, feedback: 'Strong craft.' }, context(config)), 422)
  rejectStatus(() => action(store, 'interviews', interview, 'submit-feedback', { ratings: { craft: 4 }, feedback: 'Strong craft.', recommendation: 'maybe' }, context(config)), 422)
  action(store, 'interviews', interview, 'submit-feedback', { ratings: { craft: 4 }, feedback: 'Strong craft.', recommendation: 'yes' }, context(config))
  const feedback = store.list('feedback')[0]
  assert.equal(feedback.scorecardId, 'job-card')
  assert.equal(feedback.weightedScore, 4)
  assert.equal(feedback.comments, 'Strong craft.')
  assert.equal(feedback.recommendation, 'yes')
})

test('offer acceptance creates one configured onboarding plan and is not repeatable', () => {
  const store = memoryStore({ applications: [{ id: 'a', candidateId: 'c', jobId: 'j' }], jobs: [{ id: 'j', openings: 1 }] })
  const config = { offers: {}, onboardingTemplates: [{ id: 'standard', tasks: [{ id: 'docs', title: 'Collect documents' }] }] }
  const offer = { id: 'o', status: 'sent', applicationId: 'a', candidateId: 'c', jobId: 'j' }
  const accepted = action(store, 'offers', offer, 'accept', {}, context(config))
  assert.equal(accepted.status, 'accepted')
  assert.equal(store.list('onboarding').length, 1)
  assert.equal(store.list('onboarding')[0].checklist[0].title, 'Collect documents')
  assert.deepEqual(store.list('onboarding')[0].checklist[0], { id: 'docs', title: 'Collect documents', required: true, status: 'pending', assigneeId: 'u-admin', dueDate: null })
  assert.equal(store.list('onboarding')[0].checklistSummary.requiredIncomplete, 1)
  rejectStatus(() => action(store, 'offers', accepted, 'accept', {}, context(config)), 409)
})

test('accepted offer provisions joining-date due dates and checklist actions enforce required completion', () => {
  const store = memoryStore()
  const config = { onboardingTemplates: [{ id: 'standard', tasks: [
    { id: 'forms', title: 'Complete forms', daysFromJoining: -2, required: true },
    { id: 'welcome', title: 'Read welcome guide', daysFromJoining: 2, required: false }
  ] }] }
  const accepted = action(store, 'offers', { id: 'offer', status: 'sent', candidateId: 'candidate' }, 'accept', { joiningDate: '2026-10-20', ownerId: 'onboarding-owner' }, context(config))
  const onboarding = store.list('onboarding')[0]
  assert.equal(onboarding.ownerId, 'onboarding-owner')
  assert.equal(onboarding.checklist[0].dueDate, '2026-10-18')
  assert.equal(onboarding.checklist[0].assigneeId, 'onboarding-owner')
  assert.equal(onboarding.checklist[1].dueDate, '2026-10-22')
  rejectStatus(() => action(store, 'onboarding', onboarding, 'complete', {}, context(config)), 409)

  const completeRequired = action(store, 'onboarding', onboarding, 'checklist-item', { itemId: 'forms', status: 'completed' }, context(config))
  assert.equal(completeRequired.checklistSummary.requiredIncomplete, 0)
  const completed = action(store, 'onboarding', completeRequired, 'complete', {}, context(config))
  assert.equal(completed.status, 'completed')
  assert.equal(completed.checklistSummary.canComplete, true)
  assert.ok(completed.completedAt)
  rejectStatus(() => action(store, 'onboarding', completed, 'checklist-item', { itemId: 'unknown', status: 'completed' }, context(config)), 404)
})

test('hiring is idempotent and creates configured onboarding once', () => {
  const store = memoryStore({ candidates: [{ id: 'c', status: 'active' }], jobs: [{ id: 'j', openings: 1, filled: 0 }], applications: [], onboarding: [] })
  const config = { pipelines: [{ id: 'p', stages: [{ id: 'applied' }, { id: 'hired' }], transitions: [{ from: 'applied', to: 'hired' }] }], onboardingTemplates: [{ id: 't', tasks: [{ title: 'Welcome' }] }] }
  const application = { id: 'a', status: 'active', stage: 'applied', pipelineId: 'p', candidateId: 'c', jobId: 'j' }
  const hired = action(store, 'applications', application, 'hire', {}, context(config))
  action(store, 'applications', hired, 'hire', {}, context(config))
  assert.equal(store.get('jobs', 'j').filled, 1)
  assert.equal(store.list('onboarding').length, 1)
  const history = store.get('applications', 'a').stageHistory
  assert.deepEqual(history.map(entry => entry.stageId), ['applied', 'hired'])
  assert.ok(history[0].leftAt)
  assert.equal(history[1].leftAt, null)
})

test('stage movement persists entry and exit timestamps and terminal transitions', () => {
  const store = memoryStore({ jobs: [{ id: 'j', pipelineId: 'p' }], applications: [{ id: 'a', jobId: 'j', pipelineId: 'p', stage: 'applied', status: 'active', createdAt: '2026-09-01T00:00:00.000Z' }] })
  const config = { pipelines: [{ id: 'p', default: true, stages: [{ id: 'applied' }, { id: 'screening' }] }] }
  const moved = action(store, 'applications', store.get('applications', 'a'), 'move-stage', { stage: 'screening' }, context(config, 'recruiter', 'recruiter'))
  assert.deepEqual(moved.stageHistory.map(entry => entry.stageId), ['applied', 'screening'])
  assert.equal(moved.stageHistory[0].enteredAt, '2026-09-01T00:00:00.000Z')
  assert.ok(moved.stageHistory[0].leftAt)
  assert.equal(moved.stageHistory[1].enteredAt, moved.stageChangedAt)
  const rejected = action(store, 'applications', moved, 'reject', { reason: 'Not a fit' }, context(config, 'recruiter', 'recruiter'))
  assert.equal(rejected.stageHistory.at(-1).stageId, 'rejected')
  assert.equal(rejected.stageHistory.at(-2).leftAt, rejected.endedAt)
})

test('agency placement, invoice, and paid actions preserve linked records and are idempotent', () => {
  const store = memoryStore({ candidates: [{ id: 'c' }], jobs: [{ id: 'j' }], placements: [], invoices: [] })
  const config = { agency: { defaultGuaranteeDays: 90 }, regional: { currency: 'USD' }, approvalWorkflows: [] }
  const submission = { id: 's', status: 'submitted', candidateId: 'c', jobId: 'j', clientId: 'client', fee: 12000 }
  const placement = action(store, 'submissions', submission, 'place', { startDate: '2026-11-01' }, context(config))
  assert.ok(placement.guaranteeExpiry)
  const invoice = action(store, 'placements', placement, 'invoice', { dueDate: '2026-12-01' }, context(config))
  assert.equal(invoice.placementId, placement.id)
  assert.equal(invoice.amount, 12000)
  const paid = action(store, 'invoices', invoice, 'mark-paid', { reference: 'mock-ref' }, context(config))
  assert.equal(paid.status, 'paid')
  assert.equal(action(store, 'invoices', paid, 'mark-paid', {}, context(config)).paidAt, paid.paidAt)
})

test('automation run action cannot mutate a counter-only run record', () => {
  rejectStatus(() => action(memoryStore(), 'automations', { id: 'run-1', runCount: 0 }, 'run', {}, context()), 422)
})
