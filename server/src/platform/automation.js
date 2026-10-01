'use strict'

const { now, uid } = require('./database')
const { action: workflowAction, validateTransition } = require('./workflows')
const { allowsAutomationNotification } = require('./notification-policy')

const MAX_AUTOMATIONS_PER_EVENT = 50
const MAX_ACTIONS_PER_EVENT = 100

function readPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((cursor, key) => cursor == null ? undefined : cursor[key], value)
}

function normalizeTrigger(trigger) {
  return typeof trigger === 'string' ? trigger : trigger?.event || trigger?.name || trigger?.type || ''
}

function matchesCondition(condition, record) {
  if (!condition || typeof condition !== 'object') return true
  const actual = readPath(record, condition.field || condition.path || condition.key)
  const expected = condition.value
  switch (condition.operator || 'equals') {
    case 'notEquals': case 'ne': return actual !== expected
    case 'contains': return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected ?? ''))
    case 'exists': return actual !== undefined && actual !== null && actual !== ''
    case 'notExists': return actual === undefined || actual === null || actual === ''
    case 'gt': return Number(actual) > Number(expected)
    case 'gte': return Number(actual) >= Number(expected)
    case 'lt': return Number(actual) < Number(expected)
    case 'lte': return Number(actual) <= Number(expected)
    case 'equals': case 'eq': default: return actual === expected
  }
}

function interpolate(template, context) {
  if (template == null) return ''
  return String(template).replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => {
    const normalized = key.trim()
    const aliases = {
      candidate: context.candidate?.name || context.candidate?.fullName,
      job: context.job?.title || context.job?.name,
      company: context.config?.company?.name || context.config?.companyName || context.config?.branding?.name,
      date: context.record?.scheduledAt || context.record?.date || context.record?.startAt,
    }
    let value = Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : undefined
    if (value === undefined) {
      const [scope, ...rest] = normalized.split('.')
      const root = context[scope] || context.record
      value = readPath(root, rest.length ? rest.join('.') : normalized)
    }
    // Explicit template variables let admins define reusable terminology while
    // preserving the regular record/candidate/job scopes.
    if (value === undefined) value = readPath(context.variables, normalized)
    if (value && typeof value === 'object') value = value.name || value.title || value.fullName || ''
    return value == null ? '' : String(value)
  })
}

function stableEventKey(event, record, explicitKey) {
  return explicitKey || `${event}:${record?.id || 'none'}:${record?.updatedAt || record?.createdAt || ''}`
}

const PRIVATE_NOTIFICATION_KEYS = /salary|compensation|bonus|equity|feedback|private.?notes?|offer.?details|contact|email|phone|mobile|address/i
function notificationSafeRecord(value) {
  if (Array.isArray(value)) return value.map(notificationSafeRecord)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_NOTIFICATION_KEYS.test(key)).map(([key, child]) => [key, notificationSafeRecord(child)]))
}

