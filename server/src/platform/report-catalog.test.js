'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { getPlatformReport, listPlatformReports } = require('./report-catalog')

const config = { modules: {
  reporting: true,
  applications: true,
  offers: true,
  interviews: true,
  agency: true,
  invoices: true,
  workforcePlanning: true,
} }
const metrics = {
  generatedAt: '2026-09-24T00:00:00.000Z',
  jobs: { total: 3, open: 2, filled: 1, draft: 0 },
  applications: { total: 12, active: 8, hired: 2, rejected: 1, withdrawn: 1 },
  hires: 2,
  pipeline: { pipelines: [{ id: 'engineering', applications: 7 }], averageActiveStageAgeDays: 4.2, stageAge: [] },
  sources: [{ source: 'Referral', applications: 3, hires: 1, hireRatePercent: 33.3 }],
  workload: [{ ownerId: 'recruiter-1', applications: 8, jobs: 2, interviews: 1, openTasks: 3 }],
  offers: { total: 2, accepted: 1, pending: 1, declined: 0, acceptanceRatePercent: 100 },
  interviews: { total: 5, scheduled: 2, completed: 3, cancelled: 0, completionRatePercent: 100 },
  agency: { placements: 1, fees: 12000, invoices: 1, submissions: 4 },
  workforceTargets: [{ period: '2026-Q3', target: 4, actualHires: 2, attainmentPercent: 50 }],
}

test('catalog exposes overview and focused reports from already-scoped metrics', () => {
  assert.deepEqual(getPlatformReport('overview', metrics, config), {
    name: 'overview', generatedAt: metrics.generatedAt, metrics,
  })
  const pipeline = getPlatformReport('pipeline', metrics, config)
  assert.deepEqual(pipeline.metrics, { pipeline: metrics.pipeline })
  const sources = getPlatformReport('sources', metrics, config)
  assert.deepEqual(sources.metrics, { sources: metrics.sources })
  assert.deepEqual(getPlatformReport('workload', metrics, config).metrics, { workload: metrics.workload })
  assert.deepEqual(getPlatformReport('offers', metrics, config).metrics, { offers: metrics.offers })
  assert.deepEqual(getPlatformReport('interviews', metrics, config).metrics, { interviews: metrics.interviews })
  assert.deepEqual(getPlatformReport('agency', metrics, config).metrics, { agency: metrics.agency })
  assert.deepEqual(getPlatformReport('workforce', metrics, config).metrics, { workforceTargets: metrics.workforceTargets })
})

test('catalog rejects unknown names and never fabricates absent metrics', () => {
  assert.equal(getPlatformReport('fake-report', metrics, config), null)
  assert.deepEqual(getPlatformReport('offers', { generatedAt: metrics.generatedAt }, config).metrics, {})
  assert.equal(getPlatformReport('overview', null, config), null)
})

test('reports follow company module settings and reporting toggle', () => {
  assert.equal(getPlatformReport('agency', metrics, { modules: { ...config.modules, agency: false } }), null)
  assert.deepEqual(getPlatformReport('agency', metrics, { modules: { ...config.modules, invoices: false } }).metrics.agency, { placements: 1, fees: 12000, submissions: 4 })
  assert.equal(getPlatformReport('offers', metrics, { modules: { ...config.modules, offers: false } }), null)
  assert.equal(getPlatformReport('interviews', metrics, { modules: { ...config.modules, interviews: false } }), null)
  assert.equal(getPlatformReport('workforce', metrics, { modules: { ...config.modules, workforcePlanning: false } }), null)
  assert.equal(getPlatformReport('pipeline', metrics, { modules: { ...config.modules, applications: false } }), null)
  assert.equal(getPlatformReport('sources', metrics, { modules: { ...config.modules, reporting: false } }), null)
  assert.deepEqual(listPlatformReports(config), ['overview', 'pipeline', 'sources', 'workload', 'offers', 'interviews', 'agency', 'workforce'])
  assert.deepEqual(listPlatformReports({ modules: { reporting: true } }), ['overview', 'workload'])
})
