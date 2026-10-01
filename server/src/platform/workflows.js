'use strict'

const { now } = require('./database')
const { checklistFromTemplate, transitionChecklistItem, summarizeChecklist, completeOnboarding, OnboardingChecklistError } = require('./onboarding-checklist')
const { resolveScorecard, evaluateScorecard, assertFeedbackSubmissionAvailable, ScorecardError } = require('./scorecard-engine')
const { InterviewCalendarError, validateInterviewSchedule, findInterviewConflict, createMockCalendarEvent, transitionMockCalendarEvent } = require('./interview-calendar')

class WorkflowError extends Error {
  constructor(message, status = 409) { super(message); this.status = status }
}

function pipelinesFor(config) { return config?.hiring?.pipelines || config?.pipelines || [] }
function findPipeline(config, application = {}, job = {}) {
  const pipelines = pipelinesFor(config)
  if (!Array.isArray(pipelines)) return pipelines[application.pipelineId || job.pipelineId] || null
  return pipelines.find(p => p.id === (application.pipelineId || job.pipelineId)) || pipelines.find(p => p.default || p.isDefault) || pipelines[0] || null
}
function stageList(pipeline) { return pipeline?.stages || pipeline?.steps || [] }
function stageKey(stage) { return typeof stage === 'string' ? stage : (stage?.id || stage?.key || stage?.name) }
function stageLabel(stage) { return typeof stage === 'string' ? stage : (stage?.name || stage?.label || stage?.id) }

function validateTransition(config, application, targetStage, store) {
  const job = store.get('jobs', application.jobId) || {}
  const pipeline = findPipeline(config, application, job)
  const stages = stageList(pipeline)
  if (!stages.length) throw new WorkflowError('No pipeline is configured for this job.', 422)
  const current = stages.find(s => [stageKey(s), stageLabel(s)].includes(application.stage))
  const target = stages.find(s => [stageKey(s), stageLabel(s)].includes(targetStage))
  if (!target) throw new WorkflowError(`Stage “${targetStage}” is not in the selected pipeline.`, 422)
  if (!current) throw new WorkflowError(`Current stage “${application.stage || ''}” is not in the selected pipeline.`, 409)

  const roleId = application.__actorRole || ''
  const transitions = pipeline.transitions
  if (Array.isArray(transitions) && transitions.length && !transitions.some(t =>
    (t.from === stageKey(current) || t.from === application.stage) && (t.to === stageKey(target) || t.to === targetStage))) {
    throw new WorkflowError('This configured pipeline transition is not permitted.', 409)
  }
  if (Array.isArray(target.allowedRoles) && target.allowedRoles.length && !target.allowedRoles.includes(roleId)) {
    throw new WorkflowError('Your role cannot move applications into this stage.', 403)
  }
  if (Array.isArray(current.allowedTransitions) && current.allowedTransitions.length && !current.allowedTransitions.includes(stageKey(target)) && !current.allowedTransitions.includes(stageLabel(target))) {
    throw new WorkflowError(`Moving from ${stageLabel(current)} to ${stageLabel(target)} is not permitted.`, 409)
  }
  const currentIndex = stages.indexOf(current), targetIndex = stages.indexOf(target)
  if ((!Array.isArray(transitions) || !transitions.length) && (!current.allowedTransitions || !current.allowedTransitions.length) && targetIndex !== currentIndex + 1 && targetIndex !== currentIndex) {
    throw new WorkflowError('Applications must move through pipeline stages in order.', 409)
  }

  const requirements = [...(target.requires || []), ...(target.requirements || target.requiredActions || [])]
  for (const item of requirements) {
    const requirement = typeof item === 'string' ? item : (item?.type || item?.id || item?.action)
    if (requirement === 'feedback' && !store.list('feedback').some(f => f.applicationId === application.id && f.status === 'submitted')) {
      throw new WorkflowError('Submit required interview feedback before moving this application.', 409)
    }
    if (requirement === 'interview' && !store.list('interviews').some(i => i.applicationId === application.id && i.status === 'completed')) {
      throw new WorkflowError('Complete a required interview before moving this application.', 409)
    }
    if (requirement === 'approval' && !store.list('approvals').some(a => a.applicationId === application.id && a.status === 'approved') && !store.list('offers').some(o => o.applicationId === application.id && ['sent', 'accepted'].includes(o.status))) {
      throw new WorkflowError('Complete the configured approval before moving this application.', 409)
    }
  }
  return { target, pipeline }
}

