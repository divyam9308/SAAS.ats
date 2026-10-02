import test from 'node:test'
import assert from 'node:assert/strict'
import {
  careersJobMetadata,
  formatCareersDate,
  formatCareersDateTime,
  formatCareersSalaryBand,
  resolveCareersBranding,
  resolveCareersCopy,
  resolveCareersTerm,
  safeCareersAssetUrl,
} from './careers-presentation.js'

test('careers branding accepts safe HTTPS and same-origin assets and rejects active or ambiguous protocols', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,<svg/onload=alert(1)>', 'vbscript:msgbox(1)', 'file:///etc/passwd', '//evil.example/logo.svg', 'https://good.example/logo.svg']) {
    const branding = resolveCareersBranding({ careersLogo: value })
    assert.equal(branding.logo, value.startsWith('https:') ? value : '')
  }
  assert.equal(safeCareersAssetUrl('/assets/logo.svg'), '/assets/logo.svg')
  assert.equal(safeCareersAssetUrl('https://cdn.example/logo.svg'), 'https://cdn.example/logo.svg')
  assert.equal(safeCareersAssetUrl('https://name:secret@cdn.example/logo.svg'), '')
  assert.equal(resolveCareersBranding({ colorMode: 'dark', darkPrimaryColor: '#abc' }).primaryColor, '#abc')
  assert.equal(resolveCareersBranding({ primaryColor: 'url(javascript:alert(1))' }).primaryColor, '#2347C5')
})

test('careers copy and terminology use bounded config values with safe defaults', () => {
  const copy = resolveCareersCopy({ copy: { headline: 'Careers with purpose', submit: 'Send application', unknown: 'ignored' } })
  assert.equal(copy.headline, 'Careers with purpose')
  assert.equal(copy.submit, 'Send application')
  assert.equal(copy.loading, 'Loading open positions…')
  assert.equal(Object.hasOwn(copy, 'unknown'), false)
  assert.equal(resolveCareersTerm({ jobs: 'Opportunities' }, 'jobs'), 'Opportunities')
  assert.equal(resolveCareersTerm({}, 'candidates'), 'Candidates')
})

test('careers regional date and salary formatting honor valid locale, timezone, and currency', () => {
  assert.equal(formatCareersDate('2026-01-01T01:00:00Z', { locale: 'en-GB', timezone: 'Europe/London', dateFormat: 'DD/MM/YYYY' }), '01/01/2026')
  assert.equal(formatCareersDate('2026-01-01T01:00:00Z', { locale: 'not_a_locale', timezone: 'bad/zone' }), '01/01/2026')
  assert.equal(formatCareersSalaryBand({ min: 50000, max: 70000 }, { locale: 'en-US', currency: 'USD' }), '$50,000–$70,000')
  assert.equal(formatCareersSalaryBand({ min: 50000 }, { locale: 'en-GB', currency: 'GBP' }), '£50,000+')
  assert.equal(formatCareersSalaryBand({ min: null, max: '' }, { currency: 'USD' }), '')
  assert.equal(formatCareersSalaryBand({ min: 0, max: null }, { currency: 'USD' }), '$0+')
  assert.equal(formatCareersDateTime('2026-01-01T13:05:00Z', { timezone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' }), '2026-01-01 13:05')
  assert.equal(formatCareersDateTime('2026-01-01T13:05:00Z', { timezone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' }), '2026-01-01 1:05 PM')
  assert.equal(formatCareersSalaryBand('Competitive salary', { currency: 'USD' }), 'Competitive salary')
  assert.equal(careersJobMetadata({ department: 'Design', salaryRange: { min: 80000, max: 90000 }, currency: 'EUR' }, { locale: 'de-DE' }), 'Design · 80.000 €–90.000 €')
})
