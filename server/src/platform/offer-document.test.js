'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { generateOfferDocument, renderOfferHtml, validateOfferDocumentInput, escapeHtml } = require('./offer-document')

const base = () => ({
  offer: { id: 'offer-42', status: 'pending_review', version: 3, joiningDate: '2026-11-02', expiryDate: '2026-10-05', salary: 125000, currency: 'GBP', employmentType: 'Full-time' },
  candidate: { name: 'Kai Rivera' },
  job: { title: 'Staff Engineer', department: 'Engineering', location: 'London' },
  config: { company: { legalName: 'Acme Talent Ltd', address: ['8 Market Lane', 'London'], supportEmail: 'people@example.test' }, branding: { primaryColor: '#1266AA' }, regional: { currency: 'GBP', numberLocale: 'en-GB' } },
})

test('renders a printable localized offer preview with template fields, status and version', () => {
  const input = base()
  const template = { id: 'senior', name: 'Senior offer', body: 'Hello {{ candidateName }}, welcome to {{companyName}} as {{jobTitle}}. Pay: {{salary}}. Join {{joiningDate}}. Reply by {{expiryDate}}.' }
  const result = generateOfferDocument({ ...input, template })
  assert.equal(result.filename, 'offer-offer-42.html')
  assert.match(result.mimeType, /^text\/html/)
  assert.match(result.html, /window\.print\(\)/)
  assert.match(result.html, /@media print/)
  assert.match(result.html, /Acme Talent Ltd/)
  assert.match(result.html, /Kai Rivera/)
  assert.match(result.html, /£125,000\.00/)
  assert.match(result.html, /2 November 2026/)
  assert.match(result.html, /5 October 2026/)
  assert.match(result.html, /pending review/)
  assert.match(result.html, /Version 3/)
  assert.match(result.html, /Preview only/)
  assert.match(result.html, /Senior offer/)
  assert.equal(renderOfferHtml(input.offer, input.candidate, input.job, input.config, template), result.html)
})

test('escapes untrusted offer, template, candidate, company and job text and rejects unsafe style colors', () => {
  const input = base()
  input.candidate.name = '<img src=x onerror=alert(1)>'
  input.offer.id = 'offer"><script>alert(1)</script>'
  input.config.company.legalName = ''
  input.config.company.name = '<b>Fake Co</b>'
  input.job.title = 'Engineer & <Admin>'
  input.config.branding.primaryColor = 'red;}</style><script>alert(1)</script>'
  const result = generateOfferDocument({ ...input, template: { body: 'Hello {{candidateName}} <script>bad()</script>' } })
  assert.match(result.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(result.html, /&lt;b&gt;Fake Co&lt;\/b&gt;/)
  assert.match(result.html, /Engineer &amp; &lt;Admin&gt;/)
  assert.match(result.html, /--brand:#2347C5/)
  assert.doesNotMatch(result.html, /<script>alert/)
})

test('validates required records, dates and compensation', () => {
  const input = base()
  assert.throws(() => validateOfferDocumentInput({ offer: input.offer, candidate: input.candidate }), /job record is required/)
  assert.throws(() => generateOfferDocument({ ...input, offer: { ...input.offer, joiningDate: '2026-02-30' } }), /valid calendar date/)
  assert.throws(() => generateOfferDocument({ ...input, offer: { ...input.offer, expiryDate: 'tomorrow' } }), /ISO date/)
  for (const salary of [-1, Infinity, 'not money']) assert.throws(() => generateOfferDocument({ ...input, offer: { ...input.offer, salary } }), /compensation must be/)
  assert.throws(() => generateOfferDocument({ ...input, offer: { ...input.offer, currency: 'ZZZ' } }), /supported by this runtime/)
})

test('template interpolation escapes configured variables and blanks unknown placeholders', () => {
  const input = base()
  const { html } = generateOfferDocument({ ...input, candidate: { name: '<Ana>' }, template: { body: '{{candidateName}} / {{unsupportedThing}}' } })
  assert.match(html, /&lt;Ana&gt; \/\s*<\/section>/)
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
})
