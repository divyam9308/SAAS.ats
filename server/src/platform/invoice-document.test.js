'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateInvoiceDocument, renderInvoiceHtml, escapeHtml, validateInvoiceDocumentInput } = require('./invoice-document')

const base = () => ({
  invoice: { id: 'inv-42', number: 'FY-2026/42', amount: 1250.5, currency: 'GBP', status: 'draft', issuedAt: '2026-09-20', dueAt: '2026-10-20' },
  placement: { id: 'placement-3', feeType: 'Success fee', placedAt: '2026-09-18', guaranteeExpiry: '2026-12-17', candidateName: 'Kai Rivera', jobTitle: 'Staff Engineer' },
  client: { id: 'client-1', name: 'Northstar & Co', address: { address1: '12 King Street', city: 'London', country: 'UK' } },
  config: { company: { name: 'Acme Talent', legalName: 'Acme Talent Ltd', address: ['8 Market Lane', 'London'], supportEmail: 'billing@example.test' }, branding: { primaryColor: '#1266AA' }, regional: { currency: 'GBP', numberLocale: 'en-GB' } },
})

test('generates standalone printable invoice with company, client, placement and localized amount', () => {
  const result = generateInvoiceDocument(base())
  assert.equal(result.filename, 'invoice-fy-2026-42.html')
  assert.match(result.mimeType, /^text\/html/)
  assert.match(result.html, /<!doctype html>/i)
  assert.match(result.html, /window\.print\(\)/)
  assert.match(result.html, /@media print/)
  assert.match(result.html, /Acme Talent Ltd/)
  assert.match(result.html, /Northstar &amp; Co/)
  assert.match(result.html, /Kai Rivera/)
  assert.match(result.html, /Staff Engineer/)
  assert.match(result.html, /£1,250\.50/)
  assert.match(result.html, /Payment processing is not enabled/)
  assert.doesNotMatch(result.html, /<script[^>]*src=/i)
  assert.equal(renderInvoiceHtml(base().invoice, base().placement, base().client, base().config), result.html)
})

test('escapes dynamic content and rejects untrusted branding style values', () => {
  const input = base()
  input.invoice.number = '<img src=x onerror=alert(1)>'
  input.invoice.notes = '<script>alert("x")</script>'
  input.placement.candidateName = 'A & B <Candidate>'
  input.client.name = '"Acme" <img src=x>'
  input.config.branding.primaryColor = 'red;}</style><script>alert(1)</script>'
  const { html } = generateInvoiceDocument(input)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'))
  assert.ok(html.includes('A &amp; B &lt;Candidate&gt;'))
  assert.ok(html.includes('&quot;Acme&quot; &lt;img src=x&gt;'))
  assert.ok(html.includes('--brand:#2347C5'))
  assert.ok(!html.includes('<script>alert'))
})

test('validates required records, amount and ISO currency', () => {
  const input = base()
  assert.throws(() => validateInvoiceDocumentInput({ invoice: input.invoice, placement: input.placement }), /client record is required/)
  for (const amount of [-0.01, Infinity, NaN, 'not-a-number']) {
    assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, amount } }), /amount must be/)
  }
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, amount: '' } }), /amount is required/)
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, currency: 'US' } }), /three-letter ISO/)
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, currency: 'ZZZ' } }), /supported by this runtime/)
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, amount: 1.234 } }), /decimal places/)
})

test('rejects invalid calendar dates and a due date before issue date', () => {
  const input = base()
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, issuedAt: '2026-02-30' } }), /valid calendar date/)
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, dueAt: 'not-a-date' } }), /ISO date/)
  assert.throws(() => generateInvoiceDocument({ ...input, invoice: { ...input.invoice, dueAt: '2026-09-19' } }), /cannot be earlier/)
  assert.throws(() => generateInvoiceDocument({ ...input, placement: { ...input.placement, guaranteeExpiry: '2026-13-02' } }), /valid date/)
})

test('HTML escaping covers every HTML-significant character', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
})