function findApprovalWorkflow(config, kind, record) {
  const id = kind === 'requisitions' ? config?.requisitions?.approvalWorkflowId : kind === 'offers' ? config?.offers?.approvalWorkflowId : null
  const workflows = config?.approvalWorkflows || []
  return (id && workflows.find(flow => flow.id === id)) || workflows.find(flow => flow.module === kind) || null
}
function amountFor(kind, record) {
  if (kind === 'requisitions') return Number(record.budget ?? record.salaryBand?.max ?? record.salaryBand ?? 0)
  if (kind === 'offers') return Number(record.amount ?? record.salary ?? record.baseSalary ?? 0)
  return Number(record.amount ?? record.fee ?? record.total ?? 0)
}
function normalizeSteps(workflow, record, config) {
  if (workflow?.steps?.length) return workflow.steps
  const roleIds = new Set((config?.roles || []).map(role => role.id))
  return (record.approvals || []).map(step => typeof step === 'string'
    ? (roleIds.has(step) ? { roleId: step } : { userId: step })
    : step)
}
function delegationIsActive(item, at = now()) {
  if (item.enabled === false || item.active === false) return false
  // Delegation settings use calendar dates. Treat both bounds as inclusive so
  // an end date remains valid throughout that day in the workspace's date.
  const today = String(at).slice(0, 10)
  for (const [field, comparison] of [['startsOn', (bound) => today >= bound], ['endsOn', (bound) => today <= bound]]) {
    const value = item[field]
    if (value == null || value === '') continue
    const bound = String(value).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bound) || !comparison(bound)) return false
  }
  return true
}
function stepAllows(step, actor, config, record, index) {
  if (step.userId && step.userId === actor.id) return true
  if (step.roleId && step.roleId === (actor.roleId || actor.role)) return true
  const delegations = config?.delegations || []
  return delegations.some(item => {
    if (!delegationIsActive(item)) return false
    const originalRole = item.roleId || item.fromRoleId || item.approverRoleId
    const delegateRole = item.delegateRoleId || item.toRoleId
    const originalUser = item.userId || item.approverUserId
    const delegateUser = item.delegateUserId || item.toUserId
    const matchesSource = (!originalRole || originalRole === step.roleId) && (!originalUser || originalUser === step.userId)
    const matchesActor = record?.delegatedApprovers?.[index] === actor.id ||
      (delegateRole && delegateRole === (actor.roleId || actor.role)) || (delegateUser && delegateUser === actor.id)
    return matchesSource && matchesActor
  })
}
function workflowApplies(workflow, kind, record, config) {
  if (!workflow) return false
  const threshold = Number(workflow.threshold)
  if (workflow.threshold != null && Number.isFinite(threshold) && amountFor(kind, record) < threshold) return false
  if (kind === 'offers' && config?.offers?.requireApproval === false) return false
  return true
}
function approvalOutcome(kind) { return kind === 'offers' ? 'sent' : 'approved' }
function approveRecord(store, kind, record, actionName, payload, context, audit) {
  if (actionName === 'approve' && record.status === approvalOutcome(kind)) return record
  if (record.status === 'rejected') throw new WorkflowError('This record has already been rejected.')
  const workflow = findApprovalWorkflow(context.config, kind, record)
  const steps = normalizeSteps(workflow, record, context.config)
  const completedBy = Array.isArray(record.approvalsCompleted) ? record.approvalsCompleted : []
  const completedSteps = Array.isArray(record.approvalStepIndexes) ? record.approvalStepIndexes : []
  const sequential = workflow?.sequential !== false
  const needed = workflowApplies(workflow, kind, record, context.config) ? steps : []

  if (!needed.length) {
    if (!workflow && !completedBy.length && !context.canApproveAny) throw new WorkflowError('No approval workflow is configured for this record.', 409)
    if (!context.canApproveAny && !hasRolePermission(context.user, kind, context.config)) throw new WorkflowError('Your role cannot approve this record.', 403)
    const status = actionName === 'reject' ? 'rejected' : approvalOutcome(kind)
    const updated = store.put(kind, { ...record, status, approvalsCompleted: completedBy.includes(context.user.id) ? completedBy : [...completedBy, context.user.id], approvedAt: actionName === 'approve' ? now() : undefined, rejectedBy: actionName === 'reject' ? context.user.id : undefined, rejectionReason: actionName === 'reject' ? (payload.reason || '') : undefined, workflowBypassed: Boolean(workflow && !steps.length || workflow && !workflowApplies(workflow, kind, record, context.config)) }, context.user.id)
    audit(`${kind.slice(0, -1)}.${actionName}`, payload)
    return updated
  }

  const pending = sequential
    ? [Math.min(completedSteps.length || completedBy.length, needed.length - 1)]
    : needed.map((_, index) => index).filter(index => !completedSteps.includes(index))
  const stepIndex = pending.find(index => stepAllows(needed[index], context.user, context.config, record, index))
  if (stepIndex === undefined) {
    if (actionName === 'reject' || actionName === 'approve') throw new WorkflowError(sequential ? 'This record is awaiting a different approver.' : 'Your role is not an approver for any pending step.', 403)
    throw new WorkflowError('This record is not awaiting a configured approver.')
  }

  if (actionName === 'delegate') {
    const target = (context.config?.users || []).find(user => user.id === payload.userId)
    const targetRole = target?.roleId || payload.roleId
    const currentStep = needed[stepIndex]
    const allowedDelegation = (context.config?.delegations || []).some(item => {
      if (!delegationIsActive(item)) return false
      const sourceRole = item.roleId || item.fromRoleId || item.approverRoleId
      const sourceUser = item.userId || item.approverUserId
      const delegateRole = item.delegateRoleId || item.toRoleId
      const delegateUser = item.delegateUserId || item.toUserId
      return (!sourceRole || sourceRole === currentStep.roleId) && (!sourceUser || sourceUser === currentStep.userId) &&
        ((delegateUser && delegateUser === target?.id) || (delegateRole && delegateRole === targetRole))
    })
    if (!target || !allowedDelegation) throw new WorkflowError('Choose a user permitted by the configured delegation rules.', 403)
    const updated = store.put(kind, { ...record, delegatedApprovers: { ...(record.delegatedApprovers || {}), [stepIndex]: target.id } }, context.user.id)
    audit(`${kind.slice(0, -1)}.delegated`, { stepIndex, userId: target.id })
    return updated
  }

  if (actionName === 'reject') {
    const updated = store.put(kind, { ...record, status: 'rejected', rejectedBy: context.user.id, rejectionReason: payload.reason || '', decisionAt: now() }, context.user.id)
    audit(`${kind.slice(0, -1)}.rejected`, { reason: payload.reason, stepIndex })
    return updated
  }

  const nextSteps = [...completedSteps, stepIndex]
  const nextActors = completedBy.includes(context.user.id) ? completedBy : [...completedBy, context.user.id]
  const complete = nextSteps.length >= needed.length
  const updated = store.put(kind, { ...record, approvalStepIndexes: nextSteps, approvalsCompleted: nextActors, status: complete ? approvalOutcome(kind) : (kind === 'offers' ? 'pending_approval' : 'pending'), ...(complete ? { approvedAt: now() } : {}), lastApprovalComment: payload.comment || '' }, context.user.id)
  audit(`${kind.slice(0, -1)}.approved`, { complete, stepIndex, workflowId: workflow?.id })
  return updated
}
function hasRolePermission(user, kind, config) {
  const role = (config?.roles || []).find(item => item.id === (user.roleId || user.role))
  return Boolean(role?.permissions?.['*']?.some(action => ['*', 'approve', 'administer'].includes(action)) || role?.permissions?.[kind]?.some(action => ['approve', 'administer', '*'].includes(action)))
}

