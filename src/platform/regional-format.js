function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function dateOnlyParts(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null
  return { year, month, day }
}

function safeTimeZone(timeZone) {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return timeZone
  } catch {
    return 'UTC'
  }
}

export function formatRegionalDate(value, regional = {}) {
  // A date-only value represents a calendar day, not midnight in UTC. Parsing
  // it as a Date would move the displayed day backwards in western time zones.
  const plainDate = dateOnlyParts(value)
  if (plainDate) {
    const tokens = { YYYY: plainDate.year, MM: plainDate.month, DD: plainDate.day }
    return (regional.dateFormat || 'MM/DD/YYYY').replace(/YYYY|MM|DD/g, (token) => tokens[token])
  }
  const date = validDate(value)
  if (!date) return value ? String(value) : ''
  const timeZone = safeTimeZone(regional.timezone)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]))
  const tokens = { YYYY: parts.year, MM: parts.month, DD: parts.day }
  return (regional.dateFormat || 'MM/DD/YYYY').replace(/YYYY|MM|DD/g, (token) => tokens[token])
}

export function formatRegionalMoney(value, regional = {}, currency) {
  if (value == null || value === '') return ''
  const amount = Number(typeof value === 'object' ? value.amount : value)
  if (!Number.isFinite(amount)) return value == null ? '' : String(value)
  const locale = regional.numberLocale || regional.language || undefined
  const code = (typeof value === 'object' && value.currency) || currency || regional.currency || 'USD'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount)
  } catch {
    try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount) }
    catch { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount) }
  }
}

export function formatRegionalDateTime(value, regional = {}) {
  const date = validDate(value)
  if (!date) return value ? String(value) : ''
  const timeZone = safeTimeZone(regional.timezone)
  const datePart = formatRegionalDate(date, regional)
  const hour12 = regional.timeFormat === '12h' ? true : regional.timeFormat === '24h' ? false : undefined
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12,
  }).format(date)
  return `${datePart} ${timePart}`
}
