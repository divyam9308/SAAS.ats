'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, createStore, seedCompany, RECORD_KINDS, now, uid, parseJson } = require('./database');
const { hasPermission, canAccessRecord, maskRecord, moduleEnabled } = require('./authorization');
const { action: workflowAction, WorkflowError } = require('./workflows');
const dataAdmin = require('./data-admin');
const { runAutomations, normalizeTrigger } = require('./automation');
const { computePlatformMetrics } = require('./metrics');
const { validateSavedView, applySavedView } = require('./saved-views');
const { generateInvoiceDocument } = require('./invoice-document');
const { generateOfferDocument } = require('./offer-document');
const { buildRetentionPlan } = require('./retention');
const retentionProcess = require('./retention-process');
const { getPlatformReport } = require('./report-catalog');
const publicApplicant = require('./public-applicant');
const referralsApi = require('./referrals');
const agencyGuarantee = require('./agency-guarantee');
const clientContracts = require('./client-contracts');
const talentCrm = require('./talent-crm');
const { buildWorkforcePlan } = require('./workforce-plan');
const { validateWorkforceTarget, validateWorkforceTargetEdit } = require('./workforce-target-policy');
const { bulkAction, BulkActionError, DEFAULT_MAX_BATCH } = require('./bulk-actions');
const linkedNotes = require('./linked-notes');
const { evaluateSla } = require('./sla-rules');
const { normalizeSource, configuredSource } = require('./source-options');
const { createInterviewReminderScheduler } = require('./local-scheduler');
const { InterviewCalendarError, validateInterviewSchedule, findInterviewConflict, createMockCalendarEvent, transitionMockCalendarEvent } = require('./interview-calendar');
const { activateConfiguration, syncConfiguredUsers } = require('./config-lifecycle');
const { inspectDocument, localDocumentScanner } = require('./document-security');

const COMPANY = 'local-company';
const send = (res, data, status = 200) => res.status(status).json({ data });
const fail = (res, status, error) => res.status(status).json({ error: String(error) });
const clean = value => JSON.parse(JSON.stringify(value));

const AUTOMATION_OWNER_FIELDS = new Set(['ownerId', 'recruiterId', 'hiringManagerId', 'coordinatorId', 'sourcingOwnerId', 'backupOwnerId', 'assignedTo', 'assigneeId']);
const INTERNAL_AUTOMATION_TARGETS = new Set(['automations', 'audit', 'outbox', 'savedViews']);
const GENERIC_CREATE_BLOCKED = new Set(['approvals', 'audit', 'outbox', 'automations', 'referrals', 'notifications']);
const SERVER_OWNED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'archivedAt', 'approvedAt', 'approvedBy', 'decidedAt', 'decidedBy', 'publishedAt', 'publishedBy', 'completedAt', 'completedBy', 'submittedAt', 'processedAt', 'processedBy', 'approvals', 'approvalsCompleted', 'approvalHistory', 'history', 'timeline', 'events', 'activity', 'activityLog', 'auditLog', 'checklistCompleted', 'checklistItems', 'completedChecklist', 'feedbackIds', 'calendarEvent', 'calendarEventHistory']);
const IMPORT_FIELDS = {
  candidates: new Set(['name', 'fullName', 'firstName', 'lastName', 'email', 'phone', 'source', 'currentTitle', 'company', 'currentCompany', 'skills', 'tags', 'profileUrl', 'location', 'customFields']),
  jobs: new Set(['title', 'description', 'department', 'departmentId', 'location', 'locationId', 'employmentType', 'pipelineId', 'source', 'customFields']),
  clients: new Set(['name', 'industry', 'website', 'phone', 'email', 'address', 'customFields']),
  workforceTargets: new Set(['period', 'department', 'departmentId', 'location', 'locationId', 'role', 'target', 'headcount']),
};
const AUTOMATION_TRIGGER_KINDS = {
  application: 'applications', candidate: 'candidates', job: 'jobs', task: 'tasks', requisition: 'requisitions',
  approval: 'approvals', interview: 'interviews', feedback: 'feedback', offer: 'offers', onboarding: 'onboarding',
  client: 'clients', contact: 'contacts', submission: 'submissions', placement: 'placements', invoice: 'invoices',
  referral: 'referrals', talentPool: 'talentPools', workforceTarget: 'workforceTargets',
};
function expectedAutomationTargetKind(rule, event) {
  if (rule.targetKind) return rule.targetKind;
  // These workflow events use the application/feedback record as their payload.
  if (event === 'candidate.entered_stage' || event === 'candidate.hired') return 'applications';
  if (event === 'interview.feedback_submitted') return 'feedback';
  const prefix = String(event).split('.')[0];
  return AUTOMATION_TRIGGER_KINDS[prefix] || null;
}
function automationActionAuthorization(action = {}, targetKind) {
  const type = String(action.type || action.action || '').replace(/[-\s]/g, '_').toLowerCase();
  if (action.kind && action.kind !== targetKind) throw new WorkflowError('Manual automation actions must operate on the selected target record.', 422);
  if (['create_task', 'task'].includes(type)) return ['tasks', 'create'];
  if (['create_notification', 'notification', 'notify'].includes(type)) return ['notifications', 'create'];
  if (['send_communication', 'send_email', 'send_template', 'communication'].includes(type)) return ['outbox', 'create'];
  if (['assign_owner', 'assign'].includes(type)) {
    if (action.field && !AUTOMATION_OWNER_FIELDS.has(action.field)) throw new WorkflowError('Automation assignment may only update an ownership field.', 422);
    return [targetKind, 'assign'];
  }
  if (['add_tag', 'tag', 'move_stage', 'change_stage', 'change_status', 'set_status'].includes(type)) return [targetKind, 'edit'];
  if (['request_approval', 'approval'].includes(type)) return ['approvals', 'create'];
  throw new WorkflowError(`Unsupported automation action “${type || 'unspecified'}”.`, 422);
}

