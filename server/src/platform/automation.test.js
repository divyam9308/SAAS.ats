'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { runAutomations } = require('./automation')
const { defaults } = require('../../../shared/ats-config.cjs')

class MemoryStore {
  constructor(seed = {}) { this.rows = new Map(Object.entries(seed).map(([kind, rows]) => [kind, new Map(rows.map(row => [row.id, structuredClone(row)]))])) }
  list(kind) { return [...(this.rows.get(kind)?.values() || [])].map(row => structuredClone(row)) }
  get(kind, id) { const row = this.rows.get(kind)?.get(id); return row ? structuredClone(row) : null }
  put(kind, value) {
    const row = { ...value, id: value.id || `${kind}-${this.list(kind).length + 1}` }
    if (!this.rows.has(kind)) this.rows.set(kind, new Map())
    this.rows.get(kind).set(row.id, structuredClone(row))
    return structuredClone(row)
  }
}

const time = '2026-06-01T10:00:00.000Z'
const user = { id: 'demo-recruiter', roleId: 'recruiter' }
const users = [user, { id: 'demo-hr-head', roleId: 'hr-head' }]
function baseConfig() {
  const config = defaults('corporate')
  config.automations = [{ id: 'new-app-follow-up', name: 'New application follow-up', enabled: true, trigger: 'application.created', actions: [{ type: 'create_task', title: 'Review {{candidate.name}}', ownerId: user.id }] }]
  return config
}

test('matching event creates one task and a persistent run record, and retries are idempotent', () => {
  const store = new MemoryStore({ applications: [{ id: 'app-1', candidateId: 'candidate-1', jobId: 'job-1', status: 'active', updatedAt: time }], candidates: [{ id: 'candidate-1', name: 'Rae Chen' }] })
  const audits = []
  const input = { store, config: baseConfig(), actor: user, users, event: 'application.created', record: store.get('applications', 'app-1'), audit: (...args) => audits.push(args), nowFn: () => time }
  const first = runAutomations(input)
  assert.equal(first.actionCount, 1)
  assert.equal(store.list('outbox').filter(row => row.event === 'application.created').length, 1)
  const tasks = store.list('tasks')
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].title, 'Review Rae Chen')
  assert.equal(tasks[0].ownerId, user.id)
  assert.equal(tasks[0].automationId, 'new-app-follow-up')
  assert.equal(tasks[0].relatedId, 'app-1')
  assert.equal(store.list('automations').length, 1)
  assert.equal(store.list('automations')[0].recordId, 'app-1')
  assert.equal(audits.length, 1)

  const retry = runAutomations(input)
  assert.equal(retry.duplicate, true)
  assert.equal(store.list('tasks').length, 1)
  assert.equal(store.list('automations').length, 1)
})

test('conditions filter rules and notification action persists user-specific notification without a task', () => {
  const config = baseConfig()
  config.automations = [{ id: 'notify-new', enabled: true, trigger: { event: 'application.created' }, conditions: [{ field: 'source', operator: 'contains', value: 'Referral' }], actions: [{ type: 'create_notification', userId: 'demo-hr-head', title: 'Review {{candidate.name}}' }] }]
  const store = new MemoryStore({ applications: [{ id: 'app-2', candidateId: 'candidate-2', source: 'Employee Referral', updatedAt: time }], candidates: [{ id: 'candidate-2', name: 'Ari Singh' }] })
  const result = runAutomations({ store, config, actor: user, users, event: 'application.created', record: store.get('applications', 'app-2'), nowFn: () => time })
  assert.equal(result.actionCount, 1)
  assert.equal(store.list('notifications').length, 1)
  assert.equal(store.list('notifications')[0].userId, 'demo-hr-head')
  assert.equal(store.list('notifications')[0].automationId, 'notify-new')
  assert.equal(store.list('notifications')[0].title, 'Review Ari Singh')
  assert.equal(store.list('tasks').length, 0)
})