function runAutomations({ store, config = {}, actor = {}, users = [], event, record = {}, audit = () => {}, nowFn = now, eventKey, depth = 0, maxRuns = MAX_AUTOMATIONS_PER_EVENT, maxActions = MAX_ACTIONS_PER_EVENT, onlyRuleId = null, executionMode = 'event' } = {}) {
  if (!store || typeof store.put !== 'function' || typeof store.list !== 'function') throw new TypeError('runAutomations requires a record store with list and put methods.')
  if (!event) throw new TypeError('runAutomations requires an event name.')
  const key = stableEventKey(event, record, eventKey)
  const prior = store.list('outbox').find(item => item.eventKey === key)
  if (prior) return { eventId: prior.id, duplicate: true, runs: [], actionCount: 0 }

  const actorId = actor.id || 'system'
  const eventRecord = store.put('outbox', {
    event, eventKey: key, payload: { id: record.id || null, kind: record.__kind || event.split('.')[0] }, executionMode,
    status: depth > 0 ? 'loop_guarded' : 'processed', deliveryMode: 'mock', attempts: 0, createdAt: nowFn(),
  }, actorId)
  if (depth > 0) return { eventId: eventRecord.id, duplicate: false, loopGuarded: true, runs: [], actionCount: 0 }

  const eventKind = event.split('.')[0]
  const pluralKind = { application: 'applications', candidate: 'candidates', job: 'jobs', task: 'tasks' }[eventKind] || eventKind
  const context = { record, actor, config }
  const matching = (Array.isArray(config.automations) ? config.automations : []).slice(0, Math.min(maxRuns, MAX_AUTOMATIONS_PER_EVENT))
    .filter(rule => rule && rule.enabled !== false && normalizeTrigger(rule.trigger) === event)
    .filter(rule => !onlyRuleId || rule.id === onlyRuleId)
    .filter(rule => {
      const conditions = rule.conditions || (Array.isArray(rule.when) ? rule.when : rule.when ? [rule.when] : [])
      return conditions.every(condition => matchesCondition(condition, record))
    })
  const runs = []
  let remainingActions = Math.max(0, Math.min(maxActions, MAX_ACTIONS_PER_EVENT))

  for (const rule of matching) {
    const actions = Array.isArray(rule.actions) ? rule.actions : []
    const actionResults = []
    for (const actionConfig of actions) {
      if (remainingActions <= 0) {
        actionResults.push({ type: actionConfig?.type || actionConfig?.action || 'unknown', status: 'skipped', reason: 'Event action limit reached.' })
        continue
      }
      remainingActions--
      try {
      actionResults.push(executeAction({ actionConfig, rule, event, record, actor, users, config, store, audit, nowFn, context, eventKind: pluralKind }))
      } catch (error) {
        actionResults.push({ type: actionConfig?.type || actionConfig?.action || 'unknown', status: 'failed', error: error.message })
      }
    }
    const failed = actionResults.some(result => result.status === 'failed')
    const run = store.put('automations', {
      id: uid('automation-run'), automationId: rule.id || null, automationName: rule.name || '',
      event, eventId: eventRecord.id, eventKey: key, recordId: record.id || null, executionMode,
      status: failed ? 'partial' : 'completed', actionResults, actionCount: actionResults.filter(result => result.status === 'completed').length,
      executedAt: nowFn(), actorId,
    }, actorId)
    runs.push(run)
    audit('automation.executed', 'automations', run.id, { automationId: rule.id, event, status: run.status, executionMode })
  }
  return { eventId: eventRecord.id, duplicate: false, runs, actionCount: runs.reduce((count, run) => count + run.actionCount, 0) }
}

