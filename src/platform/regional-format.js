function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
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
  const date = validDate(value)
  if (!date) return value ? String(value) : ''
  const timeZone = safeTimeZone(regional.timezone)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]))
  const tokens = { YYYY: parts.year, MM: parts.month, DD: parts.day }
  return (regional.dateFormat || 'MM/DD/YYYY').replace(/YYYY|MM|DD/g, (token) => tokens[token])
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
