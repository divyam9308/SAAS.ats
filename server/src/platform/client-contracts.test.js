'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ClientContractError,
  calculateContractExpiry,
  resolveContractStatus,
  createClientContract,
  updateClientContract,
  setClientContractStatus,
  expireClientContracts
} = require('./client-contracts')

function memoryStore() {
  const rows = new Map()
  return {
    get(kind, id) { return structuredClone(rows.get(`${kind}:${id}`) || null) },
    put(kind, row, actor) {
      const saved = { ...structuredClone(row), lastActor: actor }
      rows.set(`${kind}:${row.id}`, saved)
      return structuredClone(saved)
    }
  }
}
function expectStatus(fn, status = 422) {
  assert.throws(fn, error => error instanceof ClientContractError && error.status === status)
}

test('calculates expiry and resolves active, expired, and terminated status by business date', () => {
  assert.equal(calculateContractExpiry('2026-01-31', 30), '2026-03-02')
  expectStatus(() => calculateContractExpiry('2026-01-01', -1))
  assert.equal(resolveContractStatus({ status: 'active', expiryDate: '2026-06-01' }, '2026-06-01'), 'active')
  assert.equal(resolveContractStatus({ status: 'active', expiryDate: '2026-06-01' }, '2026-06-02'), 'expired')
  assert.equal(resolveContractStatus({ status: 'terminated', expiryDate: '2026-01-01' }, '2026-06-02'), 'terminated')
})

test('creates a versioned nested contract on a persisted client and returns audit-ready details', () => {
  const store = memoryStore()
  const client = { id: 'client-1', name: 'Northstar', contracts: [] }
  const audit = []
  const result = createClientContract(store, client, {
    effectiveDate: '2026-01-01', durationDays: 365, feeType: 'percentage', feeRate: '18', replacementGuaranteeDays: 90,
    documentReference: 'contracts/northstar-v1.pdf'
  }, { actor: 'user-1', contractId: 'contract-1', at: '2026-01-01T10:00:00.000Z', audit: (...args) => audit.push(args) })
  assert.equal(result.client.id, 'client-1')
  assert.equal(result.client.contracts.length, 1)
  assert.equal(result.contract.version, 1)
  assert.equal(result.contract.expiryDate, '2027-01-01')
  assert.equal(result.contract.feeRate, 18)
  assert.equal(result.contract.replacementGuaranteeDays, 90)
  assert.equal(result.contract.documentReference, 'contracts/northstar-v1.pdf')
  assert.equal(result.contract.versions[0].version, 1)
  assert.equal(result.auditEvent.action, 'client.contract.created')
  assert.equal(audit[0][0], 'client.contract.created')
})

test('term changes create immutable snapshots and status changes remain auditable without fake client records', () => {
  const store = memoryStore()
  const original = { id: 'client-1', name: 'Northstar' }
  const created = createClientContract(store, original, {
    effectiveDate: '2026-01-01', expiryDate: '2026-12-31', feeType: 'fixed', feeRate: 12000
  }, { actor: 'owner', contractId: 'c1', at: '2026-01-01T00:00:00Z' })
  const updated = updateClientContract(store, created.client, 'c1', { feeRate: 15000, replacementGuaranteeDays: 60 }, { actor: 'owner', at: '2026-02-01T00:00:00Z' })
  assert.equal(updated.contract.version, 2)
  assert.equal(updated.contract.versions.length, 2)
  assert.equal(updated.contract.versions[0].feeRate, 12000)
  assert.equal(updated.contract.versions[1].feeRate, 15000)
  const ended = setClientContractStatus(store, updated.client, 'c1', 'terminated', { actor: 'admin', at: '2026-03-01T00:00:00Z' })
  assert.equal(ended.contract.status, 'terminated')
  assert.deepEqual(ended.contract.history.map(event => event.type), ['created', 'terms_updated', 'status_changed'])
  assert.equal(store.get('clients', 'client-1').contracts[0].status, 'terminated')
  assert.equal(store.get('clients', 'contract-1'), null)
})

test('validation rejects invalid terms, status updates, and reactivation after expiry', () => {
  const store = memoryStore()
  const client = { id: 'client-1' }
  expectStatus(() => createClientContract(store, client, { effectiveDate: 'bad', feeType: 'fixed', feeRate: 100 }))
  expectStatus(() => createClientContract(store, client, { effectiveDate: '2026-02-01', expiryDate: '2026-01-31', feeType: 'fixed', feeRate: 100 }))
  expectStatus(() => createClientContract(store, client, { effectiveDate: '2026-01-01', feeType: 'percentage', feeRate: 101 }))
  const contract = createClientContract(store, client, {
    effectiveDate: '2026-01-01', expiryDate: '2026-01-31', feeType: 'fixed', feeRate: 100
  }, { actor: 'owner', contractId: 'c1', at: '2026-01-01T00:00:00Z' })
  expectStatus(() => updateClientContract(store, contract.client, 'c1', { status: 'terminated' }), 422)
  expectStatus(() => setClientContractStatus(store, contract.client, 'c1', 'active', { at: '2026-02-01T00:00:00Z' }), 409)
})

test('expiry sweep persists a history event only for active contracts that have expired', () => {
  const store = memoryStore()
  const client = { id: 'client-1', contracts: [
    { id: 'expired', status: 'active', effectiveDate: '2026-01-01', expiryDate: '2026-01-31', history: [] },
    { id: 'terminated', status: 'terminated', expiryDate: '2025-01-01', history: [] },
    { id: 'current', status: 'active', expiryDate: '2026-12-31', history: [] }
  ] }
  const events = []
  const result = expireClientContracts(store, client, { asOf: '2026-02-01', actor: 'system', at: '2026-02-01T00:00:00Z', audit: (...args) => events.push(args) })
  assert.equal(result.changed, true)
  assert.equal(result.client.contracts[0].status, 'expired')
  assert.deepEqual(result.client.contracts[0].history[0], {
    type: 'status_changed', from: 'active', to: 'expired', at: '2026-02-01T00:00:00.000Z', actor: 'system', reason: 'expiry_date_reached'
  })
  assert.equal(result.client.contracts[1].status, 'terminated')
  assert.equal(result.client.contracts[2].status, 'active')
  assert.equal(events.length, 1)
})