test('automation notifications honor channel/category preferences and avoid sensitive interpolation', () => {
  const config = baseConfig()
  config.automations = [{ id: 'offer-alert', enabled: true, trigger: 'offer.sent', actions: [{ type: 'create_notification', userId: 'demo-hr-head', title: 'Offer {{record.id}} salary {{record.salary}}', body: '{{record.feedback}} {{candidate.name}}' }] }]
  const offer = { id: 'offer-private', candidateId: 'candidate-private', salary: 240000, feedback: 'Confidential panel feedback', updatedAt: time }
  const store = new MemoryStore({ offers: [offer], candidates: [{ id: 'candidate-private', name: 'Ari Singh', email: 'ari@example.test' }] })
  let result = runAutomations({ store, config, actor: user, event: 'offer.sent', record: offer, nowFn: () => time })
  assert.equal(result.actionCount, 1)
  assert.equal(store.list('notifications')[0].category, 'offers')
  assert.equal(store.list('notifications')[0].title, 'Offer offer-private salary ')
  assert.equal(store.list('notifications')[0].body, ' Ari Singh')

  const disabledStore = new MemoryStore({ offers: [offer] })
  config.notifications.channels = ['email']
  result = runAutomations({ store: disabledStore, config, actor: user, event: 'offer.sent', record: offer, eventKey: 'disabled-channel', nowFn: () => time })
  assert.equal(result.actionCount, 0)
  assert.equal(disabledStore.list('notifications').length, 0)
  assert.equal(disabledStore.list('automations')[0].actionResults[0].status, 'skipped')

  const categoryStore = new MemoryStore({ offers: [offer] })
  config.notifications.channels = ['in_app']
  config.notifications.preferences.offers = false
  result = runAutomations({ store: categoryStore, config, actor: user, event: 'offer.sent', record: offer, eventKey: 'disabled-category', nowFn: () => time })
  assert.equal(result.actionCount, 0)
  assert.equal(categoryStore.list('notifications').length, 0)
})

test('mock communication uses configured template and recipient but never claims live delivery', () => {
  const config = baseConfig()
  config.communicationTemplates = [{ id: 'received', event: 'application.created', channel: 'email', subject: 'Hello {{candidate.name}}', body: 'Role: {{job.title}}' }]
  config.automations = [{ id: 'email-new', enabled: true, trigger: 'application.created', actions: [{ type: 'send_communication', templateId: 'received' }] }]
  const store = new MemoryStore({ applications: [{ id: 'app-3', candidateId: 'candidate-3', jobId: 'job-3', updatedAt: time }], candidates: [{ id: 'candidate-3', name: 'Nia Rao', email: 'nia@example.test' }], jobs: [{ id: 'job-3', title: 'Designer' }] })
  runAutomations({ store, config, actor: user, users, event: 'application.created', record: store.get('applications', 'app-3'), nowFn: () => time })
  const message = store.list('outbox').find(row => row.event === 'communication.mock_sent')
  assert.equal(message.deliveryMode, 'mock')
  assert.equal(message.status, 'sent')
  assert.equal(message.recipient, 'nia@example.test')
  assert.equal(message.subject, 'Hello Nia Rao')
  assert.equal(message.body, 'Role: Designer')
  assert.equal(store.list('tasks').length, 0)
})

