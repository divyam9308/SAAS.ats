'use strict'

function rowsFor(recordsByKind, kind) {
  return Array.isArray(recordsByKind?.[kind]) ? recordsByKind[kind] : []
}

function validDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function localParts(value, timeZone) {
  const date = validDate(value)
  if (!date) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date)
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  } catch { return null }
}

function periodFor(value, period, timeZone) {
  const parts = localParts(value, timeZone)
  if (!parts) return null
  const year = Number(parts.year), month = Number(parts.month)
  if (/^\d{4}-Q[1-4]$/.test(String(period))) return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  if (/^\d{4}-\d{2}$/.test(String(period))) return `${parts.year}-${parts.month}`
  if (/^\d{4}$/.test(String(period))) return parts.year
  return null
}

function dimension(target, singular, idField) {
  return target[singular] ?? target[idField] ?? null
}

function matchesDimension(targetValue, actualValue) {
  return targetValue == null || targetValue === '' || String(targetValue) === String(actualValue ?? '')
}

function targetValue(target) {
  const value = Number(target.target ?? target.headcount)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function round(value, places = 1) { return value == null ? null : Number(value.toFixed(places)) }

/**
 * Compare persisted workforce targets with dated persisted outcomes. `recordsByKind`
 * contains already-authorized visible rows; filtering and duplicate-target policy
 * belong to the caller. Agency workspaces count placements, corporate workspaces
 * count hired applications. Undated outcomes and unsupported target periods are
 * deliberately omitted rather than estimated.
 */
function buildWorkforcePlan({ recordsByKind = {}, config = {}, now = new Date() } = {}) {
  const timeZone = config?.regional?.timeZone || config?.regional?.timezone || config?.company?.timezone || 'UTC'
  const jobs = rowsFor(recordsByKind, 'jobs')
  const jobsById = new Map(jobs.map(job => [job.id, job]))
  const targets = rowsFor(recordsByKind, 'workforceTargets').map(target => ({
    id: target.id || null,
    period: target.period || null,
    department: dimension(target, 'department', 'departmentId'),
    location: dimension(target, 'location', 'locationId'),
    role: dimension(target, 'role', 'roleId') ?? target.title ?? null,
    target: targetValue(target),
  })).filter(target => target.period && target.target != null)

  const agencyMode = config.mode === 'agency' || config.modules?.agency === true
  const outcomes = agencyMode
    ? rowsFor(recordsByKind, 'placements').filter(row => !row.status || ['placed', 'active', 'started', 'completed'].includes(String(row.status).toLowerCase())).map(row => {
      const job = jobsById.get(row.jobId) || {}
      return { id: row.id, date: row.placedAt || row.startDate, department: row.department ?? row.departmentId ?? job.department ?? job.departmentId, location: row.location ?? row.locationId ?? job.location ?? job.locationId, role: row.role ?? row.roleId ?? row.title ?? job.role ?? job.roleId ?? job.title }
    })
    : rowsFor(recordsByKind, 'applications').filter(row => String(row.status).toLowerCase() === 'hired').map(row => {
      const job = jobsById.get(row.jobId) || {}
      return { id: row.id, date: row.hiredAt, department: row.department ?? row.departmentId ?? job.department ?? job.departmentId, location: row.location ?? row.locationId ?? job.location ?? job.locationId, role: row.role ?? row.roleId ?? row.title ?? job.role ?? job.roleId ?? job.title }
    })

  const series = targets.map(target => {
    const actualHires = outcomes.filter(outcome => periodFor(outcome.date, target.period, timeZone) === target.period &&
      matchesDimension(target.department, outcome.department) && matchesDimension(target.location, outcome.location) && matchesDimension(target.role, outcome.role)).length
    return { ...target, actualHires, variance: actualHires - target.target, attainmentPercent: target.target > 0 ? round(actualHires / target.target * 100) : null }
  }).sort((a, b) => String(a.period).localeCompare(String(b.period)) || String(a.department || '').localeCompare(String(b.department || '')) || String(a.location || '').localeCompare(String(b.location || '')) || String(a.role || '').localeCompare(String(b.role || '')))

  const periods = [...new Set(series.map(row => row.period))].map(period => {
    const rows = series.filter(row => row.period === period)
    // Overlapping scopes (for example an all-department goal plus a department goal)
    // cannot be summed into a unique actual count without allocating hires arbitrarily.
    const overlaps = rows.some((row, index) => rows.slice(index + 1).some(other =>
      ['department', 'location', 'role'].every(key => row[key] == null || other[key] == null || String(row[key]) === String(other[key]))))
    return { period, targetCount: rows.length, target: round(rows.reduce((sum, row) => sum + row.target, 0)), actualHires: overlaps ? null : rows.reduce((sum, row) => sum + row.actualHires, 0), actualIsNonOverlapping: !overlaps }
  })
  const scopedActuals = series.filter(row => row.actualHires != null)
  const totalTarget = series.length ? round(series.reduce((sum, row) => sum + row.target, 0)) : null
  const overlappingPeriods = periods.some(row => !row.actualIsNonOverlapping)
  return {
    generatedAt: validDate(now)?.toISOString() || null,
    timeZone,
    outcomeType: agencyMode ? 'placements' : 'hires',
    summary: {
      targetCount: series.length,
      target: totalTarget,
      actualHires: !series.length || overlappingPeriods ? null : periods.reduce((sum, row) => sum + row.actualHires, 0),
      actualAgainstTargetRows: scopedActuals.reduce((sum, row) => sum + row.actualHires, 0),
      variance: !series.length || overlappingPeriods ? null : round(periods.reduce((sum, row) => sum + row.actualHires, 0) - totalTarget),
      attainmentPercent: totalTarget > 0 && !overlappingPeriods ? round(periods.reduce((sum, row) => sum + row.actualHires, 0) / totalTarget * 100) : null,
      hasTargets: series.length > 0,
    },
    periods,
    series,
  }
}

module.exports = { buildWorkforcePlan, periodFor }
