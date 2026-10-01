'use strict'

const DEFAULT_COLOR = '#2347C5'
const STANDARD_VARIABLES = Object.freeze([
  'candidateName', 'companyName', 'jobTitle', 'department', 'location',
  'joiningDate', 'expiryDate', 'salary', 'currency', 'employmentType', 'managerName',
])

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function text(value) { return value == null ? '' : String(value).trim() }
function safeColor(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLOR }

function normalizeDate(value, field) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    throw new TypeError(`${field} must be an ISO date or ISO date-time.`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid date.`)
  if (value.length === 10 && date.toISOString().slice(0, 10) !== value) throw new TypeError(`${field} must be a valid calendar date.`)
  return date
}

function safeLocale(value) {
  if (typeof value !== 'string' || !value.trim()) return 'en-US'
  try { new Intl.DateTimeFormat(value); return value } catch { return 'en-US' }
}
function formatDate(date, locale) {
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date) : '—'
}
function formatCompensation(amount, currency, locale) {
  if (amount == null || amount === '') return 'Not specified'
  const numeric = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError('Offer compensation must be a finite, non-negative amount.')
  const code = String(currency || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) throw new TypeError('Offer currency must be a three-letter ISO currency code.')
  try {
    const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(numeric)
    if (typeof Intl.supportedValuesOf === 'function' && !Intl.supportedValuesOf('currency').includes(code)) throw new Error('unsupported currency')
    return formatted
  } catch { throw new TypeError('Offer currency must be supported by this runtime.') }
}
function addressLines(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  if (typeof value === 'string') return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (value && typeof value === 'object') return ['address1', 'address2', 'city', 'region', 'postalCode', 'country'].map(key => text(value[key])).filter(Boolean)
  return []
}
function templateVariables(template) {
  const declared = Array.isArray(template?.variables) ? template.variables : STANDARD_VARIABLES
  return [...new Set([...STANDARD_VARIABLES, ...declared.filter(value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value))])]
}
function renderConfiguredTemplate(template, values) {
  const source = typeof template === 'string' ? template : (typeof template?.body === 'string' ? template.body : '')
  if (!source) return ''
  // Treat template copy as text too; only recognized variables are interpolated.
  return source.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_match, key) => `\u0000${key}\u0000`)
    .split('\u0000').map((part, index) => index % 2 ? escapeHtml(values[part] ?? '') : escapeHtml(part)).join('')
}

function validateOfferDocumentInput({ offer, candidate, job, config = {} } = {}) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new TypeError('An offer record is required.')
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new TypeError('A candidate record is required.')
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new TypeError('A job record is required.')
  const joiningDate = normalizeDate(offer.joiningDate || offer.joining_date, 'Joining date')
  const expiryDate = normalizeDate(offer.expiryDate || offer.expiry_date || offer.expiresAt, 'Offer expiry date')
  if (joiningDate && expiryDate && expiryDate > joiningDate) { /* valid: acceptance deadline can precede joining */ }
  const regional = config.regional || {}
  const locale = safeLocale(regional.numberLocale || regional.locale)
  const currency = String(offer.currency || regional.currency || 'USD').toUpperCase()
  const compensation = formatCompensation(offer.salary ?? offer.compensation ?? offer.amount, currency, locale)
  return { joiningDate, expiryDate, locale, currency, compensation }
}

function generateOfferDocument({ offer, candidate, job, config = {}, template = null } = {}) {
  const checked = validateOfferDocumentInput({ offer, candidate, job, config })
  const company = config.company || {}
  const branding = config.branding || {}
  const selectedTemplate = template || config.offerTemplate || config.templates?.offer || null
  const companyName = text(company.legalName || company.name || branding.productName) || 'Company'
  const candidateName = text(candidate.name || [candidate.firstName, candidate.lastName].filter(Boolean).join(' ')) || 'Candidate'
  const jobTitle = text(job.title || offer.jobTitle) || 'Position'
  const status = text(offer.status || 'draft').replace(/[_-]+/g, ' ')
  const version = text(offer.version || offer.versionNumber || '1')
  const primaryColor = safeColor(branding.primaryColor)
  const joiningDate = formatDate(checked.joiningDate, checked.locale)
  const expiryDate = formatDate(checked.expiryDate, checked.locale)
  const variables = Object.fromEntries(templateVariables(selectedTemplate).map(key => [key, '']))
  Object.assign(variables, {
    candidateName, companyName, jobTitle,
    department: text(job.department || offer.department) || '—',
    location: text(job.location || offer.location) || '—',
    joiningDate, expiryDate, salary: checked.compensation, currency: checked.currency,
    employmentType: text(offer.employmentType || offer.employment_type || job.employmentType) || '—',
    managerName: text(offer.managerName || job.managerName) || '—',
  })
  const body = renderConfiguredTemplate(selectedTemplate, variables) || `Dear {{candidateName}},\n\nWe are pleased to offer you the position of {{jobTitle}} at {{companyName}}. Your expected joining date is {{joiningDate}}. Compensation: {{salary}}. Please respond by {{expiryDate}}.`
  const address = addressLines(company.address || company.legalAddress)
  const offerId = text(offer.number || offer.offerNumber || offer.id) || 'draft'
  const filenameToken = offerId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') .replace(/^-+|-+$/g, '') || 'draft'
  const html = `<!doctype html>
<html lang="${escapeHtml(checked.locale.split('-')[0] || 'en')}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offer ${escapeHtml(offerId)} · ${escapeHtml(companyName)}</title>
<style>
:root{color-scheme:light;--brand:${primaryColor};--ink:#172033;--muted:#667085;--line:#d9dee8;--paper:#fff;--canvas:#f2f4f8}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}.toolbar{max-width:850px;margin:20px auto 0;display:flex;justify-content:flex-end}.print{border:0;border-radius:7px;background:var(--brand);color:#fff;padding:10px 16px;font:inherit;font-weight:650;cursor:pointer}main{max-width:850px;margin:12px auto 40px;padding:56px 62px;background:var(--paper);box-shadow:0 8px 28px #17203316}.preview{display:inline-block;background:#fff3cd;color:#704d00;border:1px solid #f0d98b;border-radius:4px;padding:4px 9px;font-size:11px;font-weight:750;letter-spacing:.07em;text-transform:uppercase}.top{display:flex;justify-content:space-between;gap:25px;border-bottom:2px solid var(--brand);padding:18px 0 25px}.issuer h1{font-size:22px;margin:0 0 5px}.issuer p{margin:1px 0;color:var(--muted)}.meta{text-align:right}.meta h2{margin:0 0 8px;color:var(--brand);font-size:30px}.meta p{margin:3px 0}.label{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}.item{border:1px solid var(--line);border-radius:8px;padding:13px 15px}.item strong{display:block;margin-top:4px}.letter{white-space:pre-wrap;margin:28px 0;min-height:170px}.sign{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:28px}.line{border-top:1px solid var(--line);padding-top:8px;color:var(--muted);font-size:12px}.mock{margin-top:35px;padding:12px 15px;background:#f7f8fb;border-left:3px solid var(--brand);color:var(--muted);font-size:12px}footer{margin-top:28px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}@media(max-width:650px){main{margin:10px;padding:28px 22px}.top{flex-direction:column}.meta{text-align:left}.summary,.sign{grid-template-columns:1fr}.toolbar{margin:10px}}@media print{@page{size:A4;margin:14mm}body{background:#fff;font-size:11pt}.toolbar{display:none}main{max-width:none;margin:0;padding:0;box-shadow:none}.preview{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style>
</head><body><div class="toolbar"><button class="print" type="button" onclick="window.print()">Print / Save as PDF</button></div><main>
<span class="preview">Mock offer · Preview only</span>
<header class="top"><section class="issuer"><h1>${escapeHtml(companyName)}</h1>${address.map(line => `<p>${escapeHtml(line)}</p>`).join('')}${company.supportEmail || company.email ? `<p>${escapeHtml(company.supportEmail || company.email)}</p>` : ''}</section><section class="meta"><div class="label">Offer document</div><h2>${escapeHtml(offerId)}</h2><p><span class="label">Status</span> ${escapeHtml(status)}</p><p><span class="label">Version</span> ${escapeHtml(version)}</p></section></header>
<section class="summary"><div class="item"><span class="label">Candidate</span><strong>${escapeHtml(candidateName)}</strong></div><div class="item"><span class="label">Position</span><strong>${escapeHtml(jobTitle)}</strong></div><div class="item"><span class="label">Compensation</span><strong>${escapeHtml(checked.compensation)}</strong></div><div class="item"><span class="label">Expected joining date</span><strong>${escapeHtml(joiningDate)}</strong></div>${checked.expiryDate ? `<div class="item"><span class="label">Offer expires</span><strong>${escapeHtml(expiryDate)}</strong></div>` : ''}</section>
<section class="letter">${body}</section>
<section class="sign"><div class="line">For ${escapeHtml(companyName)}<br>Authorized representative</div><div class="line">Candidate acceptance<br>Signature and date</div></section>
<div class="mock">Preview only. This locally rendered mock offer is not an issued offer and does not create an employment agreement.</div><footer>Offer template: ${escapeHtml(text(selectedTemplate?.name || selectedTemplate?.id || 'Default'))} · Version ${escapeHtml(version)}</footer>
</main></body></html>`
  return { html, filename: `offer-${filenameToken}.html`, mimeType: 'text/html; charset=utf-8' }
}

function renderOfferHtml(offer, candidate, job, config = {}, template = null) {
  return generateOfferDocument({ offer, candidate, job, config, template }).html
}

module.exports = { generateOfferDocument, renderOfferHtml, validateOfferDocumentInput, escapeHtml, STANDARD_VARIABLES }