function createPlatformRouter({ dbPath, dataDir = path.join(process.cwd(), 'server', 'data', 'documents'), initialConfig, seedDemo = true, documentScanner, demoAuthEnabled = process.env.NODE_ENV !== 'production' || process.env.LOCAL_DEMO_MODE === 'true', schedulerEnabled = false, schedulerIntervalMs } = {}) {
  const router = express.Router();
  const db = openDatabase(dbPath);
  const configInput = initialConfig || require('../../../shared/ats-config.cjs').defaults('corporate');
  seedCompany(db, COMPANY, configInput, { seedDemo });
  const store = createStore(db, COMPANY);
  fs.mkdirSync(dataDir, { recursive: true });
  const cfgRow = () => db.prepare('SELECT active,draft,active_version FROM platform_config WHERE company_id=?').get(COMPANY);
  const config = () => parseJson(cfgRow().active, {});
  const users = () => db.prepare('SELECT data FROM platform_users WHERE company_id=?').all(COMPANY).map(r => parseJson(r.data));
  const scanDocument = documentScanner || (process.env.NODE_ENV === 'production' ? null : localDocumentScanner);
  const publicApplicationAttempts = new Map();
  const audit = (actor, event, kind, recordId, details = {}) => {
    const createdAt = now();
    db.prepare('INSERT INTO platform_audit(company_id,actor_id,action,kind,record_id,details,created_at) VALUES(?,?,?,?,?,?,?)').run(COMPANY, actor, event, kind || null, recordId || null, JSON.stringify(details), createdAt);
    store.put('audit', { actorId: actor, action: event, kind: kind || null, recordId: recordId || null, details, createdAt }, actor);
  };
  let closed = false;
  const reminderScheduler = createInterviewReminderScheduler({ db, store, config, users, audit: (event, kind, recordId, details) => audit('system', event, kind, recordId, details), enabled: schedulerEnabled, intervalMs: schedulerIntervalMs });
  reminderScheduler.start();
  router.close = () => { if (closed) return; closed = true; reminderScheduler.stop(); db.close(); };
  const auth = (req, res, next) => {
    if (!demoAuthEnabled) return fail(res, 503, 'Production authentication adapter is not configured');
    const user = users().find(u => u.id === (req.get('x-demo-user') || 'demo-admin'));
    if (!user) return fail(res, 401, 'Unknown local demo user');
    req.actor = user; req.config = config(); next();
  };
  router.use((req, res, next) => {
    const localUser = users().find(u => u.id === (req.get('x-demo-user') || 'demo-admin'));
    req.actor = localUser || { id: 'public', roleId: 'public' };
    req.config = config();
    req.localsUsers = users();
    req.localsAudit = audit;
    if (req.path.startsWith('/public/')) return next();
    return auth(req, res, next);
  });
  const permitted = (req, res, module, verb) => {
    if (module === 'savedViews' && req.config.savedViews?.enabled === false) { fail(res, 403, 'Saved views are disabled'); return false; }
    if (!moduleEnabled(req.config, module)) { fail(res, 403, `Module ${module} is disabled`); return false; }
    if (!hasPermission(req.actor, `${module}:${verb}`, req.config)) { fail(res, 403, `Missing permission ${module}:${verb}`); return false; }
    return true;
  };
  const readable = (req, record, kind) => {
    if (kind === 'savedViews') {
      const shared = record.visibility === 'shared' && req.config.savedViews?.allowShared !== false;
      if (record.visibility === 'private' && record.ownerId !== req.actor.id) return false;
      if (!shared && record.ownerId !== req.actor.id) return false;
      return Boolean(req.config.savedViews?.enabled !== false && record.kind && moduleEnabled(req.config, record.kind) && hasPermission(req.actor, `${record.kind}:view`, req.config));
    }
    let related = { ...record };
    if (kind === 'referrals') related.ownerId = record.referrerId;
    const role = req.config.roles?.find(r => r.id === req.actor.roleId);
    const scope = role?.scope || 'all';
    if (kind === 'applications') {
      const job = record.jobId && store.get('jobs', record.jobId);
      if (job) related = { ...related, recruiterId: related.recruiterId || related.ownerId || job.recruiterId, hiringManagerId: related.hiringManagerId || job.hiringManagerId, departmentId: related.departmentId || job.departmentId, department: related.department || job.department, locationId: related.locationId || job.locationId, location: related.location || job.location };
      else return false;
    } else if (kind === 'candidates') {
      const apps = store.list('applications').filter(a => a.candidateId === record.id);
      const linked = apps.map(app => ({ app, job: store.get('jobs', app.jobId) })).filter(x => x.job);
      if (apps.length && linked.length !== apps.length) return false;
      if (scope === 'owned') {
        const owned = record.ownerId === req.actor.id || linked.some(({ app, job }) => [app.ownerId, app.recruiterId, app.hiringManagerId, job.recruiterId, job.hiringManagerId].includes(req.actor.id));
        if (!owned) return false;
      } else if (scope === 'department' && ![record.departmentId, record.department].some(v => v && [req.actor.departmentId, req.actor.department].includes(v)) && !linked.some(({ job }) => [job.departmentId, job.department].some(v => v && [req.actor.departmentId, req.actor.department].includes(v)))) return false;
      else if (scope === 'location' && ![record.locationId, record.location].some(v => v && [req.actor.locationId, req.actor.location].includes(v)) && !linked.some(({ job }) => [job.locationId, job.location].some(v => v && [req.actor.locationId, req.actor.location].includes(v)))) return false;
      if (!related.ownerId && linked.length) related = { ...related, ownerId: linked[0].app.ownerId || linked[0].job.recruiterId, departmentId: linked[0].job.departmentId, department: linked[0].job.department, locationId: linked[0].job.locationId, location: linked[0].job.location };
    }
    return canAccessRecord(req.actor, { ...related, __kind: kind }, req.config, { get: (linkedKind, linkedId) => store.get(linkedKind, linkedId) });
  };
  const masked = (req, row) => maskRecord(row, req.actor, req.config);
  const projectPool = (req, pool) => ({ ...pool, members: (Array.isArray(pool.members) ? pool.members : []).flatMap(member => {
    const candidate = member.candidateId && store.get('candidates', member.candidateId);
    if (!candidate || !readable(req, candidate, 'candidates') || !talentCrm.consentGranted(candidate)) return [];
    const projection = {};
    for (const field of ['id', 'name', 'fullName', 'firstName', 'lastName', 'title', 'currentTitle', 'skills', 'location', 'city', 'country', 'updatedAt', 'lastActivityAt']) if (candidate[field] !== undefined) projection[field] = candidate[field];
    return [{ ...member, candidate: projection }];
  }) });
  const visibleRecord = (req, kind, row) => masked(req, kind === 'talentPools' ? projectPool(req, row) : row);
  const visibleList = (req, kind) => store.list(kind).filter(row => readable(req, row, kind)).map(row => visibleRecord(req, kind, row));
  const noteParent = note => {
    const kind = note.relatedKind || (note.candidateId ? 'candidates' : note.jobId ? 'jobs' : note.applicationId ? 'applications' : note.clientId ? 'clients' : note.offerId ? 'offers' : null);
    const id = note.relatedId || note.candidateId || note.jobId || note.applicationId || note.clientId || note.offerId;
    return kind && id ? { kind, id, record: store.get(kind, id) } : null;
  };
  const noteReadable = (req, note) => {
    const parent = noteParent(note);
    return Boolean(parent?.record && readable(req, parent.record, parent.kind) && linkedNotes.canReadLinkedNote(note, req.actor, { isAdmin: hasPermission(req.actor, 'notes:administer', req.config) }));
  };
  const visibleNotes = req => store.list('notes').filter(note => noteReadable(req, note)).map(masked.bind(null, req));

  // Client contracts are nested under an existing client and can only be changed
  // through these versioned, audited routes. The generic client record endpoints
  // deliberately cannot create or edit the nested collection.
  const clientContractsEnabled = req => req.config.modules?.agency === true && req.config.agency?.contracts === true;
  const canManageClientContracts = (req, res) => {
    if (!clientContractsEnabled(req)) { fail(res, 403, 'Agency client contracts are disabled'); return false; }
    if (!moduleEnabled(req.config, 'clients')) { fail(res, 403, 'Module clients is disabled'); return false; }
    if (!hasPermission(req.actor, 'clients:edit', req.config) && !hasPermission(req.actor, 'organization:administer', req.config)) {
      fail(res, 403, 'Missing permission clients:edit'); return false;
    }
    return true;
  };
  const readableContractClient = (req, res, id) => {
    const client = store.get('clients', id);
    if (!client || !readable(req, client, 'clients')) { fail(res, 404, 'Client not found or outside your scope'); return null; }
    return client;
  };
  const validateContractDocumentReference = (req, client, reference) => {
    if (!reference) return;
    // References may be opaque external paths. When a reference resolves to a
    // platform document, however, it must belong to this client.
    const documents = store.list('documents');
    const match = documents.find(document => [document.id, document.storageName, document.documentReference].includes(reference));
    if (!match) return;
    const linkedClientId = match.clientId || (match.relatedKind === 'clients' ? match.relatedId : null);
    if (linkedClientId !== client.id || !readable(req, match, 'documents')) {
      throw new clientContracts.ClientContractError('Contract document must belong to this client and be within your document scope.', 422);
    }
  };
  const contractContext = (req, client) => ({
    actor: req.actor.id,
    config: req.config,
    defaultGuaranteeDays: req.config.agency?.guarantees === false ? 0 : req.config.agency?.defaultGuaranteeDays,
    audit: (event, clientId, details) => audit(req.actor.id, event, 'clients', clientId, details),
  });
  const activeClientContract = client => {
    const today = new Date().toISOString().slice(0, 10);
    return (client?.contracts || [])
      .filter(contract => contract.status === 'active' && contract.effectiveDate <= today && (!contract.expiryDate || contract.expiryDate >= today))
      .sort((left, right) => String(right.effectiveDate).localeCompare(String(left.effectiveDate)) || Number(right.version || 1) - Number(left.version || 1))[0] || null;
  };
  const applyClientContractToPlacement = (placement, client, config) => {
    const contract = activeClientContract(client);
    if (!contract) return placement;
    const terms = {
      contractId: contract.id,
      contractVersion: contract.version || 1,
      feeType: contract.feeType,
      feeRate: contract.feeRate,
      guaranteeDays: contract.replacementGuaranteeDays,
    };
    let fee = placement.fee ?? placement.placementFee;
    if (fee == null && contract.feeType === 'fixed') fee = contract.feeRate;
    if (fee == null && contract.feeType === 'percentage') {
      const candidate = placement.candidateId && store.get('candidates', placement.candidateId);
      const basis = Number(placement.compensation ?? placement.salary ?? placement.baseSalary ?? candidate?.currentSalary ?? candidate?.salary);
      if (Number.isFinite(basis) && basis >= 0) fee = Math.round(basis * contract.feeRate) / 100;
    }
    if (fee != null) terms.fee = fee;
    const guaranteed = { ...placement, ...terms };
    if (config?.agency?.guarantees === false) return { ...guaranteed, guaranteeDays: 0, guaranteeExpiry: null };
    const expiry = agencyGuarantee.calculateGuaranteeExpiry(guaranteed, config);
    return expiry ? { ...guaranteed, guaranteeExpiry: expiry } : guaranteed;
  };
  const contractInput = (req, { create = false } = {}) => {
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new clientContracts.ClientContractError('Body must contain a data object.', 400);
    const allowed = new Set(['effectiveDate', 'expiryDate', 'durationDays', 'feeType', 'feeRate', 'replacementGuaranteeDays', 'documentReference']);
    if (Object.keys(data).some(key => !allowed.has(key))) throw new clientContracts.ClientContractError('Contract input contains unsupported or server-managed fields.', 400);
    const enabledFeeTypes = req.config.agency?.feeTypes;
    if (data.feeType != null && Array.isArray(enabledFeeTypes) && !enabledFeeTypes.includes(String(data.feeType).toLowerCase())) {
      throw new clientContracts.ClientContractError('Fee type is not enabled by agency configuration.');
    }
    if (req.config.agency?.guarantees === false && Number(data.replacementGuaranteeDays || 0) !== 0) {
      throw new clientContracts.ClientContractError('Replacement guarantees are disabled.');
    }
    if (create && data.replacementGuaranteeDays == null) data.replacementGuaranteeDays = contractContext(req).defaultGuaranteeDays ?? 0;
    return data;
  };

  router.post('/clients/:id/contracts', (req, res) => {
    if (!canManageClientContracts(req, res)) return;
    const client = readableContractClient(req, res, req.params.id); if (!client) return;
    let transactionOpen = false;
    try {
      const data = contractInput(req, { create: true });
      validateContractDocumentReference(req, client, data.documentReference);
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const result = clientContracts.createClientContract(store, client, data, contractContext(req, client));
      enqueue(req, store, 'clients', 'updated', result.client);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, result.contract), 201);
    } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, error.status || 422, error.message); }
  });
  router.patch('/clients/:id/contracts/:contractId', (req, res) => {
    if (!canManageClientContracts(req, res)) return;
    const client = readableContractClient(req, res, req.params.id); if (!client) return;
    let transactionOpen = false;
    try {
      const data = contractInput(req);
      validateContractDocumentReference(req, client, data.documentReference);
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const result = clientContracts.updateClientContract(store, client, req.params.contractId, data, contractContext(req, client));
      enqueue(req, store, 'clients', 'updated', result.client);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, result.contract));
    } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, error.status || 422, error.message); }
  });
  router.post('/clients/:id/contracts/:contractId/status', (req, res) => {
    if (!canManageClientContracts(req, res)) return;
    const client = readableContractClient(req, res, req.params.id); if (!client) return;
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || typeof data.status !== 'string') return fail(res, 400, 'Status action accepts only a status value in data');
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const result = clientContracts.setClientContractStatus(store, client, req.params.contractId, data.status, contractContext(req, client));
      if (result.auditEvent) enqueue(req, store, 'clients', 'updated', result.client);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, result.contract));
    } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, error.status || 422, error.message); }
  });

  router.post('/bulk/:kind', async (req, res) => {
    const { kind } = req.params;
    const input = req.body?.data;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['ids', 'action', 'payload'].includes(key))) return fail(res, 400, 'Body must contain ids, action, and optional payload in data');
    const payload = input.payload === undefined ? {} : input.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(res, 400, 'payload must be an object');
    const actionPermissions = { addTags: 'edit', assignOwner: 'assign', archive: 'delete', moveStage: 'edit' };
    const verb = actionPermissions[input.action];
    if (!verb) return fail(res, 400, 'Unsupported bulk action');
    if (!permitted(req, res, kind, verb)) return;
    let transactionOpen = false;
    try {
      const result = await bulkAction({ kind, ids: input.ids, action: input.action, payload, actor: req.actor, maxBatch: req.config.bulkActions?.maxBatch || DEFAULT_MAX_BATCH,
        adapters: {
          loadRecord: (recordKind, id) => store.get(recordKind, id),
          canAccess: (actor, record) => readable(req, record, record.__kind),
          canPerform: (actor, recordKind, actionName, record, actionPayload) => {
            if (!moduleEnabled(req.config, recordKind) || !hasPermission(actor, `${recordKind}:${actionPermissions[actionName]}`, req.config)) return false;
            if (actionName === 'assignOwner') return Boolean(users().some(user => user.id === actionPayload.ownerId));
            return true;
          },
          workflow: {
            validateMove: (record, target) => {
              const { validateTransition } = require('./workflows');
              return validateTransition(req.config, { ...record, __actorRole: req.actor.roleId || req.actor.role }, target, store);
            }
          },
          execute: plan => {
            db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
            const rows = [];
            for (const operation of plan.operations) {
              const before = store.get(kind, operation.id);
              let row;
              if (operation.action === 'archive') row = store.archive(kind, operation.id);
              else if (operation.action === 'moveStage') {
                row = workflowAction(store, kind, before, 'move-stage', { stage: payload.stage }, {
                  user: req.actor, config: req.config,
                  audit: (event, targetKind, targetId, details) => audit(req.actor.id, event, targetKind, targetId, details),
                  emit: (event, eventPayload) => emitEvent(req, store, event, eventPayload), canApproveAny: false
                });
              } else row = store.put(kind, { ...before, ...operation.patch }, req.actor.id);
              if (!row) throw new BulkActionError(`Record ${operation.id} could not be changed.`, 409, 'BULK_CONFLICT');
              audit(req.actor.id, `bulk.${operation.action}`, kind, operation.id, operation.audit);
              rows.push(row);
            }
            audit(req.actor.id, 'bulk.completed', kind, null, { action: plan.action, recordIds: plan.operations.map(operation => operation.id), count: rows.length });
            db.exec('COMMIT'); transactionOpen = false;
            return { action: plan.action, kind, count: rows.length, records: rows.map(row => masked(req, row)) };
          }
        }
      });
      return send(res, result);
    } catch (error) {
      if (transactionOpen) { try { db.exec('ROLLBACK'); } catch {} }
      return fail(res, error.status || 422, error.message);
    }
  });

  const savedViewsEnabled = req => req.config.savedViews?.enabled !== false && moduleEnabled(req.config, 'savedViews');
  const validateViewForActor = (req, input) => {
    const validation = validateSavedView(input, { users: users(), allowShared: req.config.savedViews?.allowShared !== false });
    if (validation.valid && (!moduleEnabled(req.config, validation.value.kind) || !hasPermission(req.actor, `${validation.value.kind}:view`, req.config))) {
      validation.valid = false;
      validation.errors.push('You do not have permission to view this record type.');
    }
    return validation;
  };
  const canReadSavedView = (req, view) => Boolean(view && savedViewsEnabled(req) && readable(req, view, 'savedViews'));

  router.get('/saved-views', (req, res) => {
    if (!savedViewsEnabled(req)) return fail(res, 403, 'Saved views are disabled');
    const rows = store.list('savedViews').filter(view => canReadSavedView(req, view));
    send(res, rows);
  });
  router.post('/saved-views', (req, res) => {
    if (!savedViewsEnabled(req)) return fail(res, 403, 'Saved views are disabled');
    const input = req.body?.data;
    const validation = validateViewForActor(req, input);
    if (!validation.valid) return res.status(422).json({ error: 'Saved view is invalid', details: validation.errors });
    const view = store.put('savedViews', { ...validation.value, ownerId: req.actor.id }, req.actor.id);
    audit(req.actor.id, 'saved-view.created', 'savedViews', view.id, { kind: view.kind, visibility: view.visibility });
    send(res, view, 201);
  });
  router.patch('/saved-views/:id', (req, res) => {
    if (!savedViewsEnabled(req)) return fail(res, 403, 'Saved views are disabled');
    const before = store.get('savedViews', req.params.id);
    if (!before) return fail(res, 404, 'Saved view not found');
    if (before.ownerId !== req.actor.id) return fail(res, 404, 'Saved view not found');
    const input = { ...before, ...(req.body?.data || {}), id: before.id, ownerId: before.ownerId };
    const validation = validateViewForActor(req, input);
    if (!validation.valid) return res.status(422).json({ error: 'Saved view is invalid', details: validation.errors });
    const view = store.put('savedViews', { ...validation.value, ownerId: before.ownerId, id: before.id }, req.actor.id);
    audit(req.actor.id, 'saved-view.updated', 'savedViews', view.id, { kind: view.kind, visibility: view.visibility });
    send(res, view);
  });
  router.delete('/saved-views/:id', (req, res) => {
    if (!savedViewsEnabled(req)) return fail(res, 403, 'Saved views are disabled');
    const view = store.get('savedViews', req.params.id);
    if (!view || view.ownerId !== req.actor.id) return fail(res, 404, 'Saved view not found');
    store.archive('savedViews', view.id);
    audit(req.actor.id, 'saved-view.deleted', 'savedViews', view.id, { kind: view.kind });
    send(res, { id: view.id, archived: true });
  });
  router.get('/saved-views/:id/run', (req, res) => {
    if (!savedViewsEnabled(req)) return fail(res, 403, 'Saved views are disabled');
    const view = store.get('savedViews', req.params.id);
    if (!view) return fail(res, 404, 'Saved view not found');
    if (!canReadSavedView(req, view)) return fail(res, 404, 'Saved view not found');
    if (!moduleEnabled(req.config, view.kind) || !hasPermission(req.actor, `${view.kind}:view`, req.config)) return fail(res, 403, 'You do not have permission to view these records');
    const rows = applySavedView(visibleList(req, view.kind), view.filters, { actorId: req.actor.id });
    send(res, { view, rows, count: rows.length, executedAt: now() });
  });

  // The caller may select only an active, server-configured rule and a record
  // they can already read. Trigger names and action definitions always come
  // from the active configuration; request data cannot replace either.
  router.post('/automations/:id/run', (req, res) => {
    if (!permitted(req, res, 'automations', 'edit')) return;
    const rule = (req.config.automations || []).find(item => item?.id === req.params.id);
    if (!rule) return fail(res, 404, 'Configured automation not found');
    if (rule.enabled === false) return fail(res, 409, 'This automation is disabled');
    const input = req.body?.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(res, 400, 'Body must contain targetKind and targetId in data');
    if (Object.keys(input).some(key => !['targetKind', 'targetId'].includes(key))) return fail(res, 400, 'Manual runs accept only targetKind and targetId');
    const { targetKind, targetId } = input;
    if (typeof targetKind !== 'string' || !RECORD_KINDS.includes(targetKind) || INTERNAL_AUTOMATION_TARGETS.has(targetKind) || typeof targetId !== 'string' || !targetId.trim()) {
      return fail(res, 400, 'A valid targetKind and targetId are required');
    }
    if (!moduleEnabled(req.config, targetKind) || !hasPermission(req.actor, `${targetKind}:view`, req.config)) return fail(res, 403, 'You do not have permission to run this automation against that record type');
    const target = store.get(targetKind, targetId);
    if (!target || !readable(req, target, targetKind)) return fail(res, 404, 'Target record not found or outside your scope');
    const event = normalizeTrigger(rule.trigger);
    if (!event) return fail(res, 422, 'Automation has no configured trigger');
    const expectedTargetKind = expectedAutomationTargetKind(rule, event);
    if (!expectedTargetKind || !RECORD_KINDS.includes(expectedTargetKind) || INTERNAL_AUTOMATION_TARGETS.has(expectedTargetKind)) return fail(res, 422, 'Automation trigger must declare a supported target record type');
    if (targetKind !== expectedTargetKind) return fail(res, 422, `This automation trigger requires a ${expectedTargetKind} target record`);
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    if (!actions.length) return fail(res, 422, 'Automation must contain at least one action');
    try {
      for (const actionConfig of actions) {
        const [module, verb] = automationActionAuthorization(actionConfig, targetKind);
        if (!moduleEnabled(req.config, module) || !hasPermission(req.actor, `${module}:${verb}`, req.config)) {
          throw new WorkflowError(`Missing permission ${module}:${verb} required by this automation.`, 403);
        }
      }
      db.exec('BEGIN IMMEDIATE');
      const eventKey = `manual:${rule.id}:${targetKind}:${target.id}:${target.updatedAt || target.createdAt || ''}`;
      const result = runAutomations({
        store, config: req.config, actor: req.actor, users: req.localsUsers.slice(0, 100), event,
        record: { ...target, __kind: targetKind }, onlyRuleId: rule.id, executionMode: 'manual', eventKey,
        audit: (action, kind, recordId, details) => audit(req.actor.id, action, kind, recordId, details),
      });
      const matched = result.runs.some(run => run.automationId === rule.id);
      audit(req.actor.id, 'automation.manual-run-requested', targetKind, targetId, { automationId: rule.id, matched, duplicate: result.duplicate });
      db.exec('COMMIT');
      send(res, { ...result, ruleId: rule.id, targetKind, targetId, matched });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      fail(res, error.status || 422, error.message);
    }
  });

  router.get('/retention/preview', (req, res) => {
    if (!permitted(req, res, 'organization', 'administer') || !permitted(req, res, 'candidates', 'delete')) return;
    try { send(res, buildRetentionPlan(store, { config: req.config })); }
    catch (error) { fail(res, error.status || 422, error.message); }
  });

  router.post('/retention/approvals/:candidateId', (req, res) => {
    if (!permitted(req, res, 'candidates', 'delete')) return;
    const candidate = store.get('candidates', req.params.candidateId);
    if (!candidate || !readable(req, candidate, 'candidates')) return fail(res, 404, 'Candidate not found or outside your scope');
    const data = req.body?.data || {};
    if (Object.keys(data).some(key => key !== 'reason')) return fail(res, 400, 'Only a reason may be supplied');
    try {
      db.exec('BEGIN IMMEDIATE');
      const approval = retentionProcess.requestRetentionApproval(store, candidate.id, {
        actor: req.actor.id, reason: String(data.reason || 'Retention period elapsed').slice(0, 1000),
        audit: (event, kind, id, details) => audit(req.actor.id, event, kind, id, details),
      });
      db.exec('COMMIT');
      return send(res, approval, 201);
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} return fail(res, error.status || 422, error.message); }
  });
  router.post('/retention/approvals/:id/decision', (req, res) => {
    if (!permitted(req, res, 'candidates', 'approve')) return;
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => key !== 'decision')) return fail(res, 400, 'Decision accepts only approved or rejected');
    const approval = store.get('approvals', req.params.id);
    if (!approval || approval.workflow !== 'privacy-deletion' || approval.recordKind !== 'candidates') return fail(res, 404, 'Retention approval request not found');
    const candidate = store.get('candidates', approval.recordId);
    if (!candidate || !readable(req, candidate, 'candidates')) return fail(res, 404, 'Retention approval request not found');
    try {
      db.exec('BEGIN IMMEDIATE');
      const decided = retentionProcess.decideRetentionApproval(store, approval.id, {
        actor: req.actor.id, decision: data.decision,
        audit: (event, kind, id, details) => audit(req.actor.id, event, kind, id, details),
      });
      db.exec('COMMIT');
      return send(res, decided);
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} return fail(res, error.status || 422, error.message); }
  });
  router.post('/retention/process', (req, res) => {
    if (!permitted(req, res, 'organization', 'administer') || !permitted(req, res, 'candidates', 'delete')) return;
    const data = req.body?.data || {};
    const allowed = new Set(['dryRun', 'candidateIds', 'batchSize']);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.has(key))) return fail(res, 400, 'Retention accepts dryRun, candidateIds, and batchSize only');
    // A run is a batch operation, so every selected subject must be inside the
    // actor's candidate scope before the helper can mutate any of them.
    if (data.candidateIds != null && (!Array.isArray(data.candidateIds) || data.candidateIds.some(id => {
      const candidate = typeof id === 'string' && store.get('candidates', id);
      return !candidate || !readable(req, candidate, 'candidates');
    }))) return fail(res, 404, 'A selected candidate is missing or outside your scope');
    const scopedCandidateIds = data.candidateIds ?? store.list('candidates').filter(candidate => readable(req, candidate, 'candidates')).map(candidate => candidate.id);
    const afterCommit = [];
    const cleanup = dataAdmin.documentStorageCleanup(store, {
      scrubArchivedRow: (original, sanitized) => db.prepare('UPDATE platform_records SET data=? WHERE company_id=? AND kind=? AND id=?').run(JSON.stringify(sanitized), COMPANY, 'documents', original.id),
      deleteStorage: storageName => fs.rmSync(path.join(dataDir, path.basename(storageName)), { force: true }),
      afterCommit: callback => afterCommit.push(callback),
    });
    let transactionOpen = false;
    try {
      const dryRun = data.dryRun !== false;
      if (dryRun) {
        const result = retentionProcess.processRetention(store, { config: req.config, dryRun: true, candidateIds: scopedCandidateIds, batchSize: data.batchSize ?? retentionProcess.DEFAULT_BATCH_SIZE, actor: req.actor.id });
        const scopedPlanItems = result.plan.items.filter(item => scopedCandidateIds.includes(item.candidateId));
        result.plan.items = scopedPlanItems;
        result.plan.summary.candidateCount = scopedPlanItems.length;
        result.plan.summary.eligibleCount = scopedPlanItems.filter(item => item.status === 'eligible').length;
        result.plan.summary.approvalRequiredCount = scopedPlanItems.filter(item => item.status === 'approval_required').length;
        result.plan.summary.awaitingApprovalCount = scopedPlanItems.filter(item => item.status === 'awaiting_approval').length;
        result.plan.summary.blockedActiveApplicationCount = scopedPlanItems.filter(item => item.status === 'blocked_active_application').length;
        result.plan.summary.retainedCount = scopedPlanItems.filter(item => ['within_retention_period', 'needs_activity_date'].includes(item.status)).length;
        audit(req.actor.id, 'retention.previewed', 'candidates', null, { selectedCount: result.selectedCount });
        return send(res, result);
      }
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const result = retentionProcess.processRetention(store, {
        config: req.config, dryRun: false, candidateIds: scopedCandidateIds,
        batchSize: data.batchSize ?? retentionProcess.DEFAULT_BATCH_SIZE, actor: req.actor.id,
        audit: (event, kind, id, details) => audit(req.actor.id, event, kind, id, details), onDocumentArchived: cleanup,
      });
      db.exec('COMMIT'); transactionOpen = false;
      for (const callback of afterCommit) callback();
      return send(res, result);
    } catch (error) { if (transactionOpen) { try { db.exec('ROLLBACK'); } catch {} } return fail(res, error.status || 422, error.message); }
  });

  router.get('/offers/:id/document', (req, res) => {
    if (!permitted(req, res, 'offers', 'view')) return;
    const offer = store.get('offers', req.params.id);
    if (!offer || !readable(req, offer, 'offers')) return fail(res, 404, 'Offer not found');
    const role = req.config.roles?.find(item => item.id === req.actor.roleId);
    const sensitive = role?.sensitive || [];
    if (!(sensitive.includes('*') || (sensitive.includes('salary') && sensitive.includes('offerDetails')))) return fail(res, 403, 'Salary and offer detail permission is required');
    const candidate = offer.candidateId && store.get('candidates', offer.candidateId);
    const job = offer.jobId && store.get('jobs', offer.jobId);
    if (!candidate || !job || !readable(req, candidate, 'candidates') || !readable(req, job, 'jobs')) return fail(res, 404, 'Offer relations are unavailable or outside your scope');
    try {
      const document = generateOfferDocument({ offer, candidate: masked(req, candidate), job: masked(req, job), config: req.config });
      audit(req.actor.id, 'offer.document-viewed', 'offers', offer.id);
      res.set('Cache-Control', 'no-store');
      res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Disposition', `inline; filename="${document.filename}"`);
      return res.type(document.mimeType).send(document.html);
    } catch (error) { return fail(res, 422, error.message); }
  });

  router.get('/invoices/:id/document', (req, res) => {
    if (!permitted(req, res, 'invoices', 'view')) return;
    const invoice = store.get('invoices', req.params.id);
    if (!invoice || !readable(req, invoice, 'invoices')) return fail(res, 404, 'Invoice not found');
    const placement = invoice.placementId && store.get('placements', invoice.placementId);
    const client = (invoice.clientId || placement?.clientId) && store.get('clients', invoice.clientId || placement.clientId);
    if (!placement || !client || !readable(req, placement, 'placements') || !readable(req, client, 'clients')) return fail(res, 404, 'Invoice relations are unavailable');
    try {
      const candidate = placement.candidateId && store.get('candidates', placement.candidateId);
      const job = placement.jobId && store.get('jobs', placement.jobId);
      const document = generateInvoiceDocument({ invoice, placement, client, config: req.config, candidate: candidate && readable(req, candidate, 'candidates') ? masked(req, candidate) : null, job: job && readable(req, job, 'jobs') ? masked(req, job) : null });
      audit(req.actor.id, 'invoice.document-viewed', 'invoices', invoice.id);
      res.set('Cache-Control', 'no-store');
      res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.set('Content-Disposition', `inline; filename="${document.filename}"`);
      res.type(document.mimeType).send(document.html);
    } catch (error) { fail(res, error.status || 422, error.message); }
  });

  router.get('/bootstrap', (req, res) => {
    const configData = req.config;
    const actorRole = configData.roles?.find(r => r.id === req.actor.roleId) || {};
    const visibleUsers = users().map(u => ({ id: u.id, name: u.name, roleId: u.roleId, departmentId: u.departmentId, locationId: u.locationId }));
    if (!hasPermission(req.actor, 'dashboard:view', configData)) {
      const navConfig = { company: configData.company, branding: configData.branding, terminology: configData.terminology, modules: configData.modules };
      return send(res, { config: navConfig, user: req.actor, users: visibleUsers, modules: configData.modules, counts: {}, role: { id: actorRole.id, name: actorRole.name, permissions: actorRole.permissions } });
    }
    const canReadOrganization = hasPermission(req.actor, 'organization:view', configData) || hasPermission(req.actor, 'organization:administer', configData);
    const clientConfig = canReadOrganization ? configData : {
      company: configData.company, branding: configData.branding, terminology: configData.terminology, regional: configData.regional, modules: configData.modules,
      organization: { units: configData.organization?.units || [], locations: configData.organization?.locations || [] }, employmentTypes: configData.employmentTypes,
      customFields: { jobs: configData.customFields?.jobs || [], candidates: configData.customFields?.candidates || [], requisitions: configData.customFields?.requisitions || [] },
      pipelines: configData.pipelines, applicationForms: configData.applicationForms, scorecards: configData.scorecards,
      interviewPlans: configData.interviewPlans, jobTemplates: configData.jobTemplates, taxonomies: configData.taxonomies,
      roles: [actorRole], users: visibleUsers
    };
    const countObj = Object.fromEntries(RECORD_KINDS.map(kind => [kind, visibleList(req, kind).length]));
    send(res, { config: clientConfig, user: req.actor, users: visibleUsers, modules: configData.modules, counts: countObj, role: actorRole });
  });
  router.get('/records/:kind', (req, res) => {
    const { kind } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (!permitted(req, res, kind, 'view')) return;
    if (kind === 'audit') {
      const rows = db.prepare('SELECT seq AS id,actor_id AS actorId,action,kind,record_id AS recordId,details,created_at AS createdAt FROM platform_audit WHERE company_id=? ORDER BY seq DESC LIMIT 1000').all(COMPANY)
        .map(row => ({ ...row, details: parseJson(row.details, {}) }))
        .filter(row => {
          if (!row.kind || !row.recordId) return hasPermission(req.actor, 'organization:administer', req.config);
          const subject = store.get(row.kind, row.recordId, { includeArchived: true });
          return Boolean(subject && readable(req, subject, row.kind));
        })
        .map(row => ({ ...row, details: masked(req, row.details) }));
      return send(res, rows);
    }
    send(res, kind === 'notes' ? visibleNotes(req) : visibleList(req, kind));
  });
  // Talent pool membership is a candidate relationship workflow. It cannot be
  // forged through generic pool writes and every member is rechecked on read.
  router.post('/actions/talentPools/:id/members', (req, res) => {
    if (!permitted(req, res, 'talentPools', 'edit')) return;
    const pool = store.get('talentPools', req.params.id);
    if (!pool || !readable(req, pool, 'talentPools')) return fail(res, 404, 'Talent pool not found');
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['candidateId', 'followUpAt', 'note'].includes(key)) || typeof data.candidateId !== 'string') return fail(res, 400, 'Member creation accepts candidateId, followUpAt, and note');
    const candidate = store.get('candidates', data.candidateId);
    if (!candidate || !readable(req, candidate, 'candidates')) return fail(res, 404, 'Candidate not found or outside your scope');
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const updated = talentCrm.addPoolMember(pool, candidate, { actorId: req.actor.id, followUpAt: data.followUpAt, note: data.note });
      const saved = store.put('talentPools', updated, req.actor.id);
      audit(req.actor.id, 'talent-pool.member-added', 'talentPools', pool.id, { candidateId: candidate.id });
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, visibleRecord(req, 'talentPools', saved));
    } catch (e) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, e.status || 422, e.message); }
  });
  router.patch('/actions/talentPools/:id/members/:candidateId', (req, res) => {
    if (!permitted(req, res, 'talentPools', 'edit')) return;
    const pool = store.get('talentPools', req.params.id);
    const candidate = store.get('candidates', req.params.candidateId);
    if (!pool || !readable(req, pool, 'talentPools') || !candidate || !readable(req, candidate, 'candidates')) return fail(res, 404, 'Talent pool member not found');
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['followUpAt', 'note'].includes(key))) return fail(res, 400, 'Member updates accept only followUpAt and note');
    try {
      db.exec('BEGIN IMMEDIATE');
      const saved = store.put('talentPools', talentCrm.updatePoolMember(pool, candidate.id, data, { actorId: req.actor.id }), req.actor.id);
      audit(req.actor.id, 'talent-pool.member-updated', 'talentPools', pool.id, { candidateId: candidate.id });
      db.exec('COMMIT'); return send(res, visibleRecord(req, 'talentPools', saved));
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} return fail(res, e.status || 422, e.message); }
  });
  router.delete('/actions/talentPools/:id/members/:candidateId', (req, res) => {
    if (!permitted(req, res, 'talentPools', 'edit')) return;
    const pool = store.get('talentPools', req.params.id);
    const candidate = store.get('candidates', req.params.candidateId);
    if (!pool || !readable(req, pool, 'talentPools') || !candidate || !readable(req, candidate, 'candidates')) return fail(res, 404, 'Talent pool member not found');
    try {
      db.exec('BEGIN IMMEDIATE');
      const saved = store.put('talentPools', talentCrm.removePoolMember(pool, candidate.id), req.actor.id);
      audit(req.actor.id, 'talent-pool.member-removed', 'talentPools', pool.id, { candidateId: candidate.id });
      db.exec('COMMIT'); return send(res, visibleRecord(req, 'talentPools', saved));
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} return fail(res, e.status || 422, e.message); }
  });
  router.post('/actions/talentPools/:id/rediscover', (req, res) => {
    if (!permitted(req, res, 'talentPools', 'view')) return;
    const pool = store.get('talentPools', req.params.id);
    if (!pool || !readable(req, pool, 'talentPools')) return fail(res, 404, 'Talent pool not found');
    const data = req.body?.data || {};
    if (Object.keys(data).some(key => key !== 'candidateIds') || (data.candidateIds != null && (!Array.isArray(data.candidateIds) || data.candidateIds.some(id => typeof id !== 'string')))) return fail(res, 400, 'Rediscovery accepts only an optional candidateIds array');
    try {
      const candidates = (data.candidateIds || pool.members?.map(member => member.candidateId) || []).map(id => store.get('candidates', id)).filter(candidate => candidate && readable(req, candidate, 'candidates'));
      send(res, talentCrm.rediscoverPoolCandidates(pool, candidates, { candidateIds: data.candidateIds, retentionDays: req.config.privacy?.retentionDays, now: new Date() }));
    } catch (e) { fail(res, e.status || 422, e.message); }
  });

  // Guarantee state is changed only through these audited placement actions.
  const guaranteeAction = (action, fn) => router.post(`/actions/placements/:id/${action}`, (req, res) => {
    const verb = ['guarantee-approve', 'guarantee-deny', 'guarantee-review'].includes(action) ? 'approve' : 'edit';
    if (!permitted(req, res, 'placements', verb)) return;
    if (req.config.agency?.guarantees === false || req.config.agency?.guarantees?.enabled === false) return fail(res, 403, 'Agency guarantees are disabled');
    const placement = store.get('placements', req.params.id);
    if (!placement || !readable(req, placement, 'placements')) return fail(res, 404, 'Placement not found or outside your scope');
    const relatedClient = placement.clientId && store.get('clients', placement.clientId);
    if (!relatedClient || !readable(req, relatedClient, 'clients')) return fail(res, 404, 'Placement client is unavailable');
    const data = req.body?.data || {};
    const allowed = action === 'guarantee-request' || action === 'guarantee-deny' ? ['reason'] : action === 'guarantee-review' ? ['comment'] : action === 'guarantee-approve' ? ['reason'] : ['candidateId', 'jobId', 'notes'];
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) return fail(res, 400, `This action accepts only ${allowed.join(', ')}`);
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      const result = fn(req, placement, data);
      const updated = result?.placement || result;
      if (updated?.id) enqueue(req, store, 'placements', 'updated', updated);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, result?.placement ? { placement: masked(req, result.placement), submission: masked(req, result.submission) } : masked(req, result));
    } catch (e) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, e.status || 422, e.message); }
  });
  guaranteeAction('guarantee-request', (req, placement, data) => agencyGuarantee.requestGuaranteeReplacement(store, placement, data, { actor: req.actor.id, config: req.config, audit: (event, id, details) => audit(req.actor.id, event, 'placements', id, details) }));
  guaranteeAction('guarantee-review', (req, placement, data) => agencyGuarantee.startGuaranteeReview(store, placement, data, { actor: req.actor.id, config: req.config, audit: (event, id, details) => audit(req.actor.id, event, 'placements', id, details) }));
  guaranteeAction('guarantee-approve', (req, placement, data) => agencyGuarantee.decideGuaranteeReview(store, placement, 'approve', data, { actor: req.actor.id, config: req.config, audit: (event, id, details) => audit(req.actor.id, event, 'placements', id, details) }));
  guaranteeAction('guarantee-deny', (req, placement, data) => agencyGuarantee.decideGuaranteeReview(store, placement, 'deny', data, { actor: req.actor.id, config: req.config, audit: (event, id, details) => audit(req.actor.id, event, 'placements', id, details) }));
  guaranteeAction('guarantee-replacement', (req, placement, data) => {
    if (!moduleEnabled(req.config, 'submissions') || !hasPermission(req.actor, 'submissions:create', req.config)) throw new WorkflowError('Missing permission submissions:create', 403);
    if (Object.keys(data).some(key => !['candidateId', 'jobId', 'notes'].includes(key))) throw new WorkflowError('Replacement accepts only candidateId, jobId, and notes.', 400);
    const candidate = data.candidateId && store.get('candidates', data.candidateId);
    const job = data.jobId && store.get('jobs', data.jobId);
    if (!candidate || !readable(req, candidate, 'candidates') || !job || !readable(req, job, 'jobs')) throw new WorkflowError('Replacement candidate and job must be readable.', 404);
    if ((job.clientId || job.agencyClientId) !== placement.clientId) throw new WorkflowError('Replacement job must belong to the original client.', 422);
    return agencyGuarantee.submitReplacement(store, placement, { candidateId: candidate.id, jobId: job.id, clientId: placement.clientId, notes: data.notes, status: 'submitted' }, { actor: req.actor.id, config: req.config, audit: (event, id, details) => audit(req.actor.id, event, 'placements', id, details) });
  });
  router.post('/records/:kind', (req, res) => {
    const { kind } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (kind === 'savedViews') return fail(res, 400, 'Use /saved-views to create an ownership-scoped view');
    if (kind === 'clients' && Object.hasOwn(req.body?.data || {}, 'contracts')) return fail(res, 400, 'Client contracts must be created through /clients/:id/contracts');
    if (GENERIC_CREATE_BLOCKED.has(kind) && kind !== 'approvals') return fail(res, 400, `Use the dedicated workflow to create ${kind} records`);
    if (!permitted(req, res, kind, 'create')) return;
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(res, 400, 'Body must contain a data object');
    if (kind === 'notes') {
      const input = { ...data };
      if (!input.relatedKind || !input.relatedId) {
        const aliases = [['candidateId', 'candidates'], ['jobId', 'jobs'], ['applicationId', 'applications'], ['clientId', 'clients'], ['offerId', 'offers']].filter(([field]) => input[field]);
        if (aliases.length !== 1) return fail(res, 422, 'A note must reference exactly one permitted related record.');
        input.relatedKind = aliases[0][1]; input.relatedId = input[aliases[0][0]];
      }
      const checked = linkedNotes.validateLinkedNote(input, { authorId: req.actor.id, id: uid(), at: now() });
      if (!checked.valid) return fail(res, 422, checked.errors.join(' '));
      const parent = store.get(checked.value.relatedKind, checked.value.relatedId);
      if (!parent || !readable(req, parent, checked.value.relatedKind)) return fail(res, 422, 'related record must reference a permitted existing record.');
      try {
        const row = store.put('notes', checked.value, req.actor.id);
        audit(req.actor.id, 'note.created', checked.value.relatedKind, checked.value.relatedId, { noteId: row.id, visibility: row.visibility });
        return send(res, masked(req, row), 201);
      } catch (e) { return fail(res, 422, e.message); }
    }
    if (kind === 'placements' && ['guaranteeExpiry', 'guaranteeStatus', 'guaranteeRequest', 'guaranteeHistory', 'replacementSubmissionId'].some(field => field in data)) return fail(res, 400, 'Guarantee workflow fields are server managed');
    if (kind === 'talentPools' && ['members', 'member', 'candidateIds'].some(field => field in data)) return fail(res, 400, 'Talent pool membership must use dedicated member actions');
    if (kind === 'approvals' && data.workflow === 'privacy-deletion') return fail(res, 403, 'Privacy approval records must be created through the candidate privacy request action');
    if (kind === 'approvals') return fail(res, 400, 'Use the dedicated workflow to create approvals records');
    if (Object.keys(data).some(field => SERVER_OWNED_FIELDS.has(field))) return fail(res, 400, 'Server-owned, workflow, and history fields cannot be supplied');
    if (kind === 'workforceTargets') {
      try { Object.assign(data, validateWorkforceTarget(data, req.config)); } catch (e) { return fail(res, e.status || 422, e.message); }
    }
    if (['candidates', 'applications'].includes(kind) && data.source != null) {
      const attribution = normalizeSource(data.source, req.config);
      if (!attribution.valid) return fail(res, 422, 'Source must be an enabled configured candidate source');
      data.source = attribution.value;
    }
    if (data.id && store.get(kind, data.id, { includeArchived: true })) return fail(res, 409, 'Record ID already exists');
    if (kind === 'approvals' && data.status && data.status !== 'pending') return fail(res, 409, 'Approvals must start pending and be decided through workflow actions');
    if (kind === 'approvals' && data.workflow === 'privacy-deletion') return fail(res, 403, 'Privacy approval records must be created through the candidate privacy request action');
    try { validateRecordReferences(kind, data, req, store, readable); } catch (e) { return fail(res, e.status || 422, e.message); }
    if (kind === 'applications' && !data.stage) data.stage = req.config.pipelines?.find(p => p.id === data.pipelineId)?.stages?.[0]?.id || req.config.pipelines?.find(p => p.default)?.stages?.[0]?.id;
    let transactionOpen = false;
    try {
      if ((kind === 'jobs' && data.status === 'open') || (kind === 'requisitions' && ![undefined, 'draft', 'pending'].includes(data.status)) || (kind === 'offers' && data.status && data.status !== 'draft') || (kind === 'invoices' && data.status && data.status !== 'draft') || (kind === 'interviews' && data.status && data.status !== 'scheduled') || (kind === 'onboarding' && data.status && data.status !== 'in_progress')) throw new WorkflowError('Create records in their initial state and use workflow actions to change state.', 409);
      validateNewRecord(kind, data, req.config, store);
      let initial = { ...data, createdBy: req.actor.id };
      if (kind === 'interviews') {
        const id = initial.id || uid();
        const schedule = normalizeInterviewForCalendar(initial, req.config);
        initial = { ...initial, ...schedule, id, status: 'scheduled' };
        initial.calendarEvent = createMockCalendarEvent(initial, { workspaceId: req.config.workspaceId || req.config.company?.id || COMPANY, now: now() });
      }
      if (kind === 'offers') {
        const flow = (req.config.approvalWorkflows || []).find(item => item.id === req.config.offers?.approvalWorkflowId);
        if (req.config.offers?.requireApproval) {
          initial.status = 'pending_approval';
          initial.approvals = (flow?.steps || []).map(step => step.userId || step.roleId);
          initial.approvalsCompleted = [];
        } else initial.status = 'draft';
      }
      if (kind === 'requisitions') {
        const flow = (req.config.approvalWorkflows || []).find(item => item.id === req.config.requisitions?.approvalWorkflowId);
        initial.status = flow?.steps?.length ? 'pending' : 'draft';
        initial.approvals = (flow?.steps || []).map(step => step.userId || step.roleId);
        initial.approvalsCompleted = [];
      }
      if (kind === 'approvals') {
        initial.status = 'pending';
        initial.requesterId = req.actor.id;
        delete initial.decidedBy; delete initial.decidedAt;
      }
      if (kind === 'placements') {
        if (!initial.status) initial.status = 'placed';
        const client = initial.clientId && store.get('clients', initial.clientId);
        Object.assign(initial, applyClientContractToPlacement(initial, client, req.config));
        if (!initial.guaranteeExpiry) {
          const expiry = agencyGuarantee.calculateGuaranteeExpiry(initial, req.config);
          if (expiry) initial.guaranteeExpiry = expiry;
        }
      }
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      if (kind === 'interviews') assertInterviewAvailable(initial, store.list('interviews'));
      const row = store.put(kind, initial, req.actor.id);
      audit(req.actor.id, 'record.created', kind, row.id);
      enqueue(req, store, kind, 'created', row);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, row), 201);
    } catch (e) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, e.status || 422, e.message); }
  });
  router.get('/records/:kind/:id', (req, res) => {
    const { kind, id } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (!permitted(req, res, kind, 'view')) return;
    const row = store.get(kind, id);
    if (!row || !(kind === 'notes' ? noteReadable(req, row) : readable(req, row, kind))) return fail(res, row ? 403 : 404, row ? 'Record is outside your scope' : 'Record not found');
    send(res, visibleRecord(req, kind, row));
  });
  router.patch('/records/:kind/:id', (req, res) => {
    const { kind, id } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (kind === 'savedViews') return fail(res, 400, 'Use /saved-views/:id to update an ownership-scoped view');
    if (!permitted(req, res, kind, 'edit')) return;
    const before = store.get(kind, id);
    if (!before || !readable(req, before, kind)) return fail(res, before ? 403 : 404, 'Record not found or outside your scope');
    if (kind === 'approvals' && before.workflow === 'privacy-deletion') return fail(res, 409, 'Privacy approval records can only be changed through workflow actions');
    const delta = req.body?.data;
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return fail(res, 400, 'Body must contain a data object');
    if (kind === 'notes') {
      if (!noteReadable(req, before)) return fail(res, 403, 'Note parent is missing or outside your scope');
      if (before.authorId !== req.actor.id && !hasPermission(req.actor, 'notes:administer', req.config)) return fail(res, 403, 'Only the note author may edit this note');
      try {
        const updated = linkedNotes.updateLinkedNote(before, delta);
        const row = store.put('notes', updated, req.actor.id);
        audit(req.actor.id, 'note.updated', row.relatedKind, row.relatedId, { noteId: row.id, fields: Object.keys(delta) });
        return send(res, masked(req, row));
      } catch (e) { return fail(res, e.status || 422, e.message); }
    }
    if (kind === 'clients' && Object.hasOwn(delta, 'contracts')) return fail(res, 409, 'Client contracts must be versioned through /clients/:id/contracts');
    if (kind === 'talentPools' && ['members', 'member', 'candidateIds'].some(field => field in delta)) return fail(res, 409, 'Talent pool membership must use dedicated member actions');
    if (Object.keys(delta).some(field => SERVER_OWNED_FIELDS.has(field) || ['candidateId', 'applicationId', 'offerId', 'clientId', 'contactId', 'submissionId', 'interviewId', 'jobId', 'requisitionId', 'placementId', 'invoiceId', 'onboardingId', 'talentPoolId', 'parentId', 'sourceId', 'relatedId', 'relatedKind', 'checklist', 'checklistSummary', 'templateId', 'tasks', 'startedAt'].includes(field))) return fail(res, 409, 'Server-owned, relationship, workflow, and history fields cannot be changed directly');
    if (['candidates', 'applications'].includes(kind) && Object.hasOwn(delta, 'source') && delta.source !== before.source) {
      const attribution = normalizeSource(delta.source, req.config);
      if (!attribution.valid) return fail(res, 422, 'Source must be an enabled configured candidate source');
      delta.source = attribution.value;
    }
    const immutableStates = {
      applications: ['stage', 'status'], jobs: ['status', 'visibility'],
      requisitions: ['status', 'approvalsCompleted', 'jobId'], offers: ['status', 'approvalsCompleted'],
      interviews: ['status', 'feedbackIds', 'cancelledReason'], feedback: ['status', 'submittedAt'],
      approvals: ['status', 'decidedBy', 'decidedAt'], onboarding: ['status', 'completedAt'],
      submissions: ['status', 'placementId'], placements: ['status', 'guaranteeExpiry', 'guaranteeDays', 'guaranteeStatus', 'guaranteeRequest', 'guaranteeHistory', 'replacementSubmissionId', 'invoiceId'],
      invoices: ['status', 'paidAt'], referrals: ['status', 'milestonesCompleted', 'reward', 'rewardMilestone', 'payoutStatus', 'payoutUpdatedAt', 'payoutUpdatedBy', 'paidAt', 'rewardEarnedAt']
    };
    if ((immutableStates[kind] || []).some(k => k in delta)) return fail(res, 409, 'Use a workflow action to change business state');
    let transactionOpen = false;
    try {
      validateRecordReferences(kind, delta, req, store, readable);
      validateEdit(kind, before, delta, req.config);
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      let next = { ...before, ...delta, id };
      if (kind === 'interviews' && interviewScheduleChanged(delta)) {
        const scheduleInput = {
          ...next,
          startAt: delta.startAt ?? delta.startsAt ?? delta.scheduledAt ?? next.startAt ?? next.scheduledAt,
          type: delta.type ?? delta.interviewType ?? next.type ?? next.interviewType,
          durationMinutes: delta.durationMinutes ?? delta.duration ?? next.durationMinutes ?? next.duration,
          timeZone: delta.timeZone ?? delta.timezone ?? next.timeZone ?? next.timezone,
          interviewerIds: delta.interviewerIds ?? (Object.hasOwn(delta, 'panel') ? delta.panel : next.interviewerIds ?? next.panel),
        };
        const schedule = normalizeInterviewForCalendar(scheduleInput, req.config);
        next = { ...next, ...schedule };
        assertInterviewAvailable(next, store.list('interviews'), id);
        const at = now();
        if (before.calendarEvent) {
          const cancelledOccurrence = transitionMockCalendarEvent(before.calendarEvent, 'cancel', before, { now: at });
          next.calendarEventHistory = [...(before.calendarEventHistory || []), { ...cancelledOccurrence, occurrenceId: `${cancelledOccurrence.id}:${cancelledOccurrence.startAt}` }];
          next.calendarEvent = createMockCalendarEvent(next, { workspaceId: req.config.workspaceId || req.config.company?.id || COMPANY, now: at });
          next.calendarEvent.rescheduledAt = at;
        } else next.calendarEvent = createMockCalendarEvent(next, { workspaceId: req.config.workspaceId || req.config.company?.id || COMPANY, now: at });
      }
      const row = store.put(kind, next, req.actor.id);
      audit(req.actor.id, 'record.edited', kind, id, { fields: Object.keys(delta) }); enqueue(req, store, kind, 'updated', row);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, row));
    } catch (e) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, e.status || 422, e.message); }
  });
  router.delete('/records/:kind/:id', (req, res) => {
    const { kind, id } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (kind === 'savedViews') return fail(res, 400, 'Use /saved-views/:id to delete an ownership-scoped view');
    if (!permitted(req, res, kind, 'delete')) return;
    const before = store.get(kind, id);
    if (!before || !readable(req, before, kind)) return fail(res, before ? 403 : 404, 'Record not found or outside your scope');
    db.exec('BEGIN IMMEDIATE');
    try { const result = store.archive(kind, id); audit(req.actor.id, 'record.archived', kind, id); db.exec('COMMIT'); send(res, masked(req, result)); }
    catch (e) { db.exec('ROLLBACK'); fail(res, 500, e.message); }
  });
  router.post('/actions/:kind/:id/:action', (req, res) => {
    const { kind, id, action: actionName } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    const required = actionName === 'approve' || actionName === 'reject' ? 'approve' : actionName === 'publish' ? 'publish' : actionName === 'export' ? 'export' : actionName === 'assign' ? 'assign' : ['archive', 'anonymize'].includes(actionName) ? 'delete' : 'edit';
    if (!permitted(req, res, kind, required)) return;
    if (kind === 'placements' && actionName === 'invoice' && !permitted(req, res, 'invoices', 'create')) return;
    const row = store.get(kind, id, { includeArchived: actionName === 'restore' });
    if (!row || !readable(req, row, kind)) return fail(res, row ? 403 : 404, 'Record not found or outside your scope');
    if (kind === 'referrals' && ['complete-milestone', 'set-payout-status'].includes(actionName)) {
      if (!permitted(req, res, 'referrals', 'edit')) return;
      const data = req.body?.data;
      const field = actionName === 'complete-milestone' ? 'milestone' : 'status';
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || typeof data[field] !== 'string' || !data[field].trim()) {
        return fail(res, 400, `Action accepts only a non-empty ${field} string`);
      }
      let transactionOpen = false;
      try {
        db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
        const current = store.get('referrals', id);
        if (!current || !readable(req, current, kind)) throw new WorkflowError('Referral is outside your scope.', 404);
        const at = now();
        const updated = actionName === 'complete-milestone'
          ? referralsApi.recordReferralMilestone(current, data.milestone, req.config, { now: at })
          : referralsApi.updatePayoutStatus(current, data.status, req.config, { actorId: req.actor.id, now: at });
        const changed = JSON.stringify(updated) !== JSON.stringify(current);
        if (changed) store.put('referrals', updated, req.actor.id);
        audit(req.actor.id, actionName === 'complete-milestone' ? 'referral.milestone-completed' : 'referral.payout-status-updated', kind, id, { [field]: actionName === 'complete-milestone' ? data.milestone.trim().toLowerCase() : data.status.trim().toLowerCase(), idempotent: !changed });
        db.exec('COMMIT'); transactionOpen = false;
        return send(res, referralResponse(changed ? updated : current));
      } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, error.status || 422, error.message); }
    }
    if (kind === 'onboarding' && actionName === 'checklist-item') {
      const data = req.body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['itemId', 'status'].includes(key)) || typeof data.itemId !== 'string' || !['pending', 'completed'].includes(data.status)) return fail(res, 400, 'Checklist updates accept only itemId and status (pending or completed)');
      const item = Array.isArray(row.checklist) && row.checklist.find(entry => entry.id === data.itemId);
      if (!item) return fail(res, 404, 'Checklist item not found');
      const isOrgAdmin = hasPermission(req.actor, 'organization:administer', req.config);
      if (!isOrgAdmin && row.ownerId !== req.actor.id && item.assigneeId !== req.actor.id) return fail(res, 403, 'Only an organization admin, onboarding owner, or checklist assignee can update this item');
    }
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      if (kind === 'placements' && actionName === 'invoice') {
        const existing = (row.invoiceId && store.get('invoices', row.invoiceId)) || store.list('invoices').find(invoice => invoice.placementId === row.id);
        if (existing) { db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, existing)); }
        const amount = Number(row.fee ?? row.placementFee ?? req.body?.data?.amount);
        if (!Number.isFinite(amount) || amount < 0) throw new WorkflowError('Placement must have a non-negative fee before invoicing.', 422);
        const invoice = store.put('invoices', { placementId: row.id, clientId: row.clientId, amount, currency: row.currency || req.config.regional?.currency || 'USD', status: 'draft', issuedAt: now(), dueAt: req.body?.data?.dueDate || null }, req.actor.id);
        store.put('placements', { ...row, invoiceId: invoice.id, status: row.status || 'placed' }, req.actor.id);
        audit(req.actor.id, 'placement.invoiced', kind, id, { invoiceId: invoice.id }); db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, invoice));
      }
      if (actionName === 'merge' && kind === 'candidates') {
        const primary = store.get(kind, req.body?.data?.targetId);
        if (!primary || !readable(req, primary, kind)) throw new WorkflowError('Target candidate is missing or outside your scope.', 404);
        const adminAudit = (event, recordKind, recordId, details) => audit(req.actor.id, event, recordKind, recordId, details);
        const result = dataAdmin.mergeRecords(store, kind, primary.id, row.id, { actor: req.actor.id, audit: adminAudit });
        db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, result.record));
      }
      if (actionName === 'restore') {
        const restored = dataAdmin.restoreRecord(store, kind, id, { actor: req.actor.id, audit: (event, recordKind, recordId, details) => audit(req.actor.id, event, recordKind, recordId, details) });
        db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, restored));
      }
      if (actionName === 'archive') {
        const archived = dataAdmin.archiveRecord(store, kind, id, { actor: req.actor.id, reason: req.body?.data?.reason || '', audit: (event, recordKind, recordId, details) => audit(req.actor.id, event, recordKind, recordId, details) });
        db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, archived));
      }
      if (actionName === 'anonymize') {
        if (kind !== 'candidates') throw new WorkflowError('Only candidate privacy requests can be anonymized.', 422);
        const approval = store.list('approvals').find(item => item.workflow === 'privacy-deletion' && item.recordKind === kind && item.recordId === id && item.status === 'approved' && item.decidedBy && item.decidedBy !== item.requesterId);
        if (req.config.privacy?.deletionApprovalRequired !== false && !approval) {
          if (req.body?.data?.approved === true) throw new WorkflowError('Client-supplied approval is not accepted. Submit a privacy request for review.', 403);
          const pending = store.list('approvals').find(item => item.workflow === 'privacy-deletion' && item.recordKind === kind && item.recordId === id && item.status === 'pending');
          const request = pending || store.put('approvals', { title: 'Candidate anonymization request', workflow: 'privacy-deletion', requestKind: 'candidate-anonymization', recordKind: kind, recordId: id, candidateId: id, requesterId: req.actor.id, status: 'pending', requestedAt: now(), reason: String(req.body?.data?.reason || '').slice(0, 1000) }, req.actor.id);
          if (!pending) audit(req.actor.id, 'candidate.anonymization-requested', kind, id, { approvalId: request.id });
          db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, request), 202);
        }
        const afterCommit = [];
        const onDocumentArchived = dataAdmin.documentStorageCleanup(store, {
          scrubArchivedRow: (original, sanitized) => {
            db.prepare('UPDATE platform_records SET data=? WHERE company_id=? AND kind=? AND id=?')
              .run(JSON.stringify(sanitized), COMPANY, 'documents', original.id);
          },
          deleteStorage: storageName => fs.rmSync(path.join(dataDir, path.basename(storageName)), { force: true }),
          afterCommit: callback => afterCommit.push(callback),
        });
        const anonymized = dataAdmin.anonymizeRecord(store, kind, id, { actor: req.actor.id, approved: req.config.privacy?.deletionApprovalRequired === false || Boolean(approval), config: req.config, onDocumentArchived, audit: (event, recordKind, recordId, details) => audit(req.actor.id, event, recordKind, recordId, details) });
        if (approval) store.put('approvals', { ...approval, status: 'processed', processedAt: now(), processedBy: req.actor.id }, req.actor.id);
        db.exec('COMMIT'); transactionOpen = false;
        for (const callback of afterCommit) callback();
        return send(res, masked(req, anonymized));
      }
      if (actionName === 'publish' && kind === 'jobs') {
        if (row.status === 'open') { audit(req.actor.id, 'job.published', kind, id, { idempotent: true }); db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, row)); }
        if (row.requisitionId && !['approved', 'converted'].includes(store.get('requisitions', row.requisitionId)?.status)) throw new WorkflowError('The linked requisition must be approved before publication.', 409);
        const updated = store.put(kind, { ...row, status: 'open', visibility: req.body?.data?.visibility || 'public', publishedAt: now() }, req.actor.id); audit(req.actor.id, 'job.published', kind, id); db.exec('COMMIT'); transactionOpen = false; return send(res, masked(req, updated));
      }
      if (kind === 'approvals' && row.workflow === 'privacy-deletion' && ['approve', 'reject'].includes(actionName)) {
        if (row.status !== 'pending') throw new WorkflowError('This privacy request is no longer pending.', 409);
        if (row.requesterId === req.actor.id) throw new WorkflowError('The requester cannot decide their own privacy request.', 403);
        const subject = row.recordKind === 'candidates' && row.recordId === row.candidateId && store.get('candidates', row.recordId);
        if (!subject) throw new WorkflowError('The candidate privacy request no longer references a valid candidate.', 409);
        if (!hasPermission(req.actor, 'candidates:approve', req.config)) throw new WorkflowError('Candidate privacy approval permission is required.', 403);
      }
      const ctx = { user: req.actor, config: req.config, audit: (event, k, rid, details) => audit(req.actor.id, event, k, rid, details), emit: (event, payload) => emitEvent(req, store, event, payload), canApproveAny: false };
      const result = workflowAction(store, kind, row, actionName, req.body?.data || {}, ctx);
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, masked(req, result));
    } catch (e) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, e.status || 422, e.message); }
  });

  router.get('/timeline/:kind/:id', (req, res) => {
    const kind = req.params.kind;
    if (!linkedNotes.SUPPORTED_KINDS.has(kind)) return fail(res, 404, 'Unsupported timeline record type');
    if (!permitted(req, res, kind, 'view')) return;
    const parent = store.get(kind, req.params.id);
    if (!parent || !readable(req, parent, kind)) return fail(res, 404, 'Record not found or outside your scope');
    const appIds = new Set(store.list('applications').filter(row => row.candidateId === parent.id || row.jobId === parent.id).map(row => row.id));
    const linked = row => row.relatedKind === kind && row.relatedId === parent.id ||
      [['candidateId', 'candidates'], ['jobId', 'jobs'], ['applicationId', 'applications'], ['clientId', 'clients'], ['offerId', 'offers']].some(([field, parentKind]) => parentKind === kind && row[field] === parent.id) ||
      (kind === 'applications' && (row.applicationId === parent.id || row.relatedKind === 'applications' && row.relatedId === parent.id)) ||
      (kind === 'candidates' && row.applicationId && appIds.has(row.applicationId)) ||
      (kind === 'jobs' && row.applicationId && appIds.has(row.applicationId));
    const notes = store.list('notes').filter(note => linked(note) && noteReadable(req, note));
    const canView = target => moduleEnabled(req.config, target) && hasPermission(req.actor, `${target}:view`, req.config);
    const tasks = canView('tasks') ? store.list('tasks').filter(linked).filter(row => readable(req, row, 'tasks')) : [];
    const interviews = canView('interviews') ? store.list('interviews').filter(linked).filter(row => readable(req, row, 'interviews')) : [];
    const offers = canView('offers') ? store.list('offers').filter(linked).filter(row => readable(req, row, 'offers')) : [];
    const applications = kind === 'applications' ? [parent] : store.list('applications').filter(linked).filter(row => readable(req, row, 'applications'));
    const auditRows = db.prepare('SELECT seq AS id, actor_id AS actorId, action, kind AS recordKind, record_id AS recordId, created_at AS createdAt FROM platform_audit WHERE company_id=? AND kind=? AND record_id=? ORDER BY seq DESC LIMIT 500').all(COMPANY, kind, parent.id);
    const labels = { audit: 'Activity', note: 'Note', task: 'Task', interview: 'Interview', offer: 'Offer', application: 'Application' };
    const items = linkedNotes.projectTimeline({ audit: auditRows, notes, tasks, interviews, offers, applications }, { viewer: req.actor, canReadNote: note => noteReadable(req, note) })
      .map(item => ({ ...item, label: labels[item.type] || 'Activity', ...(item.type === 'note' ? { actorId: item.authorId } : {}) }));
    audit(req.actor.id, 'timeline.viewed', kind, parent.id, { count: items.length });
    return send(res, { kind, id: parent.id, items });
  });
  router.get('/dashboard', (req, res) => {
    if (!permitted(req, res, 'dashboard', 'view')) return;
    const metrics = scopedMetrics(req);
    const counts = Object.fromEntries(RECORD_KINDS.map(k => [k, visibleList(req, k).length]));
    send(res, { ...metrics, counts, pendingApprovals: visibleList(req, 'requisitions').filter(x => ['pending', 'in_review'].includes(x.status)).length });
  });
  router.get('/search', (req, res) => {
    const query = String(req.query.q || '').toLowerCase().trim();
    if (!query) return send(res, []);
    const result = [];
    for (const kind of RECORD_KINDS) {
      if (!hasPermission(req.actor, `${kind}:view`, req.config) || !moduleEnabled(req.config, kind)) continue;
      for (const row of (kind === 'notes' ? visibleNotes(req) : visibleList(req, kind))) if (JSON.stringify(row).toLowerCase().includes(query)) result.push({ kind, ...row });
    }
    send(res, result.slice(0, 100));
  });
  router.get('/export/:kind', (req, res) => {
    const kind = req.params.kind;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (!permitted(req, res, kind, 'export')) return;
    const rows = kind === 'notes' ? visibleNotes(req) : visibleList(req, kind); audit(req.actor.id, 'records.exported', kind, null, { count: rows.length });
    if (req.query.format === 'csv') return res.type('text/csv; charset=utf-8').send(dataAdmin.stringifyCsv(rows));
    send(res, { kind, exportedAt: now(), rows });
  });
  router.post('/import/:kind', express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }), (req, res) => {
    const kind = req.params.kind;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (!permitted(req, res, kind, 'create')) return;
    if (GENERIC_CREATE_BLOCKED.has(kind)) return fail(res, 400, `Use the dedicated workflow to create ${kind} records`);
    if (req.config.data?.importEnabled === false) return fail(res, 403, 'Import is disabled');
    let rows = req.body?.data; let mapping = req.body?.mapping || {}; let csvErrors = [];
    if (typeof req.body === 'string') { const parsed = dataAdmin.parseCsv(req.body); rows = parsed.rows; csvErrors = parsed.errors || []; }
    if (typeof req.body?.csv === 'string') { const parsed = dataAdmin.parseCsv(req.body.csv); rows = parsed.rows; csvErrors = parsed.errors || []; mapping = req.body.mapping || {}; }
    if (!Array.isArray(rows)) return fail(res, 400, 'Body data must be an array or CSV text');
    try {
      const existing = store.list(kind);
      const importCheck = dataAdmin.validateImportRows(kind, rows, { config: req.config, existing, mapping, csvErrors, validateRecord: (recordKind, record) => { try { validateImportRecord(recordKind, record); if (recordKind === 'workforceTargets') Object.assign(record, validateWorkforceTarget(record, req.config)); validateRecordReferences(recordKind, record, req, store, readable); validateNewRecord(recordKind, record, req.config, store); return true; } catch (e) { return [e.message]; } } });
      if (!importCheck.valid) return res.status(422).json({ error: 'Import validation failed', details: importCheck.errors, duplicates: importCheck.duplicates });
      const mappedRows = importCheck.rows;
      if (kind === 'workforceTargets') mappedRows.forEach(row => Object.assign(row, validateWorkforceTarget(row, req.config)));
      const ids = mappedRows.map(row => row.id).filter(Boolean);
      if (ids.some(id => store.get(kind, id, { includeArchived: true }))) throw new WorkflowError('Import contains a record ID that already exists.', 409);
      db.exec('BEGIN IMMEDIATE');
      try {
        const created = mappedRows.map(row => store.put(kind, { ...row, createdBy: req.actor.id }, req.actor.id));
        audit(req.actor.id, 'records.imported', kind, null, { count: created.length });
        db.exec('COMMIT');
        return send(res, created.map(row => masked(req, row)), 201);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (e) { return fail(res, e.status || 422, e.message); }
  });
  router.post('/duplicates/:kind', (req, res) => {
    const { kind } = req.params;
    if (!RECORD_KINDS.includes(kind)) return fail(res, 404, 'Unknown record kind');
    if (!permitted(req, res, kind, 'edit')) return;
    const candidate = req.body?.data;
    if (!candidate || typeof candidate !== 'object') return fail(res, 400, 'Body must contain a data object');
    const scoped = store.list(kind).filter(row => readable(req, row, kind));
    const matches = dataAdmin.findDuplicates(candidate, scoped, dataAdmin.duplicateKeysFor(req.config, kind), { supportingFields: req.config.data?.duplicateSupportingFields });
    send(res, matches.map(match => ({ matchedBy: match.matchedBy, record: masked(req, match.record) })));
  });

  router.get('/config/draft', (req, res) => { if (!permitted(req, res, 'organization', 'view')) return; send(res, parseJson(cfgRow().draft, {})); });
  router.put('/config/draft', (req, res) => {
    if (!permitted(req, res, 'organization', 'edit')) return;
    const draft = req.body?.data;
    if (!draft || typeof draft !== 'object') return fail(res, 400, 'Body must contain configuration in data');
    db.prepare('UPDATE platform_config SET draft=?,updated_at=? WHERE company_id=?').run(JSON.stringify(draft), now(), COMPANY); audit(req.actor.id, 'configuration.draft-updated', 'config', null); send(res, draft);
  });
  router.get('/config/history', (req, res) => { if (!permitted(req, res, 'organization', 'view')) return; send(res, db.prepare('SELECT version,actor_id AS actorId,created_at AS createdAt,note FROM platform_config_versions WHERE company_id=? ORDER BY version DESC').all(COMPANY)); });
  router.get('/config/presets', (req, res) => { if (!permitted(req, res, 'organization', 'view')) return; const { defaults, presets } = require('../../../shared/ats-config.cjs'); send(res, presets.map(p => ({ ...p, config: defaults(p.id) }))); });
  router.post('/config/activate', (req, res) => {
    if (!permitted(req, res, 'organization', 'administer')) return;
    const draft = parseJson(cfgRow().draft, {});
    try {
      const result = activateConfiguration(db, {
        config: draft,
        actorId: req.actor.id,
        note: req.body?.data?.note || 'Activated draft',
        companyId: COMPANY,
        audit: (event, kind, recordId, details) => audit(req.actor.id, event, kind, recordId, details),
      });
      send(res, { version: result.version, config: result.config });
    } catch (error) {
      if (error.status === 422) return res.status(422).json({ error: error.message, details: error.details, warnings: error.warnings });
      throw error;
    }
  });
  router.post('/config/rollback', (req, res) => {
    if (!permitted(req, res, 'organization', 'administer')) return;
    const version = Number(req.body?.data?.version); const prior = db.prepare('SELECT config FROM platform_config_versions WHERE company_id=? AND version=?').get(COMPANY, version);
    if (!prior) return fail(res, 404, 'Configuration version not found');
    const configData = parseJson(prior.config, {}); const next = cfgRow().active_version + 1; const timestamp = now();
    db.prepare('UPDATE platform_config SET active=?,draft=?,active_version=?,updated_at=? WHERE company_id=?').run(prior.config, prior.config, next, timestamp, COMPANY);
    db.prepare('INSERT INTO platform_config_versions(company_id,version,config,actor_id,created_at,note) VALUES(?,?,?,?,?,?)').run(COMPANY, next, prior.config, req.actor.id, timestamp, `Rollback to version ${version}`); syncConfiguredUsers(db, configData, COMPANY); audit(req.actor.id, 'configuration.rolled-back', 'config', null, { from: version, version: next }); send(res, { version: next, config: configData });
  });

  router.get('/public/jobs', (req, res) => send(res, store.list('jobs').filter(j => j.status === 'open' && j.visibility === 'public' && moduleEnabled(config(), 'careers')).map(j => publicJob(j, config()))));
  router.get('/public/jobs/:id', (req, res) => { const job = store.get('jobs', req.params.id); if (!job || job.status !== 'open' || job.visibility !== 'public' || !moduleEnabled(config(), 'careers')) return fail(res, 404, 'Job not found'); send(res, publicJob(job, config())); });
  router.post('/public/jobs/:id/apply', (req, res) => {
    const timestamp = Date.now();
    const windowMs = 15 * 60 * 1000;
    const limit = Math.max(1, Number(config().security?.publicApplicationLimit) || 20);
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const recent = (publicApplicationAttempts.get(key) || []).filter(value => timestamp - value < windowMs);
    if (recent.length >= limit) return fail(res, 429, 'Too many applications; please try again later');
    recent.push(timestamp); publicApplicationAttempts.set(key, recent);
    if (publicApplicationAttempts.size > 1000) for (const [candidate, attempts] of publicApplicationAttempts) if (!attempts.some(value => timestamp - value < windowMs)) publicApplicationAttempts.delete(candidate);
    const job = store.get('jobs', req.params.id); if (!job || job.status !== 'open' || job.visibility !== 'public' || !moduleEnabled(config(), 'careers')) return fail(res, 404, 'Job not found');
    const data = { ...(req.body?.data || {}) }; const cfg = config();
    if (data._contactWebsite) return send(res, { status: 'received' }, 201);
    const careerSource = configuredSource(cfg, 'careers-site');
    if (Array.isArray(cfg.sources) && !careerSource) return fail(res, 403, 'Careers site applications are disabled as a candidate source');
    const careerSourceLabel = careerSource?.label || 'Careers site';
    if (data.email !== undefined) data.email = String(data.email).trim().toLowerCase();
    const form = (cfg.applicationForms || []).find(f => f.id === job.applicationFormId) || cfg.applicationForms?.[0];
    const answers = data.answers && typeof data.answers === 'object' ? { ...data, ...data.answers } : { ...data };
    if (data.email !== undefined) answers.email = data.email;
    const formFields = (form?.sections || []).flatMap(section => section.fields || []).filter(field => fieldIsApplicable(field, answers));
    const uploadField = preferredApplicationUploadField(formFields);
    const uploadFieldId = uploadField && applicationFieldId(uploadField);
    const configuredUpload = uploadFieldId ? answers[uploadFieldId] : null;
    const applicationUpload = isFileUpload(configuredUpload) ? configuredUpload : isFileUpload(data.resume) ? data.resume : null;
    // The careers UI submits the selected file through the canonical `resume`
    // transport key. Map it back to the configured file field before validation
    // so buyers can rename the field without changing the storage contract.
    if (uploadFieldId && applicationUpload && !isFileUpload(configuredUpload)) answers[uploadFieldId] = applicationUpload;
    const formValidation = require('../../../shared/ats-config.cjs').validateFields(formFields, answers);
    if (!formValidation.valid) return res.status(422).json({ error: 'Application form is incomplete or invalid', details: formValidation.errors });
    if (uploadFieldId && answers[uploadFieldId] != null && !isFileUpload(answers[uploadFieldId])) return fail(res, 422, `${uploadField.label || uploadFieldId} must include a filename and file content`);
    if (!data.email || !data.fullName) return fail(res, 422, 'Full name and email are required');
    if (cfg.privacy?.consentRequired !== false && data.consent !== true) return fail(res, 422, 'Privacy consent is required');
    const knockout = (form?.knockoutQuestions || []).find(q => knockoutTriggered(q, answers));
    if (knockout) return fail(res, 422, knockout.message || 'Your response does not meet this role’s application requirements');
    const normalizedEmail = String(data.email).trim().toLowerCase();
    const prepared = publicApplicant.preparePublicApplication({
      input: { jobId: job.id, candidateDetails: { name: data.fullName, email: normalizedEmail, phone: data.phone, resume: data.resume } },
      jobs: [job],
      applications: store.list('applications').map(application => {
        const candidate = application.candidateId && store.get('candidates', application.candidateId);
        return { ...application, candidateEmail: String(candidate?.email || '').trim().toLowerCase() };
      }),
    });
    if (prepared.duplicateReview) return send(res, { status: 'received' }, 201);
    let candidate;
    const pipeline = config().pipelines?.find(p => p.id === job.pipelineId) || config().pipelines?.find(p => p.default) || config().pipelines?.[0];
    const cleanAnswers = Object.fromEntries(formFields.map(field => {
      const id = applicationFieldId(field);
      return [id, sanitizeApplicationAnswer(answers[id], field.type === 'file')];
    }).filter(([, value]) => value !== undefined));
    let document;
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      candidate = store.put('candidates', { name: prepared.candidateDetails.name, email: prepared.candidateDetails.email, phone: prepared.candidateDetails.phone, consentStatus: data.consent ? 'granted' : 'pending', source: careerSourceLabel, ownerId: null }, 'public');
      const app = store.put('applications', { candidateId: candidate.id, jobId: job.id, stage: pipeline?.stages?.[0]?.id || pipeline?.stages?.[0]?.name || 'applied', status: 'active', source: careerSourceLabel, pipelineId: pipeline?.id, ownerId: job.recruiterId || null, answers: cleanAnswers }, 'public');
      if (applicationUpload) document = attachDocument(store, applicationUpload, { candidateId: candidate.id, applicationId: app.id }, dataDir, 'public', cfg, scanDocument);
      audit('public', 'application.submitted', 'applications', app.id, { jobId: job.id });
      emitEvent({ config: cfg, actor: { id: 'public' }, localsUsers: users(), localsAudit: audit }, store, 'application.created', { ...app, __kind: 'applications' });
      db.exec('COMMIT'); transactionOpen = false;
      send(res, { applicationId: app.id, candidateId: candidate.id, status: 'received' }, 201);
    } catch (error) {
      if (transactionOpen) db.exec('ROLLBACK');
      if (document?.storageName) fs.rmSync(path.join(dataDir, path.basename(document.storageName)), { force: true });
      fail(res, error.status || 422, error.message);
    }
  });

  router.post('/referrals/submit', (req, res) => {
    if (!permitted(req, res, 'referrals', 'create')) return;
    const input = req.body?.data;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(res, 400, 'Body must contain referral data');
    const candidateInput = input.candidate && typeof input.candidate === 'object' ? input.candidate : input.candidateDetails || {};
    const email = String(candidateInput.email || '').trim().toLowerCase();
    const phone = String(candidateInput.phone || '').trim();
    const candidateDetails = { ...candidateInput, email, phone };
    const candidates = store.list('candidates');
    const candidateMatches = candidates.filter(candidate =>
      (email && String(candidate.email || '').trim().toLowerCase() === email) ||
      (phone && String(candidate.phone || '').trim() === phone)
    );
    // Resolve private identity matches only within the service. Helpers receive
    // candidate IDs and normalized emails, but those details never enter the response.
    const identityMatches = new Set(candidateMatches.map(candidate => candidate.id));
    const privateIdentity = candidateMatches.find(candidate => String(candidate.email || '').trim().toLowerCase() === email)
      || candidateMatches[0];
    const identityKey = privateIdentity && String(privateIdentity.email || '').trim().toLowerCase() === email
      ? email : phone;
    const applications = store.list('applications').map(application => ({
      ...application,
      candidateEmail: application.candidateId && identityMatches.has(application.candidateId)
        ? identityKey : String(store.get('candidates', application.candidateId)?.email || '').trim().toLowerCase(),
    }));
    const referrals = store.list('referrals').map(referral => ({
      ...referral,
      candidateEmail: referral.candidateId && identityMatches.has(referral.candidateId)
        ? identityKey : String(referral.candidateEmail || '').trim().toLowerCase(),
    }));
    let prepared;
    try {
      prepared = referralsApi.prepareReferralSubmission({
        input: { jobId: input.jobId, candidateDetails, consent: candidateInput.consent ?? input.consent },
        actor: req.actor, users: req.localsUsers, config: req.config, candidates: [],
        jobs: store.list('jobs'), referrals, applications,
      });
    } catch (error) { return fail(res, error.status || 422, error.message); }
    let transactionOpen = false;
    try {
      db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
      // A duplicate under review is retained as a referral event without creating
      // another candidate record or linking the referral to an existing candidate.
      const referral = store.put('referrals', { ...prepared, candidateId: null }, req.actor.id);
      if (prepared.status === 'submitted') {
        const candidate = store.put('candidates', { ...prepared.candidateDetails, source: 'Employee referral', consentStatus: 'granted', ownerId: req.actor.id }, req.actor.id);
        store.put('referrals', { ...referral, candidateId: candidate.id }, req.actor.id);
      }
      audit(req.actor.id, 'referral.submitted', 'referrals', referral.id, { status: prepared.status });
      db.exec('COMMIT'); transactionOpen = false;
      return send(res, referralResponse({ ...prepared, id: referral.id }), 201);
    } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); return fail(res, error.status || 422, error.message); }
  });

  router.get('/referrals/mine', (req, res) => {
    if (!permitted(req, res, 'referrals', 'view')) return;
    const rows = store.list('referrals').filter(referral => referral.referrerId === req.actor.id).map(referralResponse);
    send(res, rows);
  });

  router.post('/records/:kind/:id/documents', (req, res) => {
    const { kind, id } = req.params; if (!permitted(req, res, 'documents', 'create')) return;
    const record = store.get(kind, id); if (!record || !readable(req, record, kind)) return fail(res, 404, 'Record not found');
    try { const doc = attachDocument(store, req.body?.data || {}, { relatedKind: kind, relatedId: id }, dataDir, req.actor.id, req.config, scanDocument); audit(req.actor.id, 'document.uploaded', kind, id, { documentId: doc.id, version: doc.version, replacesDocumentId: doc.previousVersionId || null }); send(res, masked(req, doc), 201); } catch (e) { fail(res, e.status || 422, e.message); }
  });
  router.get('/documents/:id/versions', (req, res) => {
    if (!permitted(req, res, 'documents', 'view')) return;
    const doc = store.get('documents', req.params.id, { includeArchived: true });
    if (!doc) return fail(res, 404, 'Document not found');
    const parentKind = doc.relatedKind || (doc.applicationId ? 'applications' : doc.candidateId ? 'candidates' : doc.jobId ? 'jobs' : null);
    const parentId = doc.relatedId || doc.applicationId || doc.candidateId || doc.jobId;
    const parent = parentKind && parentId ? store.get(parentKind, parentId) : null;
    const parentAllowed = !parentKind ? doc.ownerId === req.actor.id : Boolean(parent && readable(req, parent, parentKind));
    const visibilityAllowed = doc.visibility === 'public' || doc.ownerId === req.actor.id || hasPermission(req.actor, 'documents:administer', req.config);
    if (!parentAllowed || !visibilityAllowed) return fail(res, 404, 'Document not found');
    const rootId = doc.rootDocumentId || doc.id;
    const versions = store.list('documents', { includeArchived: true })
      .filter(version => (version.rootDocumentId || version.id) === rootId
        && version.relatedKind === doc.relatedKind && version.relatedId === doc.relatedId
        && (version.visibility === 'public' || version.ownerId === req.actor.id || hasPermission(req.actor, 'documents:administer', req.config)))
      .sort((a, b) => Number(a.version || 1) - Number(b.version || 1));
    send(res, versions.map(version => masked(req, version)));
  });
  router.get('/documents/:id/download', (req, res) => {
    if (!permitted(req, res, 'documents', 'view')) return;
    const doc = store.get('documents', req.params.id);
    if (!doc) return fail(res, 404, 'Document not found');
    const parentKind = doc.relatedKind || (doc.applicationId ? 'applications' : doc.candidateId ? 'candidates' : doc.jobId ? 'jobs' : null);
    const parentId = doc.relatedId || doc.applicationId || doc.candidateId || doc.jobId;
    const parent = parentKind && parentId ? store.get(parentKind, parentId) : null;
    const parentAllowed = !parentKind ? doc.ownerId === req.actor.id : Boolean(parent && readable(req, parent, parentKind));
    const visibilityAllowed = doc.visibility === 'public' || doc.ownerId === req.actor.id || hasPermission(req.actor, 'documents:administer', req.config);
    if (!parentAllowed || !visibilityAllowed) return fail(res, 404, 'Document not found');
    const file = path.join(dataDir, path.basename(doc.storageName || ''));
    if (!doc.storageName || !fs.existsSync(file)) return fail(res, 404, 'Document file is missing');
    const safeFilename = path.basename(doc.filename || 'document').replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(fs.readFileSync(file));
  });

  // Workforce targets are computed from persisted goals and dated outcomes.
  // Every input is filtered through the same record scope used by /records.
  // Keep this explicit route ahead of the generic named-report handler.
  router.get('/reports/workforce-targets', (req, res) => {
    if (!permitted(req, res, 'reporting', 'view')) return;
    if (!permitted(req, res, 'workforcePlanning', 'view')) return;
    const agencyMode = req.config.mode === 'agency' || req.config.modules?.agency === true;
    const outcomeKind = agencyMode ? 'placements' : 'applications';
    for (const kind of ['jobs', outcomeKind]) {
      if (!permitted(req, res, kind, 'view')) return;
    }
    const recordsByKind = {
      workforceTargets: visibleList(req, 'workforceTargets'),
      jobs: visibleList(req, 'jobs'),
      applications: agencyMode ? [] : visibleList(req, 'applications'),
      placements: agencyMode ? visibleList(req, 'placements') : [],
    };
    send(res, { name: 'workforce-targets', ...buildWorkforcePlan({ recordsByKind, config: req.config }) });
  });

  router.get('/sla/overview', (req, res) => {
    if (!permitted(req, res, 'reporting', 'view')) return;
    const canView = kind => moduleEnabled(req.config, kind) && hasPermission(req.actor, `${kind}:view`, req.config);
    // Filter each input through the same linked-record-aware scope used by /records.
    // In particular, downstream feedback is included only when its interview/application
    // is also visible, so hidden activity cannot affect counts or expose identifiers.
    const recordsByKind = {
      applications: canView('applications') ? visibleList(req, 'applications') : [],
      interviews: canView('interviews') ? visibleList(req, 'interviews') : [],
      offers: canView('offers') ? visibleList(req, 'offers') : [],
      feedback: canView('interviews') && canView('feedback') ? visibleList(req, 'feedback') : [],
    };
    send(res, evaluateSla({ recordsByKind, config: req.config }));
  });

  router.get('/reports/:name', (req, res) => {
    if (!permitted(req, res, 'reporting', 'view')) return;
    const report = getPlatformReport(req.params.name, scopedMetrics(req), req.config);
    if (!report) return fail(res, 404, 'Report is unavailable');
    send(res, report);
  });

  return router;

  function scopedMetrics(req) {
    const recordsByKind = Object.fromEntries(RECORD_KINDS.map(kind => [kind, store.list(kind)]));
    return computePlatformMetrics({ recordsByKind, config: req.config, actor: req.actor, scopeRecord: (kind, record) => readable(req, record, kind) });
  }
}

