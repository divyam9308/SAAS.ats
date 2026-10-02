import { formatRegionalDate } from './regional-format.js'

const DEFAULT_COPY = Object.freeze({
  eyebrow: 'Careers',
  headline: 'Find work that moves you forward.',
  intro: 'Explore open positions and find a place where your work matters.',
  brandSubheading: 'Explore opportunities to do meaningful work.',
  searchPlaceholder: 'Search jobs by title, team or location',
  openRole: 'role',
  openRoles: 'roles',
  loading: 'Loading open positions…',
  noMatchesTitle: 'No open roles match',
  noMatchesDescription: 'Try another title or check back later for new opportunities.',
  allOpenings: 'All openings',
  apply: 'Apply for this role',
  applicationIntro: 'Share a few details to get started.',
  submit: 'Submit application',
  submitting: 'Submitting…',
  receivedTitle: 'Application received',
  receivedDescription: 'Thanks for applying. Your information has been added to the hiring workspace.',
  salary: 'Salary',
  poweredBy: 'Powered by',
  privacyFooter: 'Candidate privacy is managed by the company',
})

const TERM_FALLBACKS = Object.freeze({ jobs: 'Jobs', candidates: 'Candidates' })

export function resolveCareersCopy(careers = {}) {
  const supplied = careers && typeof careers.copy === 'object' && careers.copy ? careers.copy : {}
  return Object.fromEntries(Object.entries(DEFAULT_COPY).map(([key, fallback]) => {
    const value = supplied[key]
    return [key, typeof value === 'string' && value.trim() ? value.trim() : fallback]
  }))
}

export function resolveCareersTerm(terminology = {}, key = 'jobs') {
  const fallback = TERM_FALLBACKS[key] || key
  const value = terminology?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function safeCareersAssetUrl(value) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  if (!url || /[\u0000-\u0020\\]/.test(url)) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : ''
  } catch {
    return ''
  }
}

function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) ? value : fallback
}

export function resolveCareersBranding(branding = {}, jobBranding = {}) {
  const source = { ...(branding || {}), ...(jobBranding || {}) }
  const dark = source.colorMode === 'dark'
  const logo = safeCareersAssetUrl(source.careersLogo || source.logo)
  return {
    logo,
    primaryColor: safeColor(dark ? source.darkPrimaryColor : source.primaryColor, dark ? '#93A8FF' : '#2347C5'),
    accentColor: safeColor(source.accentColor, '#13A88A'),
    colorMode: dark ? 'dark' : 'light',
    backgroundColor: dark ? safeColor(source.darkBackgroundColor, '#101522') : '#f7f8fb',
    fontFamily: typeof source.fontFamily === 'string' && /^[\w\s,"'-]{1,100}$/.test(source.fontFamily) ? source.fontFamily : '',
  }
}

function localeFor(regional = {}) {
  const locale = regional.locale || regional.numberLocale || regional.language || 'en-US'
  try {
    new Intl.NumberFormat(locale).format(1)
    return locale
  } catch {
    return 'en-US'
  }
}

function timeZoneFor(regional = {}) {
  const timezone = regional.timezone || 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
    return timezone
  } catch {
    return 'UTC'
  }
}

export function formatCareersDate(value, regional = {}) {
  return formatRegionalDate(value, { ...regional, timezone: timeZoneFor(regional) })
}

export function formatCareersDateTime(value, regional = {}) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return value == null ? '' : String(value)
  const locale = localeFor(regional)
  const hour12 = regional.timeFormat === '12h' ? true : regional.timeFormat === '24h' ? false : undefined
  const time = new Intl.DateTimeFormat(locale, { timeZone: timeZoneFor(regional), hour: 'numeric', minute: '2-digit', hour12 }).format(date)
  return `${formatCareersDate(date, regional)} ${time}`
}

function numericBound(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function formatCareersSalaryBand(salaryRange, regional = {}, fallbackCurrency = '') {
  if (salaryRange == null || salaryRange === '') return ''
  if (typeof salaryRange === 'string') return salaryRange.trim()
  const range = typeof salaryRange === 'number' ? { min: salaryRange } : salaryRange
  if (!range || typeof range !== 'object') return ''
  const currency = String(range.currency || fallbackCurrency || regional.currency || 'USD').toUpperCase()
  const locale = localeFor(regional)
  let formatter
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })
  } catch {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  }
  const min = numericBound(range.min ?? range.minimum)
  const max = numericBound(range.max ?? range.maximum)
  if (min !== null && max !== null) return `${formatter.format(min)}–${formatter.format(max)}`
  if (min !== null) return `${formatter.format(min)}+`
  if (max !== null) return `Up to ${formatter.format(max)}`
  return typeof range.label === 'string' ? range.label : ''
}

export function careersJobMetadata(job = {}, regional = {}) {
  const parts = [job.department, job.location, job.employmentType || job.type]
  const salary = formatCareersSalaryBand(job.salaryRange, regional, job.currency)
  if (salary) parts.push(salary)
  return parts.filter(Boolean).join(' · ')
}
