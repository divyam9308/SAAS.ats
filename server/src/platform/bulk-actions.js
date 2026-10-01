'use strict'

const DEFAULT_MAX_BATCH = 100
const KINDS = new Set(['candidates', 'jobs', 'applications', 'tasks'])
const ACTIONS = new Set(['addTags', 'assignOwner', 'archive', 'moveStage'])

class BulkActionError extends Error {
  constructor(message, status = 400, code = 'BULK_ACTION_INVALID') {
    super(message)
    this.name = 'BulkActionError'
    this.status = status
    this.code = code
  }
}

function validateIds(ids, maxBatch) {
  if (!Array.isArray(ids) || ids.length === 0) throw new BulkActionError('Provide at least one record ID.')
  if (!Number.isInteger(maxBatch) || maxBatch < 1) throw new TypeError('maxBatch must be a positive integer.')
  if (ids.length > maxBatch) throw new BulkActionError(`A bulk action can include at most ${maxBatch} records.`, 413, 'BULK_LIMIT_EXCEEDED')
  if (ids.some(id => typeof id !== 'string' || !id.trim())) throw new BulkActionError('Record IDs must be non-empty strings.')
  if (new Set(ids).size !== ids.length) throw new BulkActionError('Duplicate record IDs are not allowed.')
}

function makeChange(action, record, payload, actor, workflow) {
  if (action === 'addTags') {
    if (!Array.isArray(record.tags)) throw new BulkActionError(`Record ${record.id} does not support tags.`, 422, 'BULK_UNSUPPORTED')
    const tags = [...new Set((Array.isArray(payload.tags) ? payload.tags : [payload.tag]).filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim()))]
    if (!tags.length) throw new BulkActionError('Provide at least one non-empty tag.')
    return { patch: { tags: [...new Set([...record.tags, ...tags])] }, audit: { action, tags } }
  }
  if (action === 'assignOwner') {
    if (typeof payload.ownerId !== 'string' || !payload.ownerId.trim()) throw new BulkActionError('ownerId must be a non-empty string.')
    const field = ({ candidates: 'ownerId', jobs: 'recruiterId', applications: 'recruiterId', tasks: 'assigneeId' })[record.__kind]
    return { patch: { [field]: payload.ownerId }, audit: { action, ownerId: payload.ownerId } }
  }
  if (action === 'archive') {
    if (record.archivedAt) throw new BulkActionError(`Record ${record.id} is already archived.`, 409, 'BULK_CONFLICT')
    return { patch: { archivedAt: new Date().toISOString(), archivedBy: actor.id }, audit: { action } }
  }
  if (action === 'moveStage') {
    if (record.__kind !== 'applications') throw new BulkActionError('Stage moves are supported only for applications.', 422, 'BULK_UNSUPPORTED')
    if (typeof payload.stage !== 'string' || !payload.stage.trim()) throw new BulkActionError('stage must be a non-empty string.')
    if (typeof workflow?.validateMove !== 'function') throw new BulkActionError('A workflow transition validator is required for stage moves.', 500, 'BULK_WORKFLOW_REQUIRED')
    const transition = workflow.validateMove(record, payload.stage, actor)
    if (!transition) throw new BulkActionError(`Stage move is not valid for application ${record.id}.`, 409, 'BULK_INVALID_TRANSITION')
    // The plan intentionally carries a transition descriptor only. The executor must
    // apply it through workflow.move; this module never writes the stage itself.
    return { workflowTransition: transition, audit: { action, from: record.stage, to: payload.stage } }
  }
}

/**
 * Build and validate a complete operation before handing it to the injected executor.
 * Required adapters: loadRecord(kind,id), canAccess(actor,record),
 * canPerform(actor,kind,action,record,payload), execute(plan). `execute` owns the
 * transaction and persistence; it must reject unless it can commit every operation.
 * For moveStage, execute must call workflow.move(record, target, actor, descriptor)
 * and persist that workflow result within the same transaction.
 */
async function bulkAction({ kind, ids, action, payload = {}, actor, adapters, maxBatch = DEFAULT_MAX_BATCH }) {
  if (!KINDS.has(kind)) throw new BulkActionError('Bulk actions are not supported for this record type.')
  if (!ACTIONS.has(action)) throw new BulkActionError('Unsupported bulk action.')
  if (!actor?.id) throw new BulkActionError('An authenticated actor is required.', 401, 'BULK_UNAUTHENTICATED')
  if (!adapters || typeof adapters.loadRecord !== 'function' || typeof adapters.canAccess !== 'function' || typeof adapters.canPerform !== 'function' || typeof adapters.execute !== 'function') {
    throw new TypeError('loadRecord, canAccess, canPerform and execute adapters are required.')
  }
  validateIds(ids, maxBatch)

  const operations = []
  for (const id of ids) {
    const record = await adapters.loadRecord(kind, id)
    if (!record) throw new BulkActionError(`Record ${id} was not found.`, 404, 'BULK_NOT_FOUND')
    const scopedRecord = { ...record, __kind: kind }
    if (!await adapters.canAccess(actor, scopedRecord)) throw new BulkActionError(`Access denied for record ${id}.`, 403, 'BULK_FORBIDDEN')
    if (!await adapters.canPerform(actor, kind, action, scopedRecord, payload)) throw new BulkActionError(`Action denied for record ${id}.`, 403, 'BULK_FORBIDDEN')
    const change = makeChange(action, scopedRecord, payload, actor, adapters.workflow)
    operations.push({ kind, id, action, patch: change.patch, workflowTransition: change.workflowTransition, audit: { type: 'bulk.action', actorId: actor.id, kind, recordId: id, ...change.audit } })
  }

  const plan = Object.freeze({ kind, action, actorId: actor.id, operations: Object.freeze(operations.map(Object.freeze)) })
  return adapters.execute(plan)
}

module.exports = { bulkAction, BulkActionError, DEFAULT_MAX_BATCH }
