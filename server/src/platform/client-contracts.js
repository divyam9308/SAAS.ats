'use strict'

const { now, uid } = require('./database')

const FEE_TYPES = new Set(['percentage', 'fixed', 'retainer', 'success_fee'])

class ClientContractError extends Error {
  constructor(message, status = 422) { super(message); this.name = 'ClientContractError'; this.status = status }
}

function dateOnly(value, label) {
  if (value == null || value === '') return null
  const text = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString() : '') : String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) throw new ClientContractError(`${label} must be an ISO date.`)
  const date = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : text)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text.slice(0, 10)) throw new ClientContractError(`${label} must be a valid ISO date.`)
  return text.slice(0, 10)
}

function calculateContractExpiry(effectiveDate, durationDays) {
  const start = dateOnly(effectiveDate, 'Effective date')
  const days = Number(durationDays)
  if (!start) throw new ClientContractError('An effective date is required to calculate expiry.')
  if (!Number.isInteger(days) || days < 0) throw new ClientContractError('Contract duration must be a non-negative whole number of days.')
  const expiry = new Date(`${start}T00:00:00.000Z`)
  expiry.setUTCDate(expiry.getUTCDate() + days)
  return expiry.toISOString().slice(0, 10)
}

function normalizeTerms(input = {}, current = {}) {
  const effectiveDate = dateOnly(input.effectiveDate ?? current.effectiveDate, 'Effective date')
  if (!effectiveDate) throw new ClientContractError('An effective date is required.')
  const durationGiven = Object.hasOwn(input, 'durationDays')
  const expiryInput = Object.hasOwn(input, 'expiryDate') ? input.expiryDate : current.expiryDate
  const expiryDate = durationGiven
    ? calculateContractExpiry(effectiveDate, input.durationDays)
    : dateOnly(expiryInput, 'Expiry date')
  if (expiryDate && expiryDate < effectiveDate) throw new ClientContractError('Expiry date cannot be before the effective date.')

  const feeType = String(input.feeType ?? current.feeType ?? '').trim().toLowerCase()
  if (!FEE_TYPES.has(feeType)) throw new ClientContractError(`Fee type must be one of: ${[...FEE_TYPES].join(', ')}.`)
  const rawRate = input.feeRate ?? current.feeRate
  if (rawRate === '' || rawRate == null || !Number.isFinite(Number(rawRate)) || Number(rawRate) < 0) {
    throw new ClientContractError('Fee rate must be a non-negative number.')
  }
  const feeRate = Number(rawRate)
  if (feeType === 'percentage' && feeRate > 100) throw new ClientContractError('Percentage fee rate cannot exceed 100.')
  const guarantee = Number(input.replacementGuaranteeDays ?? current.replacementGuaranteeDays ?? 0)
  if (!Number.isInteger(guarantee) || guarantee < 0) throw new ClientContractError('Replacement guarantee must be a non-negative whole number of days.')
  const documentValue = input.documentReference ?? current.documentReference ?? null
  if (documentValue != null && (typeof documentValue !== 'string' || documentValue.trim().length > 2000)) {
    throw new ClientContractError('Document reference must be text of 2,000 characters or fewer.')
  }
  return {
    effectiveDate,
    expiryDate: expiryDate || null,
    feeType,
    feeRate,
    replacementGuaranteeDays: guarantee,
    documentReference: documentValue ? documentValue.trim() : null
  }
}

function resolveContractStatus(contract, asOf = new Date()) {
  if (contract?.status === 'terminated') return 'terminated'
  const today = dateOnly(asOf, 'Status date')
  const expiry = dateOnly(contract?.expiryDate, 'Expiry date')
  if (expiry && expiry < today) return 'expired'
  return contract?.status === 'expired' ? 'expired' : 'active'
}

function requireClient(client) {
  if (!client || typeof client !== 'object' || !client.id) throw new ClientContractError('A persisted client record is required.', 404)
}
function requireContract(client, contractId) {
  const index = (Array.isArray(client.contracts) ? client.contracts : []).findIndex(contract => contract.id === contractId)
  if (index < 0) throw new ClientContractError('Client contract was not found.', 404)
  return index
}
function actorFor(context = {}) { return context.actor || context.user?.id || 'system' }
function persistClient(store, client, contracts, actor) {
  if (!store || typeof store.put !== 'function') throw new ClientContractError('A writable client store is required.', 500)
  return store.put('clients', { ...client, contracts }, actor)
}
function auditEvent(action, client, contract, details, context) {
  const event = { action, clientId: client.id, contractId: contract.id, at: context.at || now(), actor: actorFor(context), details }
  context.audit?.(action, client.id, { contractId: contract.id, ...details })
  return event
}
function versionSnapshot(terms, version, actor, at) {
  return { version, effectiveDate: terms.effectiveDate, expiryDate: terms.expiryDate, feeType: terms.feeType, feeRate: terms.feeRate, replacementGuaranteeDays: terms.replacementGuaranteeDays, documentReference: terms.documentReference, changedAt: at, changedBy: actor }
}

