const { companyConfig } = require('../config/companyConfig')
const MANDATE_STATUSES = Object.freeze([...companyConfig.jobs.statuses])

const MANDATE_STATUS_LABELS = Object.freeze(Object.fromEntries(MANDATE_STATUSES.map(status => [status, status])))

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

function normalizeMandateStatus(value) {
  const text = clean(value)
  const lower = text.toLowerCase()
  const exact = MANDATE_STATUSES.find(status => status.toLowerCase() === lower)
  if (exact) return exact
  if (['p1', 'ongoing', 'ongoing (p1)', 'open', 'active'].includes(lower) && MANDATE_STATUSES.includes('Ongoing (P1)')) return 'Ongoing (P1)'
  if (['p2', 'delivered', 'delivered (p2)'].includes(lower) && MANDATE_STATUSES.includes('Delivered (P2)')) return 'Delivered (P2)'
  if (['p3', 'paused', 'paused (p3)', 'on hold', 'on-hold'].includes(lower) && MANDATE_STATUSES.includes('Paused (P3)')) return 'Paused (P3)'
  if (['completed', 'complete', 'closed', 'filled'].includes(lower) && MANDATE_STATUSES.includes('Completed')) return 'Completed'
  if (['scrapped', 'scrap', 'cancelled', 'canceled', 'abandoned'].includes(lower) && MANDATE_STATUSES.includes('Scrapped')) return 'Scrapped'
  return ''
}

function mandateStatusLabel(value) {
  const status = normalizeMandateStatus(value)
  return MANDATE_STATUS_LABELS[status] || clean(value) || '-'
}

module.exports = {
  MANDATE_STATUSES,
  MANDATE_STATUS_LABELS,
  mandateStatusLabel,
  normalizeMandateStatus
}
