import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildOperationalQueue, runtimeModuleEnabled } from './runtime-overview.js'
const require = createRequire(import.meta.url)
const { defaults } = require('../../shared/ats-config.cjs')
const { moduleEnabled } = require('../../server/src/platform/authorization.js')

test('operational queue summarizes only actionable states and includes agency work when supplied', () => {
  assert.deepEqual(buildOperationalQueue({
    approvals: [{ status: 'pending' }, { status: 'approved' }],
    tasks: [{ status: 'open' }, { status: 'completed' }],
    interviews: [{ status: 'scheduled' }, { status: 'cancelled' }],
    submissions: [{ status: 'submitted' }, { status: 'placed' }],
    invoices: [{ status: 'sent' }, { status: 'paid' }],
  }), [
    { key: 'approvals', label: 'Approvals waiting', count: 1, route: 'approvals' },
    { key: 'tasks', label: 'Open tasks', count: 1, route: 'tasks' },
    { key: 'interviews', label: 'Scheduled interviews', count: 1, route: 'interviews' },
    { key: 'submissions', label: 'Submissions in progress', count: 1, route: 'submissions' },
    { key: 'invoices', label: 'Invoices to resolve', count: 1, route: 'invoices' },
  ])
})

test('operational queue hides zero counts and does not invent agency rows for corporate workspaces', () => {
  assert.deepEqual(buildOperationalQueue({
    approvals: [{ status: 'approved' }], tasks: [{ status: 'completed' }], interviews: [],
  }), [])
})

test('derived approval and feedback capabilities match backend gates for all buyer presets', () => {
  for (const preset of ['corporate', 'agency', 'startup', 'campus', 'basic']) {
    const config = defaults(preset)
    for (const kind of ['approvals', 'feedback']) assert.equal(runtimeModuleEnabled(config.modules, kind), moduleEnabled(config, kind), `${preset}/${kind}`)
  }
  assert.equal(runtimeModuleEnabled({ requisitions: false, offers: false, agency: false }, 'approvals'), false)
  assert.equal(runtimeModuleEnabled({ interviews: false }, 'feedback'), false)
})