/** Add a contract to the client's nested contract list (never creates a client). */
function createClientContract(store, client, input = {}, context = {}) {
  requireClient(client)
  const actor = actorFor(context)
  const at = context.at ? new Date(context.at).toISOString() : now()
  const terms = normalizeTerms(input)
  const status = input.status || 'active'
  if (!['active', 'expired', 'terminated'].includes(status)) throw new ClientContractError('Contract status must be active, expired, or terminated.')
  const contract = {
    id: context.contractId || uid('contract'), version: 1, status, ...terms,
    createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor,
    versions: [versionSnapshot(terms, 1, actor, at)],
    history: [{ type: 'created', version: 1, status, at, actor }]
  }
  contract.status = resolveContractStatus(contract, context.asOf || at)
  const updatedClient = persistClient(store, client, [...(Array.isArray(client.contracts) ? client.contracts : []), contract], actor)
  const event = auditEvent('client.contract.created', client, contract, { version: 1, status: contract.status }, context)
  return { client: updatedClient, contract, auditEvent: event }
}

/** Update terms by creating a new immutable terms snapshot/version. */
function updateClientContract(store, client, contractId, changes = {}, context = {}) {
  requireClient(client)
  if (Object.hasOwn(changes, 'status')) throw new ClientContractError('Use setClientContractStatus to change contract status.')
  const contracts = Array.isArray(client.contracts) ? client.contracts : []
  const index = requireContract(client, contractId)
  const prior = contracts[index]
  const actor = actorFor(context)
  const at = context.at ? new Date(context.at).toISOString() : now()
  const terms = normalizeTerms(changes, prior)
  const version = Number(prior.version || 1) + 1
  const updated = {
    ...prior, ...terms, version,
    status: resolveContractStatus({ ...prior, ...terms }, context.asOf || at),
    updatedAt: at, updatedBy: actor,
    versions: [...(Array.isArray(prior.versions) ? prior.versions : [versionSnapshot(prior, Number(prior.version || 1), prior.createdBy || 'system', prior.createdAt || at)]), versionSnapshot(terms, version, actor, at)],
    history: [...(Array.isArray(prior.history) ? prior.history : []), { type: 'terms_updated', version, at, actor }]
  }
  const next = contracts.slice(); next[index] = updated
  const updatedClient = persistClient(store, client, next, actor)
  const event = auditEvent('client.contract.updated', client, updated, { version, fields: Object.keys(changes) }, context)
  return { client: updatedClient, contract: updated, auditEvent: event }
}

function setClientContractStatus(store, client, contractId, status, context = {}) {
  requireClient(client)
  if (!['active', 'expired', 'terminated'].includes(status)) throw new ClientContractError('Contract status must be active, expired, or terminated.')
  const contracts = Array.isArray(client.contracts) ? client.contracts : []
  const index = requireContract(client, contractId)
  const prior = contracts[index]
  const actor = actorFor(context)
  const at = context.at ? new Date(context.at).toISOString() : now()
  if (status === 'active' && resolveContractStatus({ ...prior, status }, context.asOf || at) === 'expired') {
    throw new ClientContractError('An expired contract cannot be reactivated; update its dates first.', 409)
  }
  const effectiveStatus = status === 'active' ? 'active' : status
  if (prior.status === effectiveStatus) return { client, contract: prior, auditEvent: null }
  const updated = {
    ...prior, status: effectiveStatus, updatedAt: at, updatedBy: actor,
    history: [...(Array.isArray(prior.history) ? prior.history : []), { type: 'status_changed', from: prior.status, to: effectiveStatus, at, actor }]
  }
  const next = contracts.slice(); next[index] = updated
  const updatedClient = persistClient(store, client, next, actor)
  const event = auditEvent('client.contract.status_changed', client, updated, { from: prior.status, to: effectiveStatus }, context)
  return { client: updatedClient, contract: updated, auditEvent: event }
}

/** Persist automatic expiry transitions so the status change is reviewable. */
function expireClientContracts(store, client, { asOf = new Date(), ...context } = {}) {
  requireClient(client)
  const actor = actorFor(context)
  const contracts = (Array.isArray(client.contracts) ? client.contracts : []).map(contract => {
    if (contract.status !== 'active' || resolveContractStatus(contract, asOf) !== 'expired') return contract
    const at = context.at ? new Date(context.at).toISOString() : now()
    const updated = { ...contract, status: 'expired', updatedAt: at, updatedBy: actor, history: [...(Array.isArray(contract.history) ? contract.history : []), { type: 'status_changed', from: 'active', to: 'expired', at, actor, reason: 'expiry_date_reached' }] }
    auditEvent('client.contract.status_changed', client, updated, { from: 'active', to: 'expired', reason: 'expiry_date_reached' }, context)
    return updated
  })
  if (contracts.every((contract, index) => contract === client.contracts?.[index])) return { client, contracts, changed: false }
  return { client: persistClient(store, client, contracts, actor), contracts, changed: true }
}

module.exports = {
  ClientContractError,
  calculateContractExpiry,
  normalizeTerms,
  resolveContractStatus,
  createClientContract,
  updateClientContract,
  setClientContractStatus,
  expireClientContracts
}