function onboardingTasks(template) {
  return checklistFromTemplate(template)
}

function action(store, kind, record, actionName, payload = {}, context) {
  const actor = context.user.id
  const addAudit = (verb, details = {}) => context.audit(verb, kind, record.id, details)

  if (kind === 'requisitions' && ['approve', 'reject', 'delegate'].includes(actionName)) return approveRecord(store, kind, record, actionName, payload, context, addAudit)
  if (kind === 'offers' && ['approve', 'reject', 'delegate'].includes(actionName)) return approveRecord(store, kind, record, actionName, payload, context, addAudit)

  if (kind === 'requisitions' && actionName === 'create-job') {
    if (record.status !== 'approved') throw new WorkflowError('Only an approved hiring request can create a job.')
    if (record.jobId) return store.get('jobs', record.jobId)
    const job = store.put('jobs', { title: record.title, department: record.department, team: record.team, location: record.location, employmentType: record.employmentType || record.jobType, openings: record.headcount || 1, salaryBand: record.salaryBand, currency: record.currency, hiringManagerId: record.hiringManagerId, recruiterId: record.recruiterId, description: record.description || record.justification, status: 'draft', visibility: 'private', pipelineId: record.pipelineId, requisitionId: record.id, customFields: record.customFields || {} }, actor)
    store.put(kind, { ...record, jobId: job.id, status: 'converted' }, actor)
    addAudit('requisition.job-created', { jobId: job.id })
    return job
  }

  if (kind === 'applications' && actionName === 'move-stage') {
    const targetStage = payload.stage || payload.toStage
    const { target } = validateTransition(context.config, { ...record, __actorRole: context.user.roleId || context.user.role }, targetStage, store)
    const from = record.stage
    const changedAt = now()
    const canonicalTarget = stageKey(target)
    const history = normalizeStageHistory(record, changedAt)
    const openIndex = findOpenStage(history, from)
    if (openIndex >= 0) history[openIndex] = { ...history[openIndex], leftAt: changedAt }
    history.push({ stageId: canonicalTarget, enteredAt: changedAt, leftAt: null })
    const updated = store.put(kind, { ...record, stage: canonicalTarget, stageHistory: history, stageChangedAt: changedAt, status: 'active' }, actor)
    addAudit('application.stage-changed', { from, to: targetStage })
    context.emit('candidate.entered_stage', { ...updated, fromStage: from })
    return updated
  }

  if (kind === 'applications' && ['reject', 'withdraw'].includes(actionName)) {
    if (['hired', 'rejected', 'withdrawn'].includes(record.status)) throw new WorkflowError('This application has already been closed.')
    const status = actionName === 'reject' ? 'rejected' : 'withdrawn'
    const endedAt = now()
    const history = normalizeStageHistory(record, endedAt)
    const openIndex = findOpenStage(history, record.stage)
    if (openIndex >= 0) history[openIndex] = { ...history[openIndex], leftAt: endedAt }
    history.push({ stageId: status, enteredAt: endedAt, leftAt: null })
    const updated = store.put(kind, { ...record, stageHistory: history, status, endReason: payload.reason || null, endedAt }, actor)
    addAudit(`application.${status}`, { reason: payload.reason })
    return updated
  }

  if (kind === 'applications' && actionName === 'hire') {
    if (record.status === 'hired') return record
    if (['rejected', 'withdrawn'].includes(record.status)) throw new WorkflowError('A closed application cannot be hired.')
    validateTransition(context.config, { ...record, __actorRole: context.user.roleId || context.user.role }, payload.stage || 'hired', store)
    const hiredAt = now()
    const hiredStage = payload.stage || 'hired'
    const history = normalizeStageHistory(record, hiredAt)
    const openIndex = findOpenStage(history, record.stage)
    if (openIndex >= 0) history[openIndex] = { ...history[openIndex], leftAt: hiredAt }
    if (hiredStage !== record.stage) {
      history.push({ stageId: hiredStage, enteredAt: hiredAt, leftAt: null })
    }
    const application = store.put(kind, { ...record, stage: hiredStage, stageHistory: history, ...(hiredStage !== record.stage ? { stageChangedAt: hiredAt } : {}), status: 'hired', hiredAt }, actor)
    const candidate = store.get('candidates', record.candidateId)
    if (candidate && candidate.status !== 'hired') store.put('candidates', { ...candidate, status: 'hired' }, actor)
    const job = store.get('jobs', record.jobId)
    if (job) store.put('jobs', { ...job, filled: (job.filled || 0) + 1, status: (job.filled || 0) + 1 >= (job.openings || 1) ? 'filled' : job.status }, actor)
    const existing = store.list('onboarding').find(row => row.applicationId === application.id)
    const template = findOnboardingTemplate(context.config, payload, job)
    const ownerId = payload.ownerId || record.ownerId || actor
    const joiningDate = payload.joiningDate || null
    const checklist = existing ? existing.checklist : checklistFromTemplate(template, { joiningDate, ownerId })
    const onboarding = existing || store.put('onboarding', { applicationId: application.id, candidateId: application.candidateId, jobId: application.jobId, status: 'in_progress', joiningDate, templateId: template?.id || null, checklist, checklistSummary: summarizeChecklist({ checklist }), ownerId }, actor)
    addAudit('application.hired', { onboardingId: onboarding.id })
    context.emit('candidate.hired', application)
    return application
  }

  if (kind === 'interviews' && actionName === 'submit-feedback') {
    if (record.status === 'cancelled') throw new WorkflowError('Feedback cannot be submitted for a cancelled interview.')
    try {
      assertFeedbackSubmissionAvailable(store.list('feedback'), record.id, actor)
    } catch (error) {
      if (error instanceof ScorecardError) throw new WorkflowError(error.message, error.status)
      throw error
    }
    const job = record.jobId ? store.get('jobs', record.jobId) : null
    const roleId = record.roleId || job?.roleId || job?.jobRoleId
    const role = roleId ? (context.config?.roles || []).find(item => item.id === roleId) || { id: roleId } : null
    const template = resolveScorecard(context.config, record, { job, role })
    const plan = (context.config?.interviewPlans || []).find(item => item.id === (record.interviewPlanId || record.planId))
    const round = plan?.rounds?.find(item => item.id === (record.roundId || record.round))
    const configuredScorecardId = record.scorecardId || round?.scorecardId || record.jobScorecardId || job?.scorecardId || job?.interviewScorecardId || record.roleScorecardId || role?.scorecardId || role?.interviewScorecardId
    if (configuredScorecardId && !template) {
      throw new WorkflowError('The configured interview scorecard could not be found.', 422)
    }
    let evaluation
    try {
      evaluation = evaluateScorecard(template, payload, { interviewerId: actor })
    } catch (error) {
      if (error instanceof ScorecardError) throw new WorkflowError(error.message, error.status)
      throw error
    }
    const feedback = store.put('feedback', { interviewId: record.id, applicationId: record.applicationId, candidateId: record.candidateId, jobId: record.jobId || job?.id || null, interviewerId: actor, scorecardId: template?.id || record.scorecardId || null, answers: evaluation.answers, weightedScore: evaluation.weightedScore, recommendation: evaluation.recommendation, comments: evaluation.comments, status: 'submitted', submittedAt: now(), lockedAt: now() }, actor)
    const updated = store.put(kind, { ...record, feedbackIds: [...(record.feedbackIds || []), feedback.id], status: payload.completeInterview ? 'completed' : record.status }, actor)
    addAudit('interview.feedback-submitted', { feedbackId: feedback.id, weightedScore: evaluation.weightedScore })
    context.emit('interview.feedback_submitted', feedback)
    return updated
  }

  if (kind === 'interviews' && ['cancel', 'reschedule'].includes(actionName)) {
    if (record.status === 'completed' || record.status === 'cancelled') throw new WorkflowError('This interview is already closed.')
    const allowed = actionName === 'cancel' ? new Set(['reason']) : new Set(['scheduledAt', 'startAt', 'startsAt', 'timezone', 'timeZone', 'type', 'interviewType', 'durationMinutes', 'duration', 'interviewerId', 'interviewerIds', 'panel', 'panelId', 'roomId'])
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(field => !allowed.has(field))) {
      throw new WorkflowError(actionName === 'cancel' ? 'Cancellation accepts only a reason.' : 'Rescheduling accepts only interview schedule fields.', 400)
    }
    let updated
    if (actionName === 'cancel') {
      const at = now()
      const cancelled = { ...record, status: 'cancelled', cancelledReason: payload.reason || null }
      if (record.calendarEvent) cancelled.calendarEvent = transitionMockCalendarEvent(record.calendarEvent, 'cancel', record, { now: at })
      updated = store.put(kind, cancelled, actor)
    } else {
      let schedule
      try {
        const config = { ...context.config, interviewTypes: context.config?.interviewTypes || context.config?.interviews?.types || [] }
        schedule = validateInterviewSchedule({
          ...record,
          ...payload,
          startAt: payload.startAt ?? payload.startsAt ?? payload.scheduledAt ?? record.startAt ?? record.scheduledAt,
          type: payload.type ?? payload.interviewType ?? record.type,
          durationMinutes: payload.durationMinutes ?? payload.duration ?? record.durationMinutes,
          timeZone: payload.timeZone ?? payload.timezone ?? record.timeZone ?? record.timezone,
        }, config)
      } catch (error) {
        if (error instanceof InterviewCalendarError) throw new WorkflowError(error.message, error.status)
        throw error
      }
      const panelIds = Array.isArray(payload.interviewerIds) ? payload.interviewerIds : (Array.isArray(payload.panel) ? payload.panel : record.interviewerIds || record.panel || [])
      const interviewers = [...new Set([...panelIds, payload.interviewerId ?? record.interviewerId].filter(Boolean).map(value => typeof value === 'object' ? value.id || value.userId : value).filter(Boolean).map(String))]
      const candidate = { ...record, ...schedule, scheduledAt: schedule.startAt, interviewerIds: interviewers, status: 'scheduled' }
      const active = store.list('interviews').filter(item => ['scheduled', 'in_progress', 'active'].includes(String(item.status || 'scheduled').toLowerCase())).map(item => ({ ...item, startAt: item.startAt || item.scheduledAt, interviewerIds: item.interviewerIds || (Array.isArray(item.panel) ? item.panel : []) }))
      if (findInterviewConflict(active, candidate, record.id)) throw new WorkflowError('Interview schedule conflicts with another booking for the interviewer or room.', 409)
      const at = now()
      if (record.calendarEvent) {
        const cancelledOccurrence = transitionMockCalendarEvent(record.calendarEvent, 'cancel', record, { now: at })
        candidate.calendarEventHistory = [...(record.calendarEventHistory || []), { ...cancelledOccurrence, occurrenceId: `${cancelledOccurrence.id}:${cancelledOccurrence.startAt}` }]
        candidate.calendarEvent = createMockCalendarEvent(candidate, { workspaceId: context.config?.workspaceId || context.config?.company?.id || 'workspace', now: at })
        candidate.calendarEvent.rescheduledAt = at
      } else candidate.calendarEvent = createMockCalendarEvent(candidate, { workspaceId: context.config?.workspaceId || context.config?.company?.id || 'workspace', now: at })
      candidate.rescheduledAt = at
      updated = store.put(kind, candidate, actor)
    }
    addAudit(`interview.${actionName}`, payload)
    return updated
  }

  if (kind === 'offers' && ['accept', 'decline', 'withdraw'].includes(actionName)) {
    if (actionName === 'accept' && record.status !== 'sent') throw new WorkflowError('Only a sent offer can be accepted.')
    if (actionName !== 'accept' && !['draft', 'pending_approval', 'sent'].includes(record.status)) throw new WorkflowError('This offer is no longer open.')
    const status = { accept: 'accepted', decline: 'declined', withdraw: 'withdrawn' }[actionName]
    if (actionName === 'accept' && store.list('onboarding').some(row => row.offerId === record.id)) throw new WorkflowError('Onboarding has already been started for this offer.')
    const updated = store.put(kind, { ...record, status, ...(actionName === 'accept' ? { acceptedAt: now() } : { [`${actionName === 'decline' ? 'declined' : 'withdrawn'}At`]: now() }) }, actor)
    if (actionName === 'accept') {
      const application = record.applicationId && store.get('applications', record.applicationId)
      const job = record.jobId && store.get('jobs', record.jobId)
      const template = findOnboardingTemplate(context.config, payload, job, record)
      const ownerId = payload.ownerId || record.ownerId || actor
      const joiningDate = payload.joiningDate || record.joiningDate || null
      const checklist = checklistFromTemplate(template, { joiningDate, ownerId })
      const onboarding = store.put('onboarding', { offerId: record.id, applicationId: record.applicationId || null, candidateId: record.candidateId || application?.candidateId || null, jobId: record.jobId || application?.jobId || null, status: 'in_progress', joiningDate, templateId: template?.id || null, checklist, checklistSummary: summarizeChecklist({ checklist }), ownerId }, actor)
      addAudit('offer.accepted', { onboardingId: onboarding.id, templateId: template?.id || null })
      context.emit('offer.accepted', updated)
    } else addAudit(`offer.${status}`)
    return updated
  }

  if (kind === 'submissions' && actionName === 'place') {
    if (record.placementId) return store.get('placements', record.placementId)
    if (!['submitted', 'shortlisted', 'selected', 'interview'].includes(record.status)) throw new WorkflowError('Only an active client submission can become a placement.')
    const candidate = store.get('candidates', record.candidateId), job = store.get('jobs', record.jobId)
    if (!candidate || !job) throw new WorkflowError('Submission must reference an existing candidate and mandate.', 422)
    const days = Number(context.config?.agency?.defaultGuaranteeDays || 0)
    const startDate = payload.startDate || record.startDate || null
    const guaranteeExpiry = payload.guaranteeExpiry || (days && startDate ? addDays(startDate, days) : days ? addDays(new Date().toISOString().slice(0, 10), days) : null)
    const placement = store.put('placements', { submissionId: record.id, clientId: record.clientId, candidateId: record.candidateId, jobId: record.jobId, ownerId: record.ownerId || actor, status: 'placed', placedAt: now(), startDate, fee: payload.fee ?? record.fee ?? null, feeType: payload.feeType || record.feeType || 'fixed', currency: payload.currency || context.config?.regional?.currency || 'USD', guaranteeDays: payload.guaranteeDays || days || null, guaranteeExpiry }, actor)
    store.put(kind, { ...record, status: 'placed', placementId: placement.id }, actor)
    addAudit('submission.placed', { placementId: placement.id })
    return placement
  }

  if (kind === 'placements' && actionName === 'invoice') {
    const existing = record.invoiceId && store.get('invoices', record.invoiceId)
    if (existing) return existing
    const amount = Number(record.fee ?? record.placementFee ?? payload.amount)
    if (!Number.isFinite(amount) || amount < 0) throw new WorkflowError('Placement must have a non-negative fee before invoicing.', 422)
    const invoice = store.put('invoices', { placementId: record.id, clientId: record.clientId, amount, currency: record.currency || context.config?.regional?.currency || 'USD', status: 'draft', issuedAt: now(), dueAt: payload.dueDate || null }, actor)
    store.put(kind, { ...record, invoiceId: invoice.id }, actor)
    addAudit('placement.invoiced', { invoiceId: invoice.id })
    return invoice
  }

  if (kind === 'invoices' && ['approve', 'reject', 'delegate'].includes(actionName)) return approveRecord(store, kind, record, actionName, payload, context, addAudit)
  if (kind === 'invoices' && actionName === 'mark-paid') {
    if (record.status === 'paid') return record
    if (record.status === 'void' || record.status === 'cancelled') throw new WorkflowError('A cancelled invoice cannot be marked paid.')
    const updated = store.put(kind, { ...record, status: 'paid', paidAt: now(), paymentReference: payload.reference || record.paymentReference || null }, actor)
    addAudit('invoice.paid', { reference: payload.reference || null })
    return updated
  }

  if (kind === 'candidates' && actionName === 'merge') {
    const target = store.get('candidates', payload.targetId)
    if (!target || target.id === record.id) throw new WorkflowError('Choose a different existing candidate to merge into.', 422)
    for (const application of store.list('applications').filter(row => row.candidateId === record.id)) store.put('applications', { ...application, candidateId: target.id }, actor)
    const merged = store.put('candidates', { ...target, skills: [...new Set([...(target.skills || []), ...(record.skills || [])])], alternateEmails: [...new Set([...(target.alternateEmails || []), record.email].filter(Boolean))], mergedFrom: [...(target.mergedFrom || []), record.id] }, actor)
    store.archive('candidates', record.id); addAudit('candidate.merged', { targetId: target.id }); return merged
  }
  if ((kind === 'candidates' || kind === 'clients') && actionName === 'archive') { const archived = store.archive(kind, record.id); addAudit(`${kind.slice(0, -1)}.archived`); return archived }
  if (kind === 'candidates' && actionName === 'add-note') {
    const note = store.put('notes', { candidateId: record.id, body: payload.body, visibility: payload.visibility || 'team', authorId: actor, mentions: payload.mentions || [] }, actor)
    addAudit('candidate.note-added', { noteId: note.id }); return note
  }
  if (kind === 'approvals' && ['approve', 'reject', 'delegate'].includes(actionName)) {
    if (record.status !== 'pending') throw new WorkflowError('This approval is no longer pending.')
    const delegatedTo = actionName === 'delegate' ? (payload.userId || payload.delegateUserId) : record.delegatedTo
    if (actionName === 'delegate' && !(context.config?.users || []).some(user => user.id === delegatedTo)) throw new WorkflowError('Choose a configured user to delegate this approval to.', 422)
    const status = actionName === 'approve' ? 'approved' : actionName === 'reject' ? 'rejected' : 'pending'
    const updated = store.put(kind, { ...record, status, decidedBy: actionName === 'delegate' ? undefined : actor, delegatedTo, comment: payload.comment || record.comment, decidedAt: actionName === 'delegate' ? undefined : now() }, actor)
    addAudit(`approval.${actionName}`, payload); return updated
  }

  if (kind === 'feedback' && actionName === 'submit') {
    if (record.status === 'submitted' || record.lockedAt) throw new WorkflowError('Submitted feedback is locked and cannot be changed.')
    const updated = store.put(kind, { ...record, ...payload, status: 'submitted', submittedAt: now(), lockedAt: now() }, actor)
    addAudit('feedback.submitted'); return updated
  }
  if (kind === 'onboarding' && actionName === 'checklist-item') {
    try {
      const template = (context.config?.onboardingTemplates || []).find(item => item.id === record.templateId)
      const updated = store.put(kind, transitionChecklistItem(record, payload, { template }), actor)
      addAudit('onboarding.checklist-item-updated', { itemId: payload.itemId, status: payload.status })
      return updated
    } catch (error) {
      if (error instanceof OnboardingChecklistError) throw new WorkflowError(error.message, error.status)
      throw error
    }
  }
  if (kind === 'onboarding' && ['start', 'complete'].includes(actionName)) {
    if (actionName === 'start' && !['planned', 'draft'].includes(record.status)) throw new WorkflowError('This onboarding plan has already started.')
    if (actionName === 'complete' && record.status === 'completed') return record
    let updatedRecord = { ...record, ...(actionName === 'start' ? { status: 'in_progress', startedAt: now() } : {}) }
    if (actionName === 'complete') {
      try { updatedRecord = completeOnboarding(record) }
      catch (error) {
        if (error instanceof OnboardingChecklistError) throw new WorkflowError(error.message, error.status)
        throw error
      }
    }
    const updated = store.put(kind, updatedRecord, actor)
    addAudit(`onboarding.${actionName}`); return updated
  }
  if (kind === 'tasks' && ['complete', 'reopen'].includes(actionName)) {
    const updated = store.put(kind, { ...record, status: actionName === 'complete' ? 'done' : 'open', ...(actionName === 'complete' ? { completedAt: now() } : { completedAt: null }) }, actor)
    addAudit(`task.${actionName}`); return updated
  }
  if (kind === 'notifications' && actionName === 'mark-read') {
    if (record.userId && record.userId !== actor) throw new WorkflowError('You can only update your own notifications.', 403)
    const updated = store.put(kind, { ...record, read: true, readAt: now() }, actor)
    addAudit('notification.read'); return updated
  }
  if (kind === 'submissions' && ['submit', 'withdraw'].includes(actionName)) {
    if (actionName === 'submit' && !['draft', 'sourced'].includes(record.status)) throw new WorkflowError('Only a draft submission can be submitted.')
    if (actionName === 'withdraw' && ['placed', 'withdrawn'].includes(record.status)) throw new WorkflowError('This submission cannot be withdrawn in its current state.')
    const updated = store.put(kind, { ...record, status: actionName === 'submit' ? 'submitted' : 'withdrawn', ...(actionName === 'submit' ? { submittedAt: now() } : { withdrawnAt: now(), withdrawalReason: payload.reason || null }) }, actor)
    addAudit(`submission.${actionName}`); return updated
  }
  if (kind === 'placements' && actionName === 'complete') {
    const updated = store.put(kind, { ...record, status: 'completed', completedAt: now() }, actor)
    addAudit('placement.completed'); return updated
  }
  if (kind === 'referrals' && actionName === 'advance') {
    const statuses = context.config?.pipelines?.find(p => p.category === 'referral')?.stages || []
    const current = statuses.findIndex(stage => [stage.id, stage.name].includes(record.status))
    const next = statuses[current + 1]
    if (!next) throw new WorkflowError('This referral is already at its final configured stage.')
    const updated = store.put(kind, { ...record, status: stageKey(next), stageChangedAt: now() }, actor)
    addAudit('referral.advanced', { from: record.status, to: stageKey(next) }); return updated
  }
  if (kind === 'outbox' && actionName === 'send') {
    if (record.status === 'sent') return record
    const updated = store.put(kind, { ...record, status: 'sent', sentAt: now(), deliveryMode: 'mock' }, actor)
    addAudit('outbox.sent', { deliveryMode: 'mock' }); return updated
  }
  if (kind === 'invoices' && actionName === 'download') {
    const updated = store.put(kind, { ...record, lastDownloadedAt: now() }, actor)
    addAudit('invoice.downloaded'); return updated
  }

  throw new WorkflowError(`Action “${actionName}” is not supported for ${kind}.`, 422)
}