test('communication renders explicit variables, selects language, records sender, and gates required approval', () => {
  const config = baseConfig()
  config.company.name = 'Fyndbridge'
  config.communicationTemplates = [
    { id: 'received-en', event: 'application.created', channel: 'email', language: 'en', subject: 'English', body: '' },
    { id: 'received-hi', event: 'application.created', channel: 'email', language: 'hi', sender: 'Hiring <jobs@example.test>', subject: 'Namaste {{candidate}} at {{company}}', body: 'Role: {{job}} / {{custom.greeting}}', approvalRequired: true },
  ]
  config.automations = [{ id: 'email-hi', enabled: true, trigger: 'application.created', actions: [{ type: 'send_communication', language: 'hi', variables: { custom: { greeting: 'Hello' } } }] }]
  const app = { id: 'app-hi', candidateId: 'candidate-hi', jobId: 'job-hi', updatedAt: time }
  const store = new MemoryStore({ applications: [app], candidates: [{ id: 'candidate-hi', name: 'Asha', language: 'hi', email: 'asha@example.test' }], jobs: [{ id: 'job-hi', title: 'Engineer' }] })
  runAutomations({ store, config, actor: user, users, event: 'application.created', record: app, nowFn: () => time })
  const message = store.list('outbox').find(row => row.templateId === 'received-hi')
  assert.equal(message.recipient, 'asha@example.test')
  assert.equal(message.sender, 'Hiring <jobs@example.test>')
  assert.equal(message.language, 'hi')
  assert.equal(message.subject, 'Namaste Asha at Fyndbridge')
  assert.equal(message.body, 'Role: Engineer / Hello')
  assert.equal(message.approvalRequired, true)
  assert.equal(message.status, 'approval_required')
  assert.equal(message.approvedAt, null)
  assert.equal(store.list('automations')[0].actionResults[0].approvalRequired, true)
})

test('stage action uses configured workflow validation and loop depth blocks execution', () => {
  const config = baseConfig()
  config.automations = [{ id: 'screen-app', trigger: 'application.created', actions: [{ type: 'move_stage', stage: 'screening' }] }]
  const app = { id: 'app-4', jobId: 'job-4', pipelineId: 'general', stage: 'applied', status: 'active', updatedAt: time }
  const store = new MemoryStore({ applications: [app], jobs: [{ id: 'job-4', pipelineId: 'general' }] })
  const moved = runAutomations({ store, config, actor: { ...user, roleId: 'recruiter' }, event: 'application.created', record: app, nowFn: () => time })
  assert.equal(moved.actionCount, 1)
  assert.equal(store.get('applications', 'app-4').stage, 'screening')

  const blockedStore = new MemoryStore({ applications: [app], jobs: [{ id: 'job-4', pipelineId: 'general' }] })
  const blocked = runAutomations({ store: blockedStore, config, actor: user, event: 'application.created', record: app, depth: 1, nowFn: () => time })
  assert.equal(blocked.loopGuarded, true)
  assert.equal(blockedStore.list('tasks').length, 0)
  assert.equal(blockedStore.list('automations').length, 0)
})

test('invalid stage/status actions are captured as failed instead of mutating workflow state', () => {
  const config = baseConfig()
  config.automations = [{ id: 'invalid-transition', trigger: 'application.created', actions: [{ type: 'move_stage', stage: 'hired' }, { type: 'change_status', status: 'active' }] }]
  const app = { id: 'app-5', jobId: 'job-5', pipelineId: 'general', stage: 'applied', status: 'active', updatedAt: time }
  const store = new MemoryStore({ applications: [app], jobs: [{ id: 'job-5', pipelineId: 'general' }] })
  const result = runAutomations({ store, config, actor: user, event: 'application.created', record: app, nowFn: () => time })
  assert.equal(result.actionCount, 0)
  assert.equal(store.get('applications', app.id).stage, 'applied')
  assert.equal(store.get('applications', app.id).status, 'active')
  assert.equal(store.list('automations')[0].status, 'partial')
  assert.equal(store.list('automations')[0].actionResults.length, 2)
})

test('manual execution is restricted to the selected configured rule', () => {
  const config = baseConfig()
  config.automations = [
    { id: 'selected', trigger: 'application.created', actions: [{ type: 'create_task', title: 'Selected action' }] },
    { id: 'unselected', trigger: 'application.created', actions: [{ type: 'create_task', title: 'Must not execute' }] },
  ]
  const app = { id: 'app-selected', candidateId: 'candidate-1', status: 'active', updatedAt: time }
  const store = new MemoryStore({ applications: [app] })
  const result = runAutomations({ store, config, actor: user, users, event: 'application.created', record: app, onlyRuleId: 'selected', executionMode: 'manual', nowFn: () => time })
  assert.deepEqual(result.runs.map(run => run.automationId), ['selected'])
  assert.equal(result.runs[0].executionMode, 'manual')
  assert.deepEqual(store.list('tasks').map(task => task.title), ['Selected action'])
})