function validateNewRecord(kind, data, config, store) {
  if ((kind === 'jobs' && data.status === 'open') || (kind === 'requisitions' && ![undefined, 'draft', 'pending'].includes(data.status)) || (kind === 'offers' && data.status && data.status !== 'draft') || (kind === 'invoices' && data.status && data.status !== 'draft') || (kind === 'interviews' && data.status && data.status !== 'scheduled') || (kind === 'onboarding' && data.status && data.status !== 'in_progress')) throw new WorkflowError('Record lifecycle state must be set by its workflow.', 409);
  validateCustomFields(kind, data.customFields || {}, config);
  if (kind === 'applications') {
    if (!store.get('jobs', data.jobId) || !store.get('candidates', data.candidateId)) throw new WorkflowError('Application must reference an existing candidate and job.', 422);
    if (data.status && data.status !== 'active') throw new WorkflowError('New applications must start active.', 409);
    const pipeline = config.pipelines?.find(p => p.id === (data.pipelineId || store.get('jobs', data.jobId)?.pipelineId)) || config.pipelines?.find(p => p.default) || config.pipelines?.[0];
    const first = pipeline?.stages?.[0];
    if (!data.stage || !first || ![first.id, first.name].includes(data.stage)) throw new WorkflowError('New applications must start at the first stage of their configured pipeline.', 409);
  }
  if (kind === 'jobs' && data.status && data.status !== 'draft') throw new WorkflowError('New jobs must start in draft state.', 409);
  if (kind === 'feedback') throw new WorkflowError('Interview feedback must be submitted through the interview workflow action.', 409);
  if (kind === 'requisitions') {
    if (config.requisitions?.requireJustification && !String(data.justification || '').trim()) throw new WorkflowError('A justification is required for hiring requests.', 422);
    if (config.requisitions?.requireBudget && data.budget == null) throw new WorkflowError('A budget is required for hiring requests.', 422);
    if (config.requisitions?.requireTargetDate && !data.targetDate) throw new WorkflowError('A target date is required for hiring requests.', 422);
    const flow = (config.approvalWorkflows || []).find(item => item.id === config.requisitions?.approvalWorkflowId);
    if (flow?.steps?.length && data.status && data.status !== 'pending') throw new WorkflowError('Hiring requests must enter the configured approval workflow.', 409);
  }
  if (kind === 'jobs' && data.pipelineId && !config.pipelines?.some(p => p.id === data.pipelineId)) throw new WorkflowError('Unknown configured pipeline.', 422);
  if (kind === 'jobs' && data.status === 'open' && data.requisitionId && store.get('requisitions', data.requisitionId)?.status !== 'approved') throw new WorkflowError('Approve the requisition before opening its job.', 409);
}
function interviewCalendarConfig(config = {}) {
  return {
    ...config,
    interviewTypes: config.interviewTypes || config.interviews?.types || [],
    regional: config.regional,
    timezone: config.timezone,
  };
}
function interviewScheduleChanged(delta = {}) {
  return ['scheduledAt', 'startAt', 'startsAt', 'durationMinutes', 'duration', 'type', 'interviewType', 'timeZone', 'timezone', 'interviewerId', 'interviewerIds', 'panel', 'panelId', 'roomId'].some(field => Object.hasOwn(delta, field));
}
function normalizeInterviewForCalendar(interview, config) {
  try {
    const schedule = validateInterviewSchedule(interview, interviewCalendarConfig(config));
    const panelIds = Array.isArray(interview.interviewerIds) ? interview.interviewerIds : (Array.isArray(interview.panel) ? interview.panel : []);
    const interviewerIds = [...new Set([...panelIds, interview.interviewerId].filter(Boolean).map(value => typeof value === 'object' ? value.id || value.userId : value).filter(Boolean).map(String))];
    return { ...schedule, scheduledAt: schedule.startAt, interviewerIds };
  } catch (error) {
    if (error instanceof InterviewCalendarError) throw new WorkflowError(error.message, error.status);
    throw error;
  }
}
function assertInterviewAvailable(candidate, interviews, excludeId = null) {
  const active = (Array.isArray(interviews) ? interviews : []).filter(item => ['scheduled', 'in_progress', 'active'].includes(String(item?.status || 'scheduled').toLowerCase()));
  const panelAware = item => ({
    ...item,
    startAt: item.startAt || item.scheduledAt,
    interviewerIds: item.interviewerIds || (Array.isArray(item.panel) ? item.panel : []).map(value => typeof value === 'object' ? value.id || value.userId : value),
  });
  if (findInterviewConflict(active.map(panelAware), panelAware(candidate), excludeId)) {
    // A conflict can belong to a record the caller cannot read, so expose no booking details.
    throw new WorkflowError('Interview schedule conflicts with another booking for the interviewer or room.', 409);
  }
}
function validateImportRecord(kind, data) {
  const allowed = IMPORT_FIELDS[kind];
  if (!allowed) throw new WorkflowError(`Import is not supported for ${kind}.`, 422);
  const forbidden = Object.keys(data).filter(field => !allowed.has(field));
  if (forbidden.length) throw new WorkflowError(`Import contains unsupported or server-owned fields: ${forbidden.join(', ')}.`, 422);
  if (GENERIC_CREATE_BLOCKED.has(kind)) throw new WorkflowError(`Import is not supported for ${kind}.`, 422);
}
function validateRecordReferences(kind, data, req, store, canRead = () => false) {
  const userFields = ['ownerId', 'recruiterId', 'hiringManagerId', 'assignedTo', 'interviewerId', 'referrerId', 'requesterId', 'approverId', 'authorId'];
  const suppliedOwners = userFields.filter(field => data[field] != null);
  if (suppliedOwners.length && !hasPermission(req.actor, `${kind}:assign`, req.config)) throw new WorkflowError('Assigning another owner requires assignment permission.', 403);
  for (const field of suppliedOwners) if (!req.localsUsers.some(user => user.id === data[field])) throw new WorkflowError(`${field} must reference a configured user.`, 422);
  const relations = {
    applications: { candidateId: 'candidates', jobId: 'jobs' }, interviews: { applicationId: 'applications', candidateId: 'candidates', jobId: 'jobs' },
    feedback: { interviewId: 'interviews', candidateId: 'candidates', applicationId: 'applications' }, offers: { applicationId: 'applications', candidateId: 'candidates', jobId: 'jobs' },
    onboarding: { offerId: 'offers', applicationId: 'applications', candidateId: 'candidates' },
    tasks: { candidateId: 'candidates', jobId: 'jobs', interviewId: 'interviews', offerId: 'offers', onboardingId: 'onboarding', clientId: 'clients' },
    contacts: { clientId: 'clients' }, submissions: { candidateId: 'candidates', jobId: 'jobs', clientId: 'clients', contactId: 'contacts' },
    placements: { submissionId: 'submissions', clientId: 'clients', candidateId: 'candidates', jobId: 'jobs' }, invoices: { placementId: 'placements', clientId: 'clients' },
    referrals: { candidateId: 'candidates', jobId: 'jobs' }, notes: { candidateId: 'candidates', jobId: 'jobs', applicationId: 'applications' },
    documents: { candidateId: 'candidates', jobId: 'jobs', applicationId: 'applications', offerId: 'offers', onboardingId: 'onboarding', clientId: 'clients' },
    approvals: { candidateId: 'candidates' }
  }[kind] || {};
  for (const [field, relatedKind] of Object.entries(relations)) {
    if (data[field] == null) continue;
    const related = store.get(relatedKind, data[field]);
    if (!related || !canRead(req, related, relatedKind)) throw new WorkflowError(`${field} must reference a permitted existing ${relatedKind} record.`, 422);
  }
  if ((kind === 'jobs' || kind === 'applications') && data.pipelineId && !req.config.pipelines?.some(item => item.id === data.pipelineId)) throw new WorkflowError('pipelineId must reference a configured hiring pipeline.', 422);
  if (kind === 'approvals' && data.workflow === 'privacy-deletion' && (!data.candidateId || data.recordKind !== 'candidates' || data.recordId !== data.candidateId)) throw new WorkflowError('Privacy approvals must reference the candidate under review.', 422);
}
function validateEdit(kind, before, delta, config) {
  if (kind === 'workforceTargets') Object.assign(delta, validateWorkforceTargetEdit(before, delta, config));
  validateCustomFields(kind, { ...(before.customFields || {}), ...(delta.customFields || {}) }, config);
  if (kind === 'jobs' && delta.status === 'open' && before.requisitionId) throw new WorkflowError('Publish the job through the publish action after requisition approval.', 409);
}
function validateCustomFields(kind, values, config) {
  const fields = config.customFields?.[kind] || [];
  if (!fields.length) return;
  const result = require('../../../shared/ats-config.cjs').validateFields(fields, values);
  if (!result.valid) throw new WorkflowError(result.errors.join(' '), 422);
}
function publicJob(job, config) {
  const visible = {};
  for (const key of ['id', 'title', 'department', 'location', 'employmentType', 'remote', 'description', 'requirements', 'benefits', 'experience', 'skills', 'salaryRange', 'currency', 'category', 'publishedAt']) if (job[key] !== undefined) visible[key] = job[key];
  const allowedFields = new Set((config.customFields?.jobs || []).filter(field => field.visibility === 'public').map(field => field.id));
  const customFields = Object.fromEntries(Object.entries(job.customFields || {}).filter(([key]) => allowedFields.has(key)));
  if (Object.keys(customFields).length) visible.customFields = customFields;
  const form = (config.applicationForms || []).find(f => f.id === job.applicationFormId) || config.applicationForms?.[0] || null;
  const branding = config.branding || {};
  return {
    ...visible,
    company: { name: config.company?.name, website: config.company?.website },
    branding: {
      productName: branding.productName,
      logo: branding.careersLogo || branding.logo,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
      colorMode: branding.colorMode,
      darkPrimaryColor: branding.darkPrimaryColor,
      darkBackgroundColor: branding.darkBackgroundColor,
      typography: branding.typography,
      fontFamily: branding.fontFamily,
      favicon: branding.favicon,
      loginSubheading: branding.loginSubheading,
    },
    careers: { headline: config.careers?.headline, intro: config.careers?.intro, footer: config.careers?.footer },
    terminology: { jobs: config.terminology?.jobs, candidates: config.terminology?.candidates },
    regional: { locale: config.regional?.locale, timezone: config.regional?.timezone, dateFormat: config.regional?.dateFormat, timeFormat: config.regional?.timeFormat },
    privacyNotice: config.privacy?.notice || '', applicationForm: form, applicationConditions: form?.conditions || [], knockoutQuestions: form?.knockoutQuestions || []
  };
}
function referralResponse(referral) {
  const result = {};
  for (const key of ['id', 'candidateName', 'jobTitle', 'status', 'duplicateReview', 'submittedAt', 'milestonesCompleted', 'reward', 'rewardMilestone', 'payoutStatus', 'payoutUpdatedAt', 'paidAt']) {
    if (referral?.[key] !== undefined) result[key] = referral[key];
  }
  return result;
}
function fieldIsApplicable(field, answers) {
  const condition = field.condition || field.when;
  if (!condition || typeof condition !== 'object') return true;
  const actual = answers[condition.field || condition.key]; const expected = condition.value;
  switch (condition.operator || 'equals') {
    case 'notEquals': return actual !== expected;
    case 'contains': return Array.isArray(actual) ? actual.includes(expected) : String(actual || '').includes(String(expected));
    case 'truthy': return Boolean(actual);
    case 'falsy': return !actual;
    default: return actual === expected;
  }
}
function applicationFieldId(field) {
  return String(field?.id || field?.key || field?.field || '');
}
function preferredApplicationUploadField(fields = []) {
  const uploads = fields.filter(field => field?.type === 'file');
  return uploads.find(field => /resume|cv/i.test(`${applicationFieldId(field)} ${field.label || ''}`)) || uploads[0] || null;
}
function isFileUpload(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.filename && value.contentBase64);
}
function sanitizeApplicationAnswer(value, fileField = false) {
  if (value === undefined || value === null) return value;
  if (fileField) {
    if (typeof value !== 'object' || Array.isArray(value)) return value;
    const metadata = {};
    if (value.filename) metadata.filename = path.basename(String(value.filename));
    if (value.mimeType) metadata.mimeType = String(value.mimeType);
    return metadata;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeApplicationAnswer(item));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key.toLowerCase() !== 'contentbase64')
    .map(([key, item]) => [key, sanitizeApplicationAnswer(item)]));
}
function knockoutTriggered(question, answers) {
  const key = question.field || question.id || question.key; const value = answers[key];
  if (typeof question.evaluate === 'function') return question.evaluate(value, answers);
  const rejected = question.rejectWhen ?? question.disqualifyingAnswer;
  if (rejected !== undefined) return Array.isArray(rejected) ? rejected.includes(value) : value === rejected;
  return question.required === true && (value === undefined || value === null || value === '');
}
function attachDocument(store, input, relations, dataDir, actorId, config = {}, scanDocument) {
  if (!input.filename || !input.contentBase64) throw new Error('Filename and base64 file content are required');
  const inspected = inspectDocument({ ...input, maxFileSizeMb: config.documents?.maxFileSizeMb });
  if (!scanDocument) { const error = new Error('Document malware scanner is required in production'); error.status = 503; throw error; }
  const scan = scanDocument({ bytes: inspected.bytes, filename: inspected.filename, mimeType: inspected.mimeType });
  if (!scan || scan.clean !== true) { const error = new Error(scan?.reason || 'Document failed malware screening'); error.status = 422; throw error; }
  const { bytes, filename, mimeType } = inspected;
  const id = uid('document'), storageName = `${id}${path.extname(filename).slice(0, 12)}`;
  const prepared = dataAdmin.prepareDocumentVersion(store, { ...input, ...relations, id, filename }, { config, actor: actorId });
  // File bytes belong in local document storage, not in the SQLite metadata row.
  // Keeping the submitted base64 here would duplicate sensitive attachments and
  // make metadata exports unexpectedly contain the complete document body.
  delete prepared.contentBase64;
  fs.writeFileSync(path.join(dataDir, storageName), bytes, { flag: 'wx' });
  try { return store.put('documents', { ...prepared, ...relations, id, filename, storageName, mimeType, size: bytes.length, scanProvider: scan.provider || 'configured', scannedAt: now(), ownerId: actorId }, actorId); }
  catch (error) { fs.rmSync(path.join(dataDir, storageName), { force: true }); throw error; }
}
function enqueue(req, store, kind, event, record) { emitEvent(req, store, `${kind}.${event}`, { ...record, __kind: kind }); }
function emitEvent(req, store, event, record) {
  const actor = req.actor?.id || 'system';
  const kind = record.__kind || RECORD_KINDS.find(candidate => store.get(candidate, record.id)) || event.split('.')[0];
  return runAutomations({
    store, config: req.config || {}, actor: req.actor || { id: actor }, users: (req.localsUsers || []).slice(0, 100), event,
    record: { ...record, __kind: kind }, audit: (action, recordKind, recordId, details) => req.localsAudit(actor, action, recordKind, recordId, details),
    eventKey: `${event}:${record.id || ''}:${record.updatedAt || record.createdAt || ''}`
  });
}

module.exports = { createPlatformRouter, validateConfig: require('../../../shared/ats-config.cjs').validateConfig };