function findOnboardingTemplate(config, payload = {}, job = {}, offer = {}) {
  const id = payload.templateId || offer.onboardingTemplateId || job?.onboardingTemplateId || config?.offers?.onboardingTemplateId || config?.onboarding?.templateId
  return (config?.onboardingTemplates || []).find(item => item.id === id) || (config?.onboardingTemplates || [])[0] || null
}
function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  parsed.setUTCDate(parsed.getUTCDate() + Number(days))
  return parsed.toISOString().slice(0, 10)
}

function normalizeStageHistory(record, fallbackAt) {
  const existing = Array.isArray(record.stageHistory) ? record.stageHistory : Array.isArray(record.stageChanges) ? record.stageChanges : []
  const history = existing.map(entry => {
    if (typeof entry === 'string') return { stageId: entry, enteredAt: null, leftAt: null }
    if (!entry || typeof entry !== 'object') return null
    const stageId = entry.stageId || entry.stage || entry.to
    if (!stageId) return null
    return { ...entry, stageId, enteredAt: entry.enteredAt || entry.at || null, leftAt: entry.leftAt || null }
  }).filter(Boolean)

  // Seed an initial stage visit when older records have no history. The
  // application creation timestamp is the best factual start time available.
  if (!history.length && record.stage) {
    history.push({ stageId: record.stage, enteredAt: record.createdAt || record.stageEnteredAt || null, leftAt: null })
  } else if (record.stage && findOpenStage(history, record.stage) < 0) {
    history.push({ stageId: record.stage, enteredAt: record.stageChangedAt || fallbackAt || null, leftAt: null })
  }
  return history
}

function findOpenStage(history, stage) {
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].stageId === stage && !history[index].leftAt) return index
  }
  return -1
}

module.exports = { WorkflowError, action, validateTransition, findPipeline, stageList, normalizeStageHistory }
