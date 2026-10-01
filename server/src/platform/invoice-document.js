'use strict'

const DEFAULT_COLOR = '#2347C5'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function optionalText(value) {
  if (value == null) return ''
  return String(value).trim()
}

function validDate(value, field) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    throw new TypeError(`${field} must be an ISO date or ISO date-time.`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid date.`)
  // Date-only values must round-trip: JavaScript otherwise normalizes dates such as February 30.
  if (value.length === 10 && date.toISOString().slice(0, 10) !== value) throw new TypeError(`${field} must be a valid calendar date.`)
  return date
}

function validateInvoiceDocumentInput({ invoice, placement, client } = {}) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) throw new TypeError('An invoice record is required.')
  if (!placement || typeof placement !== 'object' || Array.isArray(placement)) throw new TypeError('A placement record is required.')
  if (!client || typeof client !== 'object' || Array.isArray(client)) throw new TypeError('A client record is required.')

  if (invoice.amount == null || (typeof invoice.amount === 'string' && !invoice.amount.trim())) throw new TypeError('Invoice amount is required.')
  const amount = typeof invoice.amount === 'number' ? invoice.amount : Number(invoice.amount)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new TypeError('Invoice amount must be a finite, non-negative amount with at most safe cent precision.')
  }
  const currency = String(invoice.currency || 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('Invoice currency must be a three-letter ISO currency code.')
  let currencyFormatter
  try { currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency }) }
  catch { throw new TypeError('Invoice currency must be supported by this runtime.') }
  if (typeof Intl.supportedValuesOf === 'function' && !Intl.supportedValuesOf('currency').includes(currency)) {
    throw new TypeError('Invoice currency must be supported by this runtime.')
  }
  const fractionDigits = currencyFormatter.resolvedOptions().maximumFractionDigits
  if (Math.abs(amount - Number(amount.toFixed(fractionDigits))) > 1e-9) throw new TypeError(`Invoice amount supports at most ${fractionDigits} decimal places for ${currency}.`)

  const issuedAt = validDate(invoice.issuedAt, 'Invoice issue date')
  const dueAt = validDate(invoice.dueAt, 'Invoice due date')
  const paidAt = validDate(invoice.paidAt, 'Invoice paid date')
  const guaranteeExpiry = validDate(placement.guaranteeExpiry, 'Placement guarantee expiry')
  if (issuedAt && dueAt && dueAt < issuedAt) throw new TypeError('Invoice due date cannot be earlier than the issue date.')

  return { amount, currency, issuedAt, dueAt, paidAt, guaranteeExpiry }
}

function safeColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLOR
}

function formatDate(date, locale) {
  return date ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date) : '—'
}

function formatMoney(amount, currency, locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}

function addressLines(value) {
  if (Array.isArray(value)) return value.map(optionalText).filter(Boolean)
  if (typeof value === 'string') return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (value && typeof value === 'object') return ['address1', 'address2', 'city', 'region', 'postalCode', 'country'].map(key => optionalText(value[key])).filter(Boolean)
  return []
}

function generateInvoiceDocument({ invoice, placement, client, config = {}, candidate = null, job = null } = {}) {
  const checked = validateInvoiceDocumentInput({ invoice: { ...invoice, currency: invoice?.currency || config.regional?.currency || 'USD' }, placement, client })
  const company = config.company || {}
  const branding = config.branding || {}
  const regional = config.regional || {}
  const locale = typeof regional.numberLocale === 'string' && regional.numberLocale ? regional.numberLocale : 'en-US'
  let safeLocale = locale
  try { new Intl.DateTimeFormat(locale) } catch { safeLocale = 'en-US' }
  const companyName = optionalText(company.legalName || company.name || branding.productName) || 'Company'
  const invoiceNumber = optionalText(invoice.number || invoice.invoiceNumber || invoice.id) || 'draft'
  const issuedAt = formatDate(checked.issuedAt, safeLocale)
  const dueAt = formatDate(checked.dueAt, safeLocale)
  const paidAt = formatDate(checked.paidAt, safeLocale)
  const primaryColor = safeColor(branding.primaryColor)
  const amount = formatMoney(checked.amount, checked.currency, safeLocale)
  const companyAddress = addressLines(company.address || company.legalAddress)
  const clientAddress = addressLines(client.address || client.billingAddress)
  const feeType = optionalText(placement.feeType || placement.feeModel || 'Placement service')
  const candidateName = optionalText(candidate?.name || placement.candidateName)
  const jobTitle = optionalText(job?.title || placement.jobTitle || placement.mandateTitle)
  const status = optionalText(invoice.status || 'draft').replace(/[_-]+/g, ' ')
  const contactEmail = optionalText(company.supportEmail || company.email)
  const companyWebsite = optionalText(company.website)
  const guarantee = checked.guaranteeExpiry ? formatDate(checked.guaranteeExpiry, safeLocale) : ''
  const filenameToken = invoiceNumber.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'draft'

  const html = `<!doctype html>
<html lang="${escapeHtml(safeLocale.split('-')[0] || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escapeHtml(invoiceNumber)} · ${escapeHtml(companyName)}</title>
<style>
:root{color-scheme:light;--brand:${primaryColor};--ink:#172033;--muted:#667085;--line:#d9dee8;--paper:#fff;--canvas:#f2f4f8}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.toolbar{max-width:850px;margin:20px auto 0;display:flex;justify-content:flex-end}.print{border:0;border-radius:7px;background:var(--brand);color:#fff;padding:10px 16px;font:inherit;font-weight:650;cursor:pointer}
main{max-width:850px;margin:12px auto 40px;padding:56px 62px;background:var(--paper);box-shadow:0 8px 28px #17203316}
.top{display:flex;justify-content:space-between;gap:36px;border-bottom:2px solid var(--brand);padding-bottom:28px}.issuer h1{font-size:23px;margin:0 0 8px}.issuer p,.billto p{margin:2px 0;color:var(--muted)}.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}.invoice-title{text-align:right}.invoice-title h2{font-size:34px;line-height:1;margin:8px 0 10px;color:var(--brand)}.invoice-title p{margin:4px 0}.parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:28px 0}.billto h3{margin:5px 0;font-size:17px}.details{width:100%;border-collapse:collapse;margin-top:14px}.details th,.details td{padding:13px 10px;border-bottom:1px solid var(--line);text-align:left}.details th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.details td:last-child,.details th:last-child{text-align:right}.total{display:flex;justify-content:flex-end;padding:20px 8px}.total strong{font-size:22px;margin-left:38px}.notes{margin-top:32px;padding:17px 19px;border:1px solid var(--line);border-radius:8px}.notes h3{margin:0 0 5px;font-size:14px}.notes p{margin:4px 0;color:var(--muted)}footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(max-width:650px){main{margin:10px;padding:28px 22px}.top{flex-direction:column}.invoice-title{text-align:left}.parties{grid-template-columns:1fr}.toolbar{margin:10px}.total strong{margin-left:15px}}
@media print{@page{size:A4;margin:14mm}body{background:#fff;font-size:11pt}.toolbar{display:none}main{max-width:none;margin:0;padding:0;box-shadow:none}.top{break-inside:avoid}.details tr{break-inside:avoid}}
</style>
</head>
<body>
<div class="toolbar"><button class="print" type="button" onclick="window.print()">Print / Save as PDF</button></div>
<main>
  <header class="top">
    <section class="issuer"><h1>${escapeHtml(companyName)}</h1>${companyAddress.map(line => `<p>${escapeHtml(line)}</p>`).join('')}${contactEmail ? `<p>${escapeHtml(contactEmail)}</p>` : ''}${companyWebsite ? `<p>${escapeHtml(companyWebsite)}</p>` : ''}</section>
    <section class="invoice-title"><div class="label">Invoice</div><h2>${escapeHtml(invoiceNumber)}</h2><p><span class="label">Status</span> ${escapeHtml(status)}</p><p><span class="label">Issued</span> ${escapeHtml(issuedAt)}</p><p><span class="label">Due</span> ${escapeHtml(dueAt)}</p></section>
  </header>
  <section class="parties"><div class="billto"><div class="label">Bill to</div><h3>${escapeHtml(client.name || 'Client')}</h3>${clientAddress.map(line => `<p>${escapeHtml(line)}</p>`).join('')}${client.email ? `<p>${escapeHtml(client.email)}</p>` : ''}</div><div class="billto"><div class="label">Placement details</div>${candidateName ? `<p><strong>Candidate:</strong> ${escapeHtml(candidateName)}</p>` : ''}${jobTitle ? `<p><strong>Role:</strong> ${escapeHtml(jobTitle)}</p>` : ''}${placement.placedAt ? `<p><strong>Placement date:</strong> ${escapeHtml(formatDate(validDate(placement.placedAt, 'Placement date'), safeLocale))}</p>` : ''}${guarantee ? `<p><strong>Guarantee through:</strong> ${escapeHtml(guarantee)}</p>` : ''}</div></section>
  <table class="details"><thead><tr><th>Description</th><th>Placement</th><th>Amount</th></tr></thead><tbody><tr><td>${escapeHtml(feeType)}</td><td>${escapeHtml(placement.id || invoice.placementId || '—')}</td><td>${escapeHtml(amount)}</td></tr></tbody></table>
  <div class="total"><span>Total due</span><strong>${escapeHtml(amount)}</strong></div>
  ${checked.paidAt ? `<div class="notes"><h3>Payment status</h3><p>Recorded as paid on ${escapeHtml(paidAt)}.</p></div>` : ''}
  ${invoice.notes ? `<div class="notes"><h3>Note</h3><p>${escapeHtml(invoice.notes)}</p></div>` : ''}
  <footer>This document reflects the locally stored invoice record. Payment processing is not enabled in this local development environment.</footer>
</main>
</body>
</html>`
  return { html, filename: `invoice-${filenameToken}.html`, mimeType: 'text/html; charset=utf-8' }
}

function renderInvoiceHtml(invoice, placement, client, config = {}) {
  return generateInvoiceDocument({ invoice, placement, client, config }).html
}

module.exports = { generateInvoiceDocument, renderInvoiceHtml, validateInvoiceDocumentInput, escapeHtml }