function executeAction({ actionConfig = {}, rule, event, record, actor, users, config, store, audit, nowFn, context, eventKind }) {
  const type = String(actionConfig.type || actionConfig.action || '').replace(/[-\s]/g, '_').toLowerCase()
  const actorId = actor.id || 'system'
  const kind = actionConfig.kind || record.__kind || eventKind || event.split('.')[0]
  const current = store.get(kind, record.id) || record
  const templateContext = {
    ...context,
    candidate: current.candidateId ? (store.get('candidates', current.candidateId) || {}) : {},
    job: current.jobId ? (store.get('jobs', current.jobId) || {}) : {},
  }
  const id = uid('automation-action')
  const result = (details = {}) => ({ id, type, status: 'completed', ...details })

  if (['create_task', 'task'].includes(type)) {
    const task = store.put('tasks', {
      title: interpolate(actionConfig.title || actionConfig.name || rule.name || `Follow up: ${event}`, templateContext),
      description: interpolate(actionConfig.description || '', templateContext), ownerId: actionConfig.ownerId || actionConfig.userId || current.ownerId || actorId,
      dueDate: actionConfig.dueDate || null, priority: actionConfig.priority || 'normal', status: 'open',
      relatedKind: kind, relatedId: current.id || record.id, automationId: rule.id || null,
    }, actorId)
    return result({ recordId: task.id, recordKind: 'tasks' })
  }
  if (['create_notification', 'notification', 'notify'].includes(type)) {
    const recipientIds = actionConfig.userId ? [actionConfig.userId] : actionConfig.roleId ? users.filter(user => user.roleId === actionConfig.roleId).map(user => user.id) : [actorId]
    const decisions = recipientIds.map(userId => ({ userId, policy: allowsAutomationNotification(config, { actionConfig, actionType: type, event, record, userId }) }))
    const allowedRecipients = decisions.filter(item => item.policy.allowed).map(item => item.userId)
    const category = decisions[0]?.policy.category || allowsAutomationNotification(config, { actionConfig, actionType: type, event, record }).category
    if (!allowedRecipients.length) return { id, type, status: 'skipped', reason: decisions[0]?.policy.reason || 'no eligible recipients', category }
    // Notification templates are intentionally given a reduced context. Automation
    // authored text must not accidentally expose compensation or private feedback.
    const notificationContext = { record: notificationSafeRecord(record), candidate: notificationSafeRecord(templateContext.candidate), job: notificationSafeRecord(templateContext.job) }
    const created = allowedRecipients.map(userId => store.put('notifications', {
      userId, title: interpolate(actionConfig.title || rule.name || event, notificationContext),
      body: interpolate(actionConfig.body || event, notificationContext), read: false, createdAt: nowFn(), automationId: rule.id || null,
      category, relatedKind: kind, relatedId: record.id || null,
    }, actorId))
    return result({ recordIds: created.map(item => item.id), recordKind: 'notifications', skippedRecipients: decisions.filter(item => !item.policy.allowed).map(item => item.userId) })
  }
  if (['send_communication', 'send_email', 'send_template', 'communication'].includes(type)) {
    const candidate = current.candidateId && store.get('candidates', current.candidateId)
    const job = current.jobId && store.get('jobs', current.jobId)
    const templates = Array.isArray(config.communicationTemplates) ? config.communicationTemplates : []
    const templateId = actionConfig.templateId || actionConfig.template
    const requestedLanguage = actionConfig.language || candidate?.language || config.locale || 'en'
    const languageMatch = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase()
    const template = templateId
      ? templates.find(item => item.id === templateId)
      : templates.find(item => item.event === event && languageMatch(item.language, requestedLanguage))
        || templates.find(item => item.event === event && String(item.language || '').split(/[-_]/)[0] === String(requestedLanguage).split(/[-_]/)[0])
        || templates.find(item => item.event === event && (!item.language || item.language === 'en'))
        || templates.find(item => item.event === event)
    const communicationContext = { ...templateContext, candidate: candidate || {}, job: job || {}, variables: actionConfig.variables || {} }
    const requiresApproval = actionConfig.approvalRequired === true || template?.approvalRequired === true
    const renderedSubject = interpolate(actionConfig.subject || template?.subject || rule.name || 'ATS notification', communicationContext)
    const renderedBody = interpolate(actionConfig.body || template?.body || '', communicationContext)
    const sender = actionConfig.sender || template?.sender || config.integrations?.email?.from || config.integrations?.email?.sender || ''
    const outbox = store.put('outbox', {
      event: 'communication.mock_sent', eventKey: `${event}:${record.id || ''}:${rule.id || ''}:${id}`,
      status: requiresApproval ? 'approval_required' : 'sent', deliveryMode: 'mock', channel: actionConfig.channel || template?.channel || 'email',
      recipient: actionConfig.recipient || candidate?.email || current.email || '',
      sender, language: template?.language || requestedLanguage,
      subject: renderedSubject, body: renderedBody, templateId: template?.id || null,
      approvalRequired: requiresApproval, approvedAt: null, approvedBy: null,
      relatedKind: kind, relatedId: record.id || null, automationId: rule.id || null, createdAt: nowFn(),
    }, actorId)
    return result({ recordId: outbox.id, recordKind: 'outbox', deliveryMode: 'mock', status: outbox.status, approvalRequired: requiresApproval })
  }
  if (['assign_owner', 'assign'].includes(type)) {
    const ownerId = actionConfig.ownerId || actionConfig.userId || actionConfig.value
    if (!ownerId || !users.some(user => user.id === ownerId)) throw new Error('Assignment must reference a configured user.')
    const updated = store.put(kind, { ...current, [actionConfig.field || 'ownerId']: ownerId }, actorId)
    audit('automation.owner-assigned', kind, updated.id, { ownerId, automationId: rule.id })
    return result({ recordId: updated.id, recordKind: kind, ownerId })
  }
  if (['add_tag', 'tag'].includes(type)) {
    const tag = actionConfig.tag || actionConfig.value
    if (!tag) throw new Error('A tag value is required.')
    const tags = Array.isArray(current.tags) ? current.tags : []
    const updated = store.put(kind, { ...current, tags: tags.includes(tag) ? tags : [...tags, tag] }, actorId)
    return result({ recordId: updated.id, recordKind: kind, tag })
  }
  if (['move_stage', 'change_stage'].includes(type)) {
    if (kind !== 'applications') throw new Error('Pipeline stage actions only apply to applications.')
    const targetStage = actionConfig.stage || actionConfig.to || actionConfig.value
    const workflowRecord = { ...current, __actorRole: actor.roleId || actor.role || '' }
    validateTransition(config, workflowRecord, targetStage, store)
    const updated = store.put(kind, { ...current, stage: targetStage, stageEnteredAt: nowFn(), lastStageChangedAt: nowFn(), stageChangedBy: actorId }, actorId)
    audit('automation.stage-moved', kind, updated.id, { from: current.stage, to: targetStage, automationId: rule.id })
    return result({ recordId: updated.id, recordKind: kind, from: current.stage, to: targetStage })
  }
  if (['change_status', 'set_status'].includes(type)) {
    const targetStatus = actionConfig.status || actionConfig.value
    if (kind === 'applications') {
      const statusActions = { rejected: 'reject', withdrawn: 'withdraw', hired: 'hire' }
      const workflowName = statusActions[targetStatus]
      if (!workflowName) throw new Error('Application status changes must use reject, withdraw, or hire workflow actions.')
      const updated = workflowAction(store, kind, current, workflowName, { reason: actionConfig.reason || 'Automation' }, {
        user: { ...actor, id: actorId }, config, audit: (name, changedKind, recordId, details) => audit(name, changedKind, recordId, details),
        emit: () => {}, canApproveAny: false,
      })
      return result({ recordId: updated.id, recordKind: kind, status: updated.status })
    }
    throw new Error(`Direct status changes are not supported for ${kind}. Use its workflow action.`)
  }
  if (['request_approval', 'approval'].includes(type)) {
    const workflow = (config.approvalWorkflows || []).find(item => item.id === actionConfig.workflowId || item.module === kind)
    const steps = workflow?.steps || []
    if (!steps.length) throw new Error('No configured approval workflow matches this record.')
    const approval = store.put('approvals', {
      recordKind: kind, recordId: current.id || record.id, relatedKind: kind, relatedId: current.id || record.id,
      workflowId: workflow.id, title: interpolate(actionConfig.title || `${workflow.name}: ${current.title || current.name || current.id}`, context),
      status: 'pending', approvals: steps.map(step => step.userId || step.roleId), approvalsCompleted: [], createdAt: nowFn(), requestedBy: actorId,
    }, actorId)
    return result({ recordId: approval.id, recordKind: 'approvals', workflowId: workflow.id })
  }
  throw new Error(`Unsupported automation action “${type || 'unspecified'}”.`)
}

module.exports = { runAutomations, matchesCondition, normalizeTrigger, MAX_AUTOMATIONS_PER_EVENT, MAX_ACTIONS_PER_EVENT }
