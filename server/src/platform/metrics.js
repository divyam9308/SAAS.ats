'use strict'

const DAY_MS = 86400000
const TERMINAL_APPLICATION_STATUSES = new Set(['hired', 'rejected', 'withdrawn'])

function dateValue(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

function daysBetween(start, end) {
  const from = dateValue(start), to = dateValue(end)
  return from == null || to == null || to < from ? null : (to - from) / DAY_MS
}

function mean(values) { return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null }
function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
function round(value, places = 1) { return value == null ? null : Number(value.toFixed(places)) }
function percentage(numerator, denominator) { return denominator ? round((numerator / denominator) * 100) : null }
function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = key(row)
    if (value == null || value === '') return result
    const label = String(value)
    result[label] = (result[label] || 0) + 1
    return result
  }, {})
}
function normalizeKindRows(recordsByKind, kind) { return Array.isArray(recordsByKind?.[kind]) ? recordsByKind[kind] : [] }
function roleScopeFor(actor, config) { return config?.roles?.find(role => role.id === (actor?.roleId || actor?.role))?.scope || actor?.scope || 'all' }
function recordInActorScope(kind, row, actor, config, recordsByKind) {
  if (!actor?.id) return true
  const scope = roleScopeFor(actor, config)
  if (!['owned', 'assigned', 'department', 'location'].includes(scope)) return true
  const job = row.jobId ? normalizeKindRows(recordsByKind, 'jobs').find(item => item.id === row.jobId) || {} : {}
  if (scope === 'owned' || scope === 'assigned') {
    const ownerKeys = [row.ownerId, row.recruiterId, row.hiringManagerId, row.userId, row.assignedTo, row.createdBy, job.ownerId, job.recruiterId, job.hiringManagerId]
    if (ownerKeys.includes(actor.id)) return true
    if (kind === 'candidates') return normalizeKindRows(recordsByKind, 'applications').some(app => {
      if (app.candidateId !== row.id) return false
      const linkedJob = normalizeKindRows(recordsByKind, 'jobs').find(item => item.id === app.jobId) || {}
      return [app.ownerId, app.recruiterId, linkedJob.ownerId, linkedJob.recruiterId, linkedJob.hiringManagerId].includes(actor.id)
    })
    return false
  }
  if (scope === 'department') return [row.departmentId, row.department, job.departmentId, job.department].some(value => value && [actor.departmentId, actor.department].includes(value))
  if (scope === 'location') return [row.locationId, row.location, job.locationId, job.location].some(value => value && [actor.locationId, actor.location].includes(value))
  return true
}
function applicationIsInScope(application, jobsById, actor, scopeRecord, config, recordsByKind) {
  if (!recordInActorScope('applications', application, actor, config, recordsByKind)) return false
  if (scopeRecord && !scopeRecord('applications', application, actor)) return false
  const roleScope = roleScopeFor(actor, config)
  const job = jobsById.get(application.jobId) || {}
  if (roleScope === 'owned' || roleScope === 'assigned') return [application.ownerId, application.recruiterId, application.hiringManagerId, job.ownerId, job.recruiterId, job.hiringManagerId].includes(actor.id)
  if (roleScope === 'department') return [application.departmentId, application.department, job.departmentId, job.department].some(value => value && [actor.departmentId, actor.department].includes(value))
  if (roleScope === 'location') return [application.locationId, application.location, job.locationId, job.location].some(value => value && [actor.locationId, actor.location].includes(value))
  return true
}
function recordsFor(recordsByKind, kind, actor, config, scopeRecord) {
  const rows = normalizeKindRows(recordsByKind, kind)
  return rows.filter(row => recordInActorScope(kind, row, actor, config, recordsByKind) && (!scopeRecord || scopeRecord(kind, row, actor)))
}
function stageLabel(pipeline, stageId) {
  const stage = pipeline?.stages?.find(item => (item.id || item.key || item.name) === stageId || item.name === stageId)
  return stage?.name || stage?.label || stage?.id || stageId || 'Unknown'
}
function stageHistoryValue(entry) { return typeof entry === 'string' ? entry : entry?.stageId || entry?.stage || entry?.to || null }
function stageHistory(record) {
  const history = Array.isArray(record.stageHistory) ? record.stageHistory : Array.isArray(record.stageChanges) ? record.stageChanges : []
  return history.map(entry => {
    if (typeof entry === 'string') return { stageId: entry, enteredAt: null, leftAt: null }
    if (!entry || typeof entry !== 'object') return null
    const stageId = stageHistoryValue(entry)
    return stageId ? { ...entry, stageId, enteredAt: entry.enteredAt || entry.at || null, leftAt: entry.leftAt || null } : null
  }).filter(Boolean)
}
function historyTransitions(record) {
  const history = stageHistory(record)
  return history.slice(1).map((entry, index) => ({ from: history[index].stageId, to: entry.stageId, at: entry.enteredAt || null }))
}
function periodFor(value) {
  const timestamp = dateValue(value)
  if (timestamp == null) return null
  const date = new Date(timestamp)
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  return `${date.getUTCFullYear()}-Q${quarter}`
}

/**
 * Build report metrics from stored ATS records. `recordsByKind` should contain live
 * `store.list(kind)` rows. Supply `scopeRecord(kind,row,actor)` from the platform
 * router's authorization-aware readable predicate; the built-in scope guard is a
 * conservative fallback for owned/department/location actors.
 */
function computePlatformMetrics({ recordsByKind = {}, config = {}, actor = null, nowValue = new Date(), scopeRecord } = {}) {
  const jobs = recordsFor(recordsByKind, 'jobs', actor, config, scopeRecord)
  const jobById = new Map(jobs.map(job => [job.id, job]))
  const applications = recordsFor(recordsByKind, 'applications', actor, config, scopeRecord).filter(app => applicationIsInScope(app, jobById, actor, scopeRecord, config, recordsByKind))
  const candidates = recordsFor(recordsByKind, 'candidates', actor, config, scopeRecord)
  const offers = recordsFor(recordsByKind, 'offers', actor, config, scopeRecord)
  const interviews = recordsFor(recordsByKind, 'interviews', actor, config, scopeRecord)
  const tasks = recordsFor(recordsByKind, 'tasks', actor, config, scopeRecord)
  const placements = recordsFor(recordsByKind, 'placements', actor, config, scopeRecord)
  const referrals = recordsFor(recordsByKind, 'referrals', actor, config, scopeRecord)
  const targets = recordsFor(recordsByKind, 'workforceTargets', actor, config, scopeRecord)
  const activeApplications = applications.filter(app => !TERMINAL_APPLICATION_STATUSES.has(app.status))
  const hiredApplications = applications.filter(app => app.status === 'hired')
  const timeToHire = hiredApplications.map(app => daysBetween(app.createdAt, app.hiredAt)).filter(value => value != null)
  const fillDurations = jobs.filter(job => job.status === 'filled' && (job.filledAt || job.closedAt)).map(job => daysBetween(job.createdAt, job.filledAt || job.closedAt)).filter(value => value != null)

  const pipelines = (config.pipelines || []).map(pipeline => {
    const rows = applications.filter(app => (app.pipelineId || jobById.get(app.jobId)?.pipelineId || (config.pipelines || []).find(item => item.default)?.id) === pipeline.id)
    const counts = Object.fromEntries((pipeline.stages || []).map(stage => [stage.id || stage.key || stage.name, 0]))
    for (const app of rows) if (Object.hasOwn(counts, app.stage)) counts[app.stage]++
    const conversions = (pipeline.stages || []).slice(0, -1).map((stage, index) => {
      const from = stage.id || stage.key || stage.name
      const nextStage = pipeline.stages[index + 1]
      const to = nextStage.id || nextStage.key || nextStage.name
      const historyRows = rows.filter(app => stageHistory(app).length > 0)
      const stageEntries = historyRows.flatMap(app => stageHistory(app).map((entry, entryIndex) => ({ app, entry, entryIndex }))).filter(item => item.entry.stageId === from)
      const reachedTo = historyRows.flatMap(app => historyTransitions(app)).filter(transition => transition.from === from && transition.to === to).length
      return { from, fromLabel: stageLabel(pipeline, from), to, toLabel: stageLabel(pipeline, to), currentAtFrom: rows.filter(app => app.stage === from).length, observedEntriesFrom: stageEntries.length, applicationsWithStageHistory: historyRows.length, convertedToNext: reachedTo, conversionRatePercent: percentage(reachedTo, stageEntries.length) }
    })
    const terminalCount = rows.filter(app => ['rejected', 'withdrawn'].includes(app.status) || ['rejected', 'withdrawn'].includes(app.stage)).length
    const historyRows = rows.filter(app => Array.isArray(app.stageHistory || app.stageChanges))
    const observedTerminal = historyRows.flatMap(app => historyTransitions(app)).filter(transition => ['rejected', 'withdrawn'].includes(transition.to)).length
    const stageIds = new Set([
      ...(pipeline.stages || []).map(stage => stage.id || stage.key || stage.name),
      ...rows.filter(app => app.stage).map(app => app.stage),
    ])
    const ageByStage = [...stageIds].filter(Boolean).map(stage => {
      const count = rows.filter(app => app.stage === stage).length
      const values = rows.filter(app => app.stage === stage).map(app => {
        const currentHistory = stageHistory(app).filter(entry => entry.stageId === stage).at(-1)
        const enteredAt = currentHistory?.enteredAt || app.stageChangedAt || app.stageEnteredAt || app.createdAt
        return daysBetween(enteredAt, nowValue)
      }).filter(value => value != null)
      const completedValues = rows.flatMap(app => stageHistory(app).filter(entry => entry.stageId === stage && entry.leftAt).map(entry => daysBetween(entry.enteredAt, entry.leftAt))).filter(value => value != null)
      return { stage, label: stageLabel(pipeline, stage), currentCount: count, currentAverageDays: round(mean(values)), currentMedianDays: round(median(values)), completedVisits: completedValues.length, completedAverageDays: round(mean(completedValues)), completedMedianDays: round(median(completedValues)) }
    })
    return { id: pipeline.id, name: pipeline.name, applications: rows.length, stageCounts: counts, conversions, dropOff: { currentTerminalRejectedOrWithdrawn: terminalCount, currentSharePercent: percentage(terminalCount, rows.length), observedHistoryCount: historyRows.length, recordedTerminalTransitions: observedTerminal, recordedDropOffPercent: percentage(observedTerminal, historyRows.length) }, stageAge: ageByStage }
  })

  const applicationSources = applications.map(app => ({ ...app, metricSource: app.source || candidates.find(candidate => candidate.id === app.candidateId)?.source || 'Unattributed' }))
  const sourceRows = Object.entries(countBy(applicationSources, app => app.metricSource)).map(([source, count]) => {
    const matching = applicationSources.filter(app => app.metricSource === source)
    return { source, applications: count, hires: matching.filter(app => app.status === 'hired').length, hireRatePercent: percentage(matching.filter(app => app.status === 'hired').length, count) }
  })
  const referralApps = applicationSources.filter(app => /referr/i.test(app.metricSource))
  const acceptedOffers = offers.filter(offer => offer.status === 'accepted')
  const completedInterviews = interviews.filter(interview => interview.status === 'completed')
  const scheduledInterviews = interviews.filter(interview => interview.status === 'scheduled')
  const workloads = new Map()
  const addLoad = (ownerId, field) => {
    if (!ownerId) return
    const row = workloads.get(ownerId) || { ownerId, applications: 0, jobs: 0, interviews: 0, openTasks: 0 }
    row[field]++
    workloads.set(ownerId, row)
  }
  applications.forEach(app => addLoad(app.ownerId || app.recruiterId || jobById.get(app.jobId)?.recruiterId, 'applications'))
  jobs.forEach(job => addLoad(job.recruiterId || job.ownerId, 'jobs'))
  interviews.forEach(interview => addLoad(interview.ownerId || interview.organizerId, 'interviews'))
  tasks.filter(task => !['done', 'completed', 'cancelled'].includes(task.status)).forEach(task => addLoad(task.ownerId || task.assignedTo, 'openTasks'))

  const groupDimensions = field => {
    const keys = new Set()
    const result = new Map()
    applications.forEach(app => {
      const job = jobById.get(app.jobId) || {}
      const value = app[field] || job[field]
      if (!value) return
      keys.add(String(value))
      const row = result.get(String(value)) || { name: String(value), applications: 0, hires: 0, openJobs: 0 }
      row.applications++
      if (app.status === 'hired') row.hires++
      result.set(String(value), row)
    })
    jobs.forEach(job => {
      const value = job[field]
      if (!value) return
      const key = String(value)
      const row = result.get(key) || { name: key, applications: 0, hires: 0, openJobs: 0 }
      if (job.status === 'open') row.openJobs++
      result.set(key, row)
    })
    return [...result.values()].map(row => ({ ...row, hireRatePercent: percentage(row.hires, row.applications) })).sort((a, b) => a.name.localeCompare(b.name))
  }
  const targetMetrics = targets.map(target => {
    const targetHires = hiredApplications.filter(app => {
      const job = jobById.get(app.jobId) || {}
      return periodFor(app.hiredAt) === target.period && (!target.department && !target.departmentId || [target.department, target.departmentId].includes(job.departmentId || job.department)) && (!target.location && !target.locationId || [target.location, target.locationId].includes(job.locationId || job.location))
    }).length
    const goal = Number(target.target)
    return { id: target.id, period: target.period, department: target.department || target.departmentId || null, location: target.location || target.locationId || null, target: Number.isFinite(goal) ? goal : null, actualHires: targetHires, attainmentPercent: Number.isFinite(goal) && goal > 0 ? percentage(targetHires, goal) : null }
  })
  const stageAges = pipelines.flatMap(pipeline => pipeline.stageAge)
  const ages = activeApplications.map(app => daysBetween(app.stageChangedAt || app.stageEnteredAt || app.updatedAt || app.createdAt, nowValue)).filter(value => value != null)
  const agencyFees = placements.map(placement => Number(placement.fee ?? placement.placementFee)).filter(Number.isFinite)
  const nowTimestamp = dateValue(nowValue)

  return {
    generatedAt: nowTimestamp == null ? new Date().toISOString() : new Date(nowTimestamp).toISOString(),
    openJobs: jobs.filter(job => job.status === 'open').length,
    jobs: { total: jobs.length, open: jobs.filter(job => job.status === 'open').length, filled: jobs.filter(job => job.status === 'filled').length, draft: jobs.filter(job => job.status === 'draft').length },
    applications: { total: applications.length, active: activeApplications.length, hired: hiredApplications.length, rejected: applications.filter(app => app.status === 'rejected').length, withdrawn: applications.filter(app => app.status === 'withdrawn').length },
    hires: hiredApplications.length,
    pipeline: { pipelines, averageActiveStageAgeDays: round(mean(ages)), stageAge: stageAges },
    timeToHire: { count: timeToHire.length, averageDays: round(mean(timeToHire)), medianDays: round(median(timeToHire)) },
    timeToFill: { count: fillDurations.length, averageDays: round(mean(fillDurations)), medianDays: round(median(fillDurations)) },
    sources: sourceRows,
    referrals: { applications: referralApps.length, hires: referralApps.filter(app => app.status === 'hired').length, registeredReferrals: referrals.length, hireRatePercent: percentage(referralApps.filter(app => app.status === 'hired').length, referralApps.length) },
    offers: { total: offers.length, accepted: acceptedOffers.length, pending: offers.filter(offer => ['draft', 'pending_approval', 'sent'].includes(offer.status)).length, declined: offers.filter(offer => ['declined', 'rejected'].includes(offer.status)).length, acceptanceRatePercent: percentage(acceptedOffers.length, offers.filter(offer => ['accepted', 'declined', 'rejected'].includes(offer.status)).length) },
    interviews: { total: interviews.length, scheduled: scheduledInterviews.length, completed: completedInterviews.length, cancelled: interviews.filter(interview => interview.status === 'cancelled').length, completionRatePercent: percentage(completedInterviews.length, interviews.filter(interview => ['completed', 'cancelled'].includes(interview.status)).length) },
    workload: [...workloads.values()].sort((a, b) => a.ownerId.localeCompare(b.ownerId)),
    departments: groupDimensions('department'),
    locations: groupDimensions('location'),
    agency: { placements: placements.length, fees: round(agencyFees.reduce((sum, amount) => sum + amount, 0), 2), invoices: recordsFor(recordsByKind, 'invoices', actor, config, scopeRecord).length, submissions: recordsFor(recordsByKind, 'submissions', actor, config, scopeRecord).length },
    workforceTargets: targetMetrics,
  }
}

module.exports = { computePlatformMetrics, daysBetween, percentage, mean, median, periodFor }
