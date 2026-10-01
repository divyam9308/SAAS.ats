const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('../server/node_modules/express');
const { defaults } = require('../shared/ats-config.cjs');

async function instance(t, preset = 'corporate', customize = () => {}, routerOptions = {}) {
  const initialConfig = defaults(preset);
  customize(initialConfig);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-acceptance-'));
  const { createPlatformRouter } = require('../server/src/platform');
  const router = createPlatformRouter({ initialConfig, dbPath: path.join(dir, 'ats.sqlite'), dataDir: dir, ...routerOptions });
  const app = express();
  app.use(express.json());
  app.use('/api/platform', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (typeof router.close === 'function') router.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function request(route, { user = 'demo-admin', method = 'GET', body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: response.status, data: payload?.data ?? payload, payload, headers: response.headers };
  }
  return { request, config: initialConfig, dir };
}

test('corporate, agency and startup bootstrap consume substantially different configuration', async t => {
  for (const preset of ['corporate', 'agency', 'startup']) {
    await t.test(preset, async t => {
      const { request, config } = await instance(t, preset);
      const boot = await request('/bootstrap');
      assert.equal(boot.status, 200, JSON.stringify(boot.payload));
      assert.equal(boot.data.config.mode, config.mode);
      assert.equal(boot.data.config.terminology.jobs, config.terminology.jobs);
      assert.deepEqual(boot.data.config.pipelines, config.pipelines);
      const clients = await request('/records/clients');
      assert.equal(clients.status, preset === 'agency' ? 200 : 403, JSON.stringify(clients.payload));
    });
  }
});

test('platform router leaves interview reminders disabled by default in acceptance tests', async t => {
  const { request } = await instance(t);
  const notifications = await request('/records/notifications');
  assert.equal(notifications.status, 200, JSON.stringify(notifications.payload));
  assert.equal(notifications.data.some(row => row.kind === 'interview_reminder'), false);
});

test('production auth boundary fails closed when no real adapter is configured', async t => {
  const { request } = await instance(t, 'corporate', () => {}, { demoAuthEnabled: false });
  const response = await request('/bootstrap');
  assert.equal(response.status, 503);
  assert.equal(response.payload.error, 'Production authentication adapter is not configured');
});

test('public application endpoint rate limits repeated submissions by address', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.security = { ...(config.security || {}), publicApplicationLimit: 1 };
  });
  const job = (await request('/public/jobs', { user: 'public' })).data[0];
  const body = { data: { fullName: 'Rate Limited Applicant', email: 'rate-limit@example.test', consent: true, resume: { filename: 'resume.txt', contentBase64: Buffer.from('Resume').toString('base64') } } };
  assert.equal((await request(`/public/jobs/${job.id}/apply`, { user: 'public', method: 'POST', body })).status, 201);
  const blocked = await request(`/public/jobs/${job.id}/apply`, { user: 'public', method: 'POST', body });
  assert.equal(blocked.status, 429);
});

test('interview schedule writes validate calendar policy, prevent participant and room overlaps, and keep mock event history', async t => {
  const { request } = await instance(t);
  const existing = (await request('/records/interviews')).data[0];
  const start = new Date(existing.scheduledAt);
  const input = {
    applicationId: existing.applicationId,
    candidateId: existing.candidateId,
    jobId: existing.jobId,
    type: 'phone',
    scheduledAt: start.toISOString(),
    timezone: 'America/New_York',
    durationMinutes: 30,
    panel: ['demo-interviewer'],
  };
  const badType = await request('/records/interviews', { method: 'POST', body: { data: { ...input, type: 'unconfigured' } } });
  assert.equal(badType.status, 422, JSON.stringify(badType.payload));
  const badDate = await request('/records/interviews', { method: 'POST', body: { data: { ...input, scheduledAt: start.toISOString().slice(0, 10) } } });
  assert.equal(badDate.status, 422, JSON.stringify(badDate.payload));
  const badDuration = await request('/records/interviews', { method: 'POST', body: { data: { ...input, durationMinutes: 0 } } });
  assert.equal(badDuration.status, 422, JSON.stringify(badDuration.payload));
  const forgedEvent = await request('/records/interviews', { method: 'POST', body: { data: { ...input, scheduledAt: new Date(start.valueOf() + 2 * 60 * 60_000).toISOString(), calendarEvent: { id: 'forged' } } } });
  assert.equal(forgedEvent.status, 400, JSON.stringify(forgedEvent.payload));

  const participantConflict = await request('/records/interviews', { method: 'POST', body: { data: input } });
  assert.equal(participantConflict.status, 409, JSON.stringify(participantConflict.payload));
  assert.equal(participantConflict.payload.error, 'Interview schedule conflicts with another booking for the interviewer or room.');

  const adjacentInput = { ...input, scheduledAt: new Date(start.valueOf() + existing.durationMinutes * 60_000).toISOString() };
  const adjacent = await request('/records/interviews', { method: 'POST', body: { data: adjacentInput } });
  assert.equal(adjacent.status, 201, JSON.stringify(adjacent.payload));
  assert.equal(adjacent.data.calendarEvent.provider, 'local-mock');
  assert.equal(adjacent.data.calendarEvent.id, `mock-cal-${adjacent.data.id}`);
  assert.equal(adjacent.data.calendarEvent.startAt, adjacent.data.startAt);

  const roomStart = new Date(start.valueOf() + 4 * 60 * 60_000);
  const roomBooking = await request('/records/interviews', { method: 'POST', body: { data: { ...input, panel: [], roomId: 'room-a', scheduledAt: roomStart.toISOString() } } });
  assert.equal(roomBooking.status, 201, JSON.stringify(roomBooking.payload));
  const roomConflict = await request('/records/interviews', { method: 'POST', body: { data: { ...input, panel: [], roomId: 'room-a', scheduledAt: new Date(roomStart.valueOf() + 15 * 60_000).toISOString() } } });
  assert.equal(roomConflict.status, 409, JSON.stringify(roomConflict.payload));

  const conflictingEdit = await request(`/records/interviews/${adjacent.data.id}`, { method: 'PATCH', body: { data: { scheduledAt: start.toISOString() } } });
  assert.equal(conflictingEdit.status, 409, JSON.stringify(conflictingEdit.payload));
  assert.equal((await request(`/records/interviews/${adjacent.data.id}`)).data.scheduledAt, adjacent.data.scheduledAt);
  const invalidEdit = await request(`/records/interviews/${adjacent.data.id}`, { method: 'PATCH', body: { data: { scheduledAt: '2026-09-26' } } });
  assert.equal(invalidEdit.status, 422, JSON.stringify(invalidEdit.payload));

  const rescheduleConflict = await request(`/actions/interviews/${adjacent.data.id}/reschedule`, { method: 'POST', body: { data: { scheduledAt: new Date(start.valueOf() + 15 * 60_000).toISOString() } } });
  assert.equal(rescheduleConflict.status, 409, JSON.stringify(rescheduleConflict.payload));
  assert.equal((await request(`/records/interviews/${adjacent.data.id}`)).data.scheduledAt, adjacent.data.scheduledAt);

  const movedStart = new Date(start.valueOf() + 2 * 60 * 60_000).toISOString();
  const rescheduled = await request(`/actions/interviews/${adjacent.data.id}/reschedule`, { method: 'POST', body: { data: { scheduledAt: movedStart } } });
  assert.equal(rescheduled.status, 200, JSON.stringify(rescheduled.payload));
  assert.equal(rescheduled.data.calendarEvent.startAt, rescheduled.data.startAt);
  assert.equal(rescheduled.data.calendarEventHistory.at(-1).status, 'cancelled');
  assert.equal(rescheduled.data.calendarEventHistory.at(-1).startAt, adjacent.data.startAt);

  const cancelled = await request(`/actions/interviews/${adjacent.data.id}/cancel`, { method: 'POST', body: { data: { reason: 'Unavailable' } } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.payload));
  assert.equal(cancelled.data.calendarEvent.status, 'cancelled');
});

test('unknown identity and employee cannot read candidates or export them', async t => {
  const { request } = await instance(t);
  for (const user of ['does-not-exist', 'demo-employee']) {
    for (const route of ['/records/candidates', '/export/candidates']) {
      const result = await request(route, { user });
      assert.ok([401, 403].includes(result.status), `${user} ${route}: ${JSON.stringify(result.payload)}`);
    }
  }
});

test('configured candidate sources are canonicalized, disabled options rejected, and careers attribution follows its label', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.sources.find(source => source.id === 'careers-site').name = 'Company careers';
    config.sources.find(source => source.id === 'job-board').enabled = false;
  });
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Source test', email: 'source@example.test', source: 'careers-site' } } });
  assert.equal(candidate.status, 201, JSON.stringify(candidate.payload));
  assert.equal(candidate.data.source, 'Company careers');
  const unchanged = await request(`/records/candidates/${candidate.data.id}`, { method: 'PATCH', body: { data: { source: 'Company careers' } } });
  assert.equal(unchanged.status, 200, JSON.stringify(unchanged.payload));
  const invalidEdit = await request(`/records/candidates/${candidate.data.id}`, { method: 'PATCH', body: { data: { source: 'Job board' } } });
  assert.equal(invalidEdit.status, 422, JSON.stringify(invalidEdit.payload));
  assert.equal((await request(`/records/candidates/${candidate.data.id}`)).data.source, 'Company careers');
  const disabled = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Disabled source', source: 'Job board' } } });
  assert.equal(disabled.status, 422, JSON.stringify(disabled.payload));
  const badApplication = await request('/records/applications', { method: 'POST', body: { data: { candidateId: candidate.data.id, jobId: 'job-1', source: 'Job board' } } });
  assert.equal(badApplication.status, 422, JSON.stringify(badApplication.payload));

  const job = (await request('/public/jobs', { user: 'public' })).data[0];
  assert.ok(job);
  const applied = await request(`/public/jobs/${job.id}/apply`, { user: 'public', method: 'POST', body: { data: { fullName: 'Careers applicant', email: 'careers-source@example.test', consent: true, resume: { filename: 'resume.txt', contentBase64: Buffer.from('Resume').toString('base64') } } } });
  assert.equal(applied.status, 201, JSON.stringify(applied.payload));
  assert.equal((await request(`/records/candidates/${applied.data.candidateId}`)).data.source, 'Company careers');
  assert.equal((await request(`/records/applications/${applied.data.applicationId}`)).data.source, 'Company careers');
});

test('linked notes require a readable parent, are author-owned, and timeline uses safe projections', async t => {
  const { request } = await instance(t);
  const candidate = (await request('/records/candidates')).data[0];
  const bad = await request('/records/notes', { method: 'POST', body: { data: { body: 'orphan' } } });
  assert.equal(bad.status, 422);
  const note = await request('/records/notes', { method: 'POST', body: { data: { relatedKind: 'candidates', relatedId: candidate.id, body: 'private note', visibility: 'private', authorId: 'demo-employee' } } });
  assert.equal(note.status, 201, JSON.stringify(note.payload));
  assert.equal(note.data.authorId, 'demo-admin');
  const moved = await request(`/records/notes/${note.data.id}`, { method: 'PATCH', body: { data: { relatedKind: 'jobs', relatedId: 'forged' } } });
  assert.equal(moved.status, 409);
  const notes = await request('/records/notes');
  assert.ok(notes.data.some(row => row.id === note.data.id));
  const timeline = await request(`/timeline/candidates/${candidate.id}`);
  assert.equal(timeline.status, 200, JSON.stringify(timeline.payload));
  assert.ok(timeline.data.items.some(item => item.type === 'note' && item.body === 'private note'));
  assert.ok(timeline.data.items.every(item => !('salary' in item) && !('email' in item) && !('phone' in item)));
});

test('document uploads persist immutable versions, enforce replacement policy, and keep every file downloadable', async t => {
  const { request, dir } = await instance(t, 'corporate', config => {
    config.documents.allowReplacement = true;
    config.documents.categories = ['Resume', 'Other'];
  });
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Versioned Doc', email: 'versioned@example.test' } } });
  assert.equal(candidate.status, 201, JSON.stringify(candidate.payload));
  const first = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'resume-v1.txt', category: 'Resume', visibility: 'restricted', contentBase64: Buffer.from('resume version one').toString('base64'), mimeType: 'text/plain'
  } } });
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  assert.equal(first.data.version, 1);
  assert.equal(first.data.category, 'Resume');
  assert.equal(Object.hasOwn(first.data, 'contentBase64'), false, 'Document bytes must not be persisted with metadata');
  const second = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'resume-v2.txt', replacesDocumentId: first.data.id, category: 'Resume', visibility: 'restricted', contentBase64: Buffer.from('resume version two').toString('base64'), mimeType: 'text/plain'
  } } });
  assert.equal(second.status, 201, JSON.stringify(second.payload));
  assert.equal(second.data.version, 2);
  assert.equal(second.data.previousVersionId, first.data.id);
  assert.equal(second.data.rootDocumentId, first.data.id);
  assert.equal(Object.hasOwn(second.data, 'contentBase64'), false, 'Replacement bytes must not be persisted with metadata');
  assert.deepEqual(second.data.versionHistory.map(version => version.id), [first.data.id]);

  const versions = await request(`/documents/${second.data.id}/versions`);
  assert.equal(versions.status, 200, JSON.stringify(versions.payload));
  assert.deepEqual(versions.data.map(version => version.id), [first.data.id, second.data.id]);
  assert.equal(versions.data[0].filename, 'resume-v1.txt');
  assert.equal(versions.data[1].filename, 'resume-v2.txt');
  for (const [document, content] of [[first.data, 'resume version one'], [second.data, 'resume version two']]) {
    assert.equal(fs.existsSync(path.join(dir, document.storageName)), true);
    const downloaded = await request(`/documents/${document.id}/download`);
    assert.equal(downloaded.status, 200, JSON.stringify(downloaded.payload));
    assert.equal(downloaded.data, content);
  }

  const badReplacement = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'tampered.txt', replacesDocumentId: first.data.id, category: 'Resume', visibility: 'public', contentBase64: Buffer.from('tampered').toString('base64')
  } } });
  assert.equal(badReplacement.status, 409, JSON.stringify(badReplacement.payload));
  const invalidCategory = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'invalid.txt', category: 'Payroll', contentBase64: Buffer.from('invalid').toString('base64')
  } } });
  assert.equal(invalidCategory.status, 422, JSON.stringify(invalidCategory.payload));
})

test('bulk actions enforce row access, validate the whole request, and roll back persistence failures', async t => {
  const { request, dir } = await instance(t);
  const seeded = (await request('/records/candidates')).data[0];
  const outside = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Outside scope', email: 'outside@example.test', tags: [] } } });
  assert.equal(outside.status, 201, JSON.stringify(outside.payload));

  const denied = await request('/bulk/candidates', { user: 'demo-recruiter', method: 'POST', body: { data: { ids: [outside.data.id], action: 'addTags', payload: { tags: ['x'] } } } });
  assert.equal(denied.status, 403, JSON.stringify(denied.payload));
  const duplicate = await request('/bulk/candidates', { method: 'POST', body: { data: { ids: [seeded.id, seeded.id], action: 'addTags', payload: { tags: ['x'] } } } });
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.payload));
  const before = await request(`/records/candidates/${seeded.id}`);
  const secondBefore = await request(`/records/candidates/${outside.data.id}`);

  const { openDatabase } = require('../server/src/platform/database');
  const db = openDatabase(path.join(dir, 'ats.sqlite'));
  db.exec(`CREATE TRIGGER reject_bulk_second BEFORE UPDATE ON platform_records WHEN OLD.kind='candidates' AND OLD.id='${outside.data.id}' BEGIN SELECT RAISE(ABORT, 'forced bulk failure'); END`);
  db.close();
  const rollback = await request('/bulk/candidates', { method: 'POST', body: { data: { ids: [seeded.id, outside.data.id], action: 'addTags', payload: { tags: ['rollback-check'] } } } });
  assert.equal(rollback.status, 422, JSON.stringify(rollback.payload));
  assert.deepEqual((await request(`/records/candidates/${seeded.id}`)).data.tags, before.data.tags);
  assert.deepEqual((await request(`/records/candidates/${outside.data.id}`)).data.tags, secondBefore.data.tags);
});

test('bulk stage moves validate all transitions and owner assignment uses configured ownership fields', async t => {
  const { request } = await instance(t);
  const application = (await request('/records/applications')).data[0];
  const invalid = await request('/bulk/applications', { method: 'POST', body: { data: { ids: [application.id], action: 'moveStage', payload: { stage: 'not-a-pipeline-stage' } } } });
  assert.equal(invalid.status, 422, JSON.stringify(invalid.payload));
  assert.equal((await request(`/records/applications/${application.id}`)).data.stage, application.stage);

  const candidate = (await request('/records/candidates')).data[0];
  const badOwner = await request('/bulk/candidates', { method: 'POST', body: { data: { ids: [candidate.id], action: 'assignOwner', payload: { ownerId: 'missing-user' } } } });
  assert.equal(badOwner.status, 403, JSON.stringify(badOwner.payload));
  const assigned = await request('/bulk/candidates', { method: 'POST', body: { data: { ids: [candidate.id], action: 'assignOwner', payload: { ownerId: 'demo-admin' } } } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.payload));
  assert.equal((await request(`/records/candidates/${candidate.id}`)).data.ownerId, 'demo-admin');
});

test('configured admin permission revocation applies at service layer', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.roles.find(role => role.id === 'admin').permissions = { dashboard: ['view'] };
  });
  for (const route of ['/records/candidates', '/export/candidates']) {
    const result = await request(route);
    assert.equal(result.status, 403, JSON.stringify(result.payload));
  }
  const mutation = await request('/records/jobs', { method: 'POST', body: { data: { title: 'Unauthorized role' } } });
  assert.equal(mutation.status, 403, JSON.stringify(mutation.payload));
});

test('client contracts are nested, versioned, audited actions with configured fee and guarantee terms', async t => {
  const { request } = await instance(t, 'agency', config => {
    config.agency.defaultGuaranteeDays = 42;
    config.agency.feeTypes = ['fixed', 'percentage'];
  });
  const client = (await request('/records/clients')).data[0];
  const created = await request(`/clients/${client.id}/contracts`, { method: 'POST', body: { data: {
    effectiveDate: '2026-01-01', expiryDate: '2027-01-01', feeType: 'fixed', feeRate: 2400
  } } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.data.version, 1);
  assert.equal(created.data.replacementGuaranteeDays, 42);
  const updated = await request(`/clients/${client.id}/contracts/${created.data.id}`, { method: 'PATCH', body: { data: { feeRate: 4200 } } });
  assert.equal(updated.status, 200, JSON.stringify(updated.payload));
  assert.equal(updated.data.version, 2);
  assert.equal(updated.data.versions[0].feeRate, 2400);
  assert.equal(updated.data.versions[1].feeRate, 4200);
  const ended = await request(`/clients/${client.id}/contracts/${created.data.id}/status`, { method: 'POST', body: { data: { status: 'terminated' } } });
  assert.equal(ended.status, 200, JSON.stringify(ended.payload));
  assert.equal(ended.data.status, 'terminated');
  assert.deepEqual(ended.data.history.map(event => event.type), ['created', 'terms_updated', 'status_changed']);
  const contractAudit = (await request('/records/audit')).data.filter(event => event.recordId === client.id && event.action.startsWith('client.contract.'));
  assert.deepEqual(contractAudit.map(event => event.action).sort(), ['client.contract.created', 'client.contract.updated', 'client.contract.status_changed'].sort());
  const badExpiry = await request(`/clients/${client.id}/contracts`, { method: 'POST', body: { data: { effectiveDate: '2026-04-01', expiryDate: '2026-03-31', feeType: 'fixed', feeRate: 5 } } });
  assert.equal(badExpiry.status, 422);
  const badFee = await request(`/clients/${client.id}/contracts`, { method: 'POST', body: { data: { effectiveDate: '2026-04-01', feeType: 'percentage', feeRate: 101 } } });
  assert.equal(badFee.status, 422);
  const genericCreate = await request('/records/clients', { method: 'POST', body: { data: { name: 'Forged contract', contracts: [created.data] } } });
  assert.equal(genericCreate.status, 400);
  const genericEdit = await request(`/records/clients/${client.id}`, { method: 'PATCH', body: { data: { contracts: [] } } });
  assert.equal(genericEdit.status, 409);
  const foreignClient = await request('/records/clients', { method: 'POST', body: { data: { name: 'Foreign document owner' } } });
  const foreignDocument = await request('/records/documents', { method: 'POST', body: { data: { clientId: foreignClient.data.id, filename: 'foreign-contract.pdf', visibility: 'public' } } });
  assert.equal(foreignDocument.status, 201, JSON.stringify(foreignDocument.payload));
  const crossClientDocument = await request(`/clients/${client.id}/contracts`, { method: 'POST', body: { data: {
    effectiveDate: '2026-04-01', feeType: 'fixed', feeRate: 5, documentReference: foreignDocument.data.id
  } } });
  assert.equal(crossClientDocument.status, 422);
});

test('client contract routes enforce feature, permission and client row scope', async t => {
  const { request } = await instance(t, 'agency');
  const client = (await request('/records/clients')).data[0];
  const body = { data: { effectiveDate: '2026-01-01', expiryDate: '2027-01-01', feeType: 'fixed', feeRate: 500 } };
  assert.equal((await request(`/clients/${client.id}/contracts`, { user: 'demo-recruiter', method: 'POST', body })).status, 403);
  const consultantClient = await request('/records/clients', { method: 'POST', body: { data: { name: 'Consultant scoped', ownerId: 'demo-agency-consultant' } } });
  assert.equal(consultantClient.status, 201, JSON.stringify(consultantClient.payload));
  assert.equal((await request(`/clients/${consultantClient.data.id}/contracts`, { user: 'demo-agency-consultant', method: 'POST', body })).status, 201);
  assert.equal((await request(`/clients/${client.id}/contracts`, { user: 'demo-agency-consultant', method: 'POST', body })).status, 404);
  const { request: disabledContracts } = await instance(t, 'agency', config => { config.agency.contracts = false; });
  const disabledClient = (await disabledContracts('/records/clients')).data[0];
  assert.equal((await disabledContracts(`/clients/${disabledClient.id}/contracts`, { method: 'POST', body })).status, 403);
  const { request: disabledAgency } = await instance(t, 'agency', config => { config.modules.agency = false; });
  assert.equal((await disabledAgency(`/clients/${client.id}/contracts`, { method: 'POST', body })).status, 403);
});

test('active client contracts supply placement and invoice fee terms and contract guarantee duration', async t => {
  const { request } = await instance(t, 'agency', config => { config.agency.defaultGuaranteeDays = 42; });
  const candidate = (await request('/records/candidates')).data[0];
  const job = (await request('/records/jobs')).data[0];
  for (const [name, rate] of [['Fee A', 2400], ['Fee B', 4200]]) {
    const client = await request('/records/clients', { method: 'POST', body: { data: { name } } });
    assert.equal(client.status, 201, JSON.stringify(client.payload));
    const contract = await request(`/clients/${client.data.id}/contracts`, { method: 'POST', body: { data: {
      effectiveDate: '2026-01-01', expiryDate: '2027-01-01', feeType: 'fixed', feeRate: rate, replacementGuaranteeDays: 35
    } } });
    assert.equal(contract.status, 201, JSON.stringify(contract.payload));
    const placement = await request('/records/placements', { method: 'POST', body: { data: {
      clientId: client.data.id, candidateId: candidate.id, jobId: job.id, startDate: '2026-09-01'
    } } });
    assert.equal(placement.status, 201, JSON.stringify(placement.payload));
    assert.equal(placement.data.contractId, contract.data.id);
    assert.equal(placement.data.fee, rate);
    assert.equal(placement.data.feeType, 'fixed');
    assert.equal(placement.data.guaranteeDays, 35);
    assert.equal(placement.data.guaranteeExpiry, '2026-10-06');
    const invoice = await request(`/actions/placements/${placement.data.id}/invoice`, { method: 'POST', body: { data: {} } });
    assert.equal(invoice.status, 200, JSON.stringify(invoice.payload));
    assert.equal(invoice.data.amount, rate);
  }
});

test('saved views are validated, owner-scoped, and run only over readable records', async t => {
  const { request } = await instance(t);
  const privateView = await request('/saved-views', { user: 'demo-recruiter', method: 'POST', body: { data: {
    name: 'My active candidates', kind: 'candidates', filters: { owner: 'me', status: 'active' }
  } } });
  assert.equal(privateView.status, 201, JSON.stringify(privateView.payload));
  assert.equal(privateView.data.ownerId, 'demo-recruiter');
  assert.equal(privateView.data.visibility, 'private');
  const recruiterViews = await request('/saved-views', { user: 'demo-recruiter' });
  assert.ok(recruiterViews.data.some(view => view.id === privateView.data.id));
  const employeeViews = await request('/saved-views', { user: 'demo-employee' });
  assert.equal(employeeViews.status, 200);
  assert.ok(!employeeViews.data.some(view => view.id === privateView.data.id), 'Private view is hidden from another user');
  const blockedRun = await request(`/saved-views/${privateView.data.id}/run`, { user: 'demo-employee' });
  assert.equal(blockedRun.status, 404);
  const blockedEdit = await request(`/saved-views/${privateView.data.id}`, { user: 'demo-employee', method: 'PATCH', body: { data: { name: 'Changed' } } });
  assert.equal(blockedEdit.status, 404);
  const blockedDelete = await request(`/saved-views/${privateView.data.id}`, { user: 'demo-employee', method: 'DELETE' });
  assert.equal(blockedDelete.status, 404);

  const ran = await request(`/saved-views/${privateView.data.id}/run`, { user: 'demo-recruiter' });
  assert.equal(ran.status, 200, JSON.stringify(ran.payload));
  assert.equal(ran.data.count, ran.data.rows.length);
  assert.ok(ran.data.rows.every(row => row.status === 'active' && [row.ownerId, row.recruiterId, row.hiringManagerId, row.assignedTo, row.assigneeId, row.userId, row.createdBy].includes('demo-recruiter')));
  assert.ok(ran.data.rows.length <= (await request('/records/candidates', { user: 'demo-recruiter' })).data.length);

  const invalid = await request('/saved-views', { user: 'demo-recruiter', method: 'POST', body: { data: {
    name: 'Unsafe', kind: 'candidates', filters: { customPath: 'compensation.salary' }
  } } });
  assert.equal(invalid.status, 422);
  const genericBypass = await request('/records/savedViews', { user: 'demo-recruiter', method: 'POST', body: { data: {
    name: 'Bypass', kind: 'candidates', ownerId: 'demo-admin', visibility: 'shared', filters: {}
  } } });
  assert.equal(genericBypass.status, 400);
  const noTargetAccess = await request('/saved-views', { user: 'demo-employee', method: 'POST', body: { data: { name: 'Candidates', kind: 'candidates' } } });
  assert.equal(noTargetAccess.status, 422);
});

test('shared saved views require organization sharing to be enabled and still respect viewer record scope', async t => {
  const { request } = await instance(t);
  const shared = await request('/saved-views', { method: 'POST', body: { data: {
    name: 'Open jobs', kind: 'jobs', visibility: 'shared', filters: { status: 'open' }
  } } });
  assert.equal(shared.status, 201, JSON.stringify(shared.payload));
  const recruiterViews = await request('/saved-views', { user: 'demo-recruiter' });
  assert.ok(recruiterViews.data.some(view => view.id === shared.data.id));
  const recruiterRun = await request(`/saved-views/${shared.data.id}/run`, { user: 'demo-recruiter' });
  const recruiterJobs = await request('/records/jobs', { user: 'demo-recruiter' });
  assert.equal(recruiterRun.status, 200, JSON.stringify(recruiterRun.payload));
  assert.ok(recruiterRun.data.rows.every(row => row.status === 'open'));
  assert.ok(recruiterRun.data.rows.every(row => recruiterJobs.data.some(job => job.id === row.id)), 'A shared view cannot expand the viewer’s accessible record scope');

  const { request: noShareRequest } = await instance(t, 'corporate', config => { config.savedViews.allowShared = false; });
  const rejected = await noShareRequest('/saved-views', { method: 'POST', body: { data: { name: 'Shared', kind: 'jobs', visibility: 'shared' } } });
  assert.equal(rejected.status, 422);
  const { request: disabledRequest } = await instance(t, 'corporate', config => { config.savedViews.enabled = false; });
  assert.equal((await disabledRequest('/saved-views')).status, 403);
  assert.equal((await disabledRequest('/records/savedViews')).status, 403);
});

test('generic editing cannot bypass pipeline transition rules', async t => {
  const { request } = await instance(t);
  const applications = await request('/records/applications');
  assert.equal(applications.status, 200, JSON.stringify(applications.payload));
  assert.ok(Array.isArray(applications.data) && applications.data.length, 'Useful sample applications must exist');
  const application = applications.data[0];
  const result = await request(`/records/applications/${application.id}`, {
    method: 'PATCH', body: { data: { stage: 'hired', status: 'hired' } }
  });
  assert.ok([403, 409, 422].includes(result.status), JSON.stringify(result.payload));
  const after = await request(`/records/applications/${application.id}`);
  assert.equal(after.data.stage, application.stage);
  assert.equal(after.data.status, application.status);
});

test('generic writes reject forged internal records, workflow fields, and relationship edits', async t => {
  const { request } = await instance(t);
  for (const kind of ['approvals', 'audit', 'outbox', 'automations', 'referrals', 'notifications']) {
    const result = await request(`/records/${kind}`, { method: 'POST', body: { data: { title: 'Forged', status: 'approved', action: 'privacy-deletion' } } });
    assert.equal(result.status, 400, `${kind}: ${JSON.stringify(result.payload)}`);
  }
  for (const data of [
    { title: 'Forged metadata', createdBy: 'demo-admin' },
    { title: 'Forged approval', approvalsCompleted: ['demo-manager'] },
    { title: 'Forged history', approvalHistory: [{ status: 'approved' }] },
  ]) {
    const result = await request('/records/jobs', { method: 'POST', body: { data } });
    assert.equal(result.status, 400, JSON.stringify(result.payload));
  }
  const app = (await request('/records/applications')).data[0];
  for (const data of [{ candidateId: 'candidate_other' }, { history: ['approved'] }, { checklist: [{ status: 'completed' }] }]) {
    const result = await request(`/records/applications/${app.id}`, { method: 'PATCH', body: { data } });
    assert.ok([400, 409].includes(result.status), JSON.stringify(result.payload));
  }
  const after = await request(`/records/applications/${app.id}`);
  assert.equal(after.data.candidateId, app.candidateId);
  const job = (await request('/records/jobs')).data[0];
  const invalidOwner = await request(`/records/jobs/${job.id}`, { method: 'PATCH', body: { data: { recruiterId: 'unknown-user' } } });
  assert.equal(invalidOwner.status, 422, JSON.stringify(invalidOwner.payload));
});

test('imports allow only supported business fields and reject forged approval data', async t => {
  const { request } = await instance(t);
  const forged = await request('/import/candidates', { method: 'POST', body: { data: [{ name: 'Forged', email: 'forged@example.test', createdBy: 'demo-admin' }] } });
  assert.equal(forged.status, 422, JSON.stringify(forged.payload));
  const internal = await request('/import/approvals', { method: 'POST', body: { data: [{ title: 'Privacy approval', workflow: 'privacy-deletion', status: 'approved' }] } });
  assert.ok([400, 422].includes(internal.status), JSON.stringify(internal.payload));
  const good = await request('/import/candidates', { method: 'POST', body: { data: [{ name: 'Import Safe', email: 'import.safe@example.test', source: 'CSV' }] } });
  assert.equal(good.status, 201, JSON.stringify(good.payload));
});

test('configured sequential approval creates a publishable job and public application', async t => {
  const { request } = await instance(t, 'corporate');
  const requisitions = await request('/records/requisitions');
  assert.equal(requisitions.status, 200, JSON.stringify(requisitions.payload));
  const requisition = requisitions.data.find(row => row.status === 'pending');
  assert.ok(requisition, 'Seed should contain a pending hiring request');
  const endpoint = `/actions/requisitions/${requisition.id}`;
  const premature = await request(`${endpoint}/approve`, { user: 'demo-hr-head', method: 'POST', body: { data: { comment: 'Premature' } } });
  assert.equal(premature.status, 403, JSON.stringify(premature.payload));
  const first = await request(`${endpoint}/approve`, { user: 'demo-manager', method: 'POST', body: { data: { comment: 'Approved headcount' } } });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(first.data.status, 'pending');
  const second = await request(`${endpoint}/approve`, { user: 'demo-hr-head', method: 'POST', body: { data: { comment: 'Budget approved' } } });
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  assert.equal(second.data.status, 'approved');
  const converted = await request(`${endpoint}/create-job`, { method: 'POST', body: { data: {} } });
  assert.equal(converted.status, 200, JSON.stringify(converted.payload));
  assert.equal(converted.data.requisitionId, requisition.id);
  const published = await request(`/actions/jobs/${converted.data.id}/publish`, { method: 'POST', body: { data: { visibility: 'public' } } });
  assert.equal(published.status, 200, JSON.stringify(published.payload));
  const preexisting = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Taylor Example', email: 'taylor@example.test' } } });
  assert.equal(preexisting.status, 201, JSON.stringify(preexisting.payload));
  const jobs = await request('/public/jobs', { user: 'no-login' });
  assert.equal(jobs.status, 200, JSON.stringify(jobs.payload));
  assert.ok(jobs.data.some(job => job.id === published.data.id));
  const invalid = await request(`/public/jobs/${published.data.id}/apply`, { user: 'no-login', method: 'POST', body: { data: { fullName: 'Taylor Example', email: 'taylor@example.test', consent: false } } });
  assert.equal(invalid.status, 422, JSON.stringify(invalid.payload));
  const applied = await request(`/public/jobs/${published.data.id}/apply`, { user: 'no-login', method: 'POST', body: { data: { fullName: 'Taylor Example', email: 'taylor@example.test', consent: true, resume: { filename: 'resume.txt', contentBase64: Buffer.from('Sample resume').toString('base64') } } } });
  assert.equal(applied.status, 201, JSON.stringify(applied.payload));
  assert.notEqual(applied.data.candidateId, preexisting.data.id, 'Public application must not silently attach to an existing candidate by email');
  const persisted = await request(`/records/applications/${applied.data.applicationId}`);
  assert.equal(persisted.status, 200, JSON.stringify(persisted.payload));
  assert.equal(persisted.data.jobId, converted.data.id);
  const duplicate = await request(`/public/jobs/${converted.data.id}/apply`, { user: 'no-login', method: 'POST', body: { data: { fullName: 'Taylor Example', email: ' TAYLOR@example.test ', consent: true, resume: { filename: 'resume.txt', contentBase64: Buffer.from('Sample resume').toString('base64') } } } });
  assert.equal(duplicate.status, 201, JSON.stringify(duplicate.payload));
  assert.deepEqual(duplicate.data, { status: 'received' });
});

test('public application stores configured file answers as metadata without duplicating attachment bytes', async t => {
  const { request } = await instance(t, 'corporate', config => {
    const fields = config.applicationForms[0].sections[0].fields;
    const resumeIndex = fields.findIndex(field => field.type === 'file');
    fields[resumeIndex] = { field: 'candidateCvUpload', label: 'Candidate CV', type: 'file', required: true };
  });
  const job = (await request('/public/jobs', { user: 'no-login' })).data[0];
  const fileContent = 'Private resume content that belongs only in document storage';
  const contentBase64 = Buffer.from(fileContent).toString('base64');
  const applied = await request(`/public/jobs/${job.id}/apply`, { user: 'no-login', method: 'POST', body: { data: {
    fullName: 'Private Applicant', email: 'private-applicant@example.test', consent: true,
    answers: { candidateCvUpload: { filename: '../private-cv.txt', mimeType: 'text/plain', contentBase64 } }
  } } });
  assert.equal(applied.status, 201, JSON.stringify(applied.payload));
  assert.equal(JSON.stringify(applied.payload).includes(contentBase64), false, 'Application response must not echo attachment bytes');

  const persisted = await request(`/records/applications/${applied.data.applicationId}`);
  assert.equal(persisted.status, 200, JSON.stringify(persisted.payload));
  assert.deepEqual(persisted.data.answers.candidateCvUpload, { filename: 'private-cv.txt', mimeType: 'text/plain' });
  assert.equal(JSON.stringify(persisted.data).includes(contentBase64), false, 'Application answers must not persist attachment bytes');
  assert.equal(JSON.stringify(persisted.data).includes('contentBase64'), false, 'Application answers must not retain the upload payload key');

  const documents = await request('/records/documents');
  const document = documents.data.find(item => item.applicationId === applied.data.applicationId);
  assert.ok(document, 'Configured CV upload should still create a document record');
  assert.equal(document.filename, 'private-cv.txt');
  assert.equal(Object.hasOwn(document, 'contentBase64'), false, 'Document metadata must not persist attachment bytes');
  const download = await request(`/documents/${document.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.data, fileContent);
});

test('employee referral submission is owned, normalized, and duplicate review does not create another candidate', async t => {
  const { request } = await instance(t, 'startup', config => {
    config.modules.referrals = true;
    config.referrals.enabled = true;
  });
  const first = await request('/referrals/submit', { user: 'demo-employee', method: 'POST', body: { data: {
    candidate: { name: 'Jordan Applicant', email: ' Jordan@Example.test ', phone: '555-0100', consent: true }, jobId: null
  } } });
  assert.equal(first.status, 201, JSON.stringify(first.payload));
  assert.equal(first.data.status, 'submitted');
  assert.equal(first.data.candidateName, 'Jordan Applicant');
  assert.ok(!('candidateId' in first.data) && !('candidateEmail' in first.data));
  const candidates = await request('/records/candidates');
  const created = candidates.data.filter(candidate => candidate.email === 'jordan@example.test');
  assert.equal(created.length, 1);

  const second = await request('/referrals/submit', { user: 'demo-employee', method: 'POST', body: { data: {
    candidate: { name: 'Jordan Applicant', email: 'jordan@example.test', phone: '555-0100', consent: true }, jobId: null
  } } });
  assert.equal(second.status, 201, JSON.stringify(second.payload));
  assert.equal(second.data.status, 'duplicate_review');
  assert.ok(!('candidateId' in second.data) && !('candidateEmail' in second.data));
  const after = await request('/records/candidates');
  assert.equal(after.data.filter(candidate => candidate.email === 'jordan@example.test').length, 1, 'Review referrals must not create a candidate until duplicate review is resolved');
  const mine = await request('/referrals/mine', { user: 'demo-employee' });
  assert.equal(mine.status, 200, JSON.stringify(mine.payload));
  assert.equal(mine.data.length, 2);
  assert.ok(mine.data.every(referral => !('candidateId' in referral) && !('candidateEmail' in referral)));
});

test('candidate anonymization scrubs and removes linked document storage after commit', async t => {
  const { request, dir } = await instance(t, 'corporate', config => { config.privacy.deletionApprovalRequired = false; });
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Document Subject', email: 'document.subject@example.test' } } });
  assert.equal(candidate.status, 201, JSON.stringify(candidate.payload));
  const document = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'private-resume.txt', contentBase64: Buffer.from('Private resume text').toString('base64'), mimeType: 'text/plain'
  } } });
  assert.equal(document.status, 201, JSON.stringify(document.payload));
  const storagePath = path.join(dir, document.data.storageName);
  assert.equal(fs.existsSync(storagePath), true);
  const anonymized = await request(`/actions/candidates/${candidate.data.id}/anonymize`, { method: 'POST', body: { data: {} } });
  assert.equal(anonymized.status, 200, JSON.stringify(anonymized.payload));
  assert.equal(fs.existsSync(storagePath), false, 'Physical document storage is removed after the privacy transaction commits');
  const unavailable = await request(`/documents/${document.data.id}/download`);
  assert.equal(unavailable.status, 404);
});

test('agency workflow tracks a submission through placement and invoice with a guarantee', async t => {
  const { request } = await instance(t, 'agency');
  const clients = await request('/records/clients');
  const submissions = await request('/records/submissions');
  assert.equal(clients.status, 200, JSON.stringify(clients.payload));
  assert.equal(submissions.status, 200, JSON.stringify(submissions.payload));
  assert.ok(clients.data.length && submissions.data.length);
  const submission = submissions.data[0];
  assert.equal(submission.clientId, clients.data[0].id);
  const placement = await request('/records/placements', {
    method: 'POST', body: { data: { clientId: submission.clientId, candidateId: submission.candidateId, jobId: submission.jobId,
      submissionId: submission.id, startDate: '2026-11-01', feeType: 'percentage', fee: 12000, guaranteeDays: 90 } }
  });
  assert.equal(placement.status, 201, JSON.stringify(placement.payload));
  assert.ok(placement.data.guaranteeExpiry, 'Placement needs a computed guarantee expiry');
  const invoice = await request(`/actions/placements/${placement.data.id}/invoice`, { method: 'POST', body: { data: { dueDate: '2026-12-01' } } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.payload));
  assert.equal(invoice.data.placementId, placement.data.id);
  assert.equal(invoice.data.amount, placement.data.fee);
  const persisted = await request(`/records/invoices/${invoice.data.id}`);
  assert.equal(persisted.status, 200, JSON.stringify(persisted.payload));
  assert.equal(persisted.data.clientId, clients.data[0].id);
});

test('guarantee state is restricted to audited dedicated actions and replacement stays with its client', async t => {
  const { request } = await instance(t, 'agency');
  const client = await request('/records/clients', { method: 'POST', body: { data: { name: 'Guarantee Client' } } });
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Replacement Candidate', consent: true } } });
  const job = await request('/records/jobs', { method: 'POST', body: { data: { title: 'Client Role', clientId: client.data.id } } });
  const placement = await request('/records/placements', { method: 'POST', body: { data: { clientId: client.data.id, candidateId: candidate.data.id, jobId: job.data.id, startDate: new Date().toISOString().slice(0, 10), fee: 7000 } } });
  assert.equal(placement.status, 201, JSON.stringify(placement.payload));
  const forgedCreate = await request('/records/placements', { method: 'POST', body: { data: { clientId: client.data.id, candidateId: candidate.data.id, guaranteeStatus: 'approved' } } });
  assert.equal(forgedCreate.status, 400);
  const forgedPatch = await request(`/records/placements/${placement.data.id}`, { method: 'PATCH', body: { data: { guaranteeStatus: 'approved', guaranteeHistory: [{ type: 'approved' }] } } });
  assert.equal(forgedPatch.status, 409);
  const requested = await request(`/actions/placements/${placement.data.id}/guarantee-request`, { method: 'POST', body: { data: { reason: 'Replacement requested' } } });
  assert.equal(requested.status, 200, JSON.stringify(requested.payload));
  const reviewed = await request(`/actions/placements/${placement.data.id}/guarantee-review`, { method: 'POST', body: { data: { comment: 'Reviewed' } } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.payload));
  const approved = await request(`/actions/placements/${placement.data.id}/guarantee-approve`, { method: 'POST', body: { data: {} } });
  assert.equal(approved.data.guaranteeStatus, 'approved');
  const replacement = await request(`/actions/placements/${placement.data.id}/guarantee-replacement`, { method: 'POST', body: { data: { candidateId: candidate.data.id, jobId: job.data.id } } });
  assert.equal(replacement.status, 200, JSON.stringify(replacement.payload));
  assert.equal(replacement.data.submission.clientId, client.data.id);
  assert.equal(replacement.data.submission.replacementForPlacementId, placement.data.id);
  const second = await request(`/actions/placements/${placement.data.id}/guarantee-replacement`, { method: 'POST', body: { data: { candidateId: candidate.data.id, jobId: job.data.id } } });
  assert.equal(second.status, 409);
});

test('talent pool members require dedicated actions, candidate scope and consent, with safe nested projections', async t => {
  const { request } = await instance(t, 'corporate');
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Consented Pool Candidate', email: 'pool@example.test', consent: true, compensation: 250000 } } });
  const noConsent = await request('/records/candidates', { method: 'POST', body: { data: { name: 'No Consent Candidate' } } });
  const pool = await request('/records/talentPools', { method: 'POST', body: { data: { name: 'Engineering Pool' } } });
  assert.equal(pool.status, 201, JSON.stringify(pool.payload));
  const forgedCreate = await request('/records/talentPools', { method: 'POST', body: { data: { name: 'Forged Pool', members: [{ candidateId: candidate.data.id }] } } });
  assert.equal(forgedCreate.status, 400);
  const forgedPatch = await request(`/records/talentPools/${pool.data.id}`, { method: 'PATCH', body: { data: { members: [{ candidateId: candidate.data.id }] } } });
  assert.equal(forgedPatch.status, 409);
  const denied = await request(`/actions/talentPools/${pool.data.id}/members`, { method: 'POST', body: { data: { candidateId: noConsent.data.id } } });
  assert.equal(denied.status, 403);
  const added = await request(`/actions/talentPools/${pool.data.id}/members`, { method: 'POST', body: { data: { candidateId: candidate.data.id, note: 'Follow up', followUpAt: '2026-10-01' } } });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  assert.equal(added.data.members[0].candidate.id, candidate.data.id);
  assert.equal('compensation' in added.data.members[0].candidate, false);
  const exported = await request('/export/talentPools');
  assert.equal(exported.data.rows.find(row => row.id === pool.data.id).members[0].candidate.id, candidate.data.id);
  const edited = await request(`/actions/talentPools/${pool.data.id}/members/${candidate.data.id}`, { method: 'PATCH', body: { data: { note: 'Updated' } } });
  assert.equal(edited.data.members[0].note, 'Updated');
  const removed = await request(`/actions/talentPools/${pool.data.id}/members/${candidate.data.id}`, { method: 'DELETE' });
  assert.deepEqual(removed.data.members, []);
});

test('configuration draft activates only when valid and rollback restores behavior', async t => {
  const { request, config } = await instance(t);
  const invalid = structuredClone(config);
  invalid.pipelines[0].transitions[0].to = 'missing-stage';
  const savedInvalid = await request('/config/draft', { method: 'PUT', body: { data: invalid } });
  assert.equal(savedInvalid.status, 200, JSON.stringify(savedInvalid.payload));
  const rejected = await request('/config/activate', { method: 'POST', body: { data: { note: 'Should fail' } } });
  assert.equal(rejected.status, 422, JSON.stringify(rejected.payload));
  const before = await request('/bootstrap');
  assert.notEqual(before.data.config.pipelines[0].transitions[0].to, 'missing-stage');
  const draft = structuredClone(config);
  draft.terminology.jobs = 'Positions';
  draft.modules.referrals = true;
  assert.equal((await request('/config/draft', { method: 'PUT', body: { data: draft } })).status, 200);
  const activated = await request('/config/activate', { method: 'POST', body: { data: { note: 'Hiring terms' } } });
  assert.equal(activated.status, 200, JSON.stringify(activated.payload));
  const changed = await request('/bootstrap');
  assert.equal(changed.data.config.terminology.jobs, 'Positions');
  assert.equal(changed.data.modules.referrals, true);
  const history = await request('/config/history');
  assert.equal(history.status, 200);
  assert.ok(history.data.length >= 2);
  const rolled = await request('/config/rollback', { method: 'POST', body: { data: { version: 1 } } });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.payload));
  const restored = await request('/bootstrap');
  assert.equal(restored.data.config.terminology.jobs, config.terminology.jobs);
  assert.equal(restored.data.modules.referrals, config.modules.referrals);
});

test('pipeline transition graph rejects skips and stage requirements', async t => {
  const { request } = await instance(t);
  const apps = await request('/records/applications');
  const application = apps.data[0];
  const jump = await request(`/actions/applications/${application.id}/move-stage`, { method: 'POST', body: { data: { stage: 'hired' } } });
  assert.equal(jump.status, 409, JSON.stringify(jump.payload));
  const first = await request(`/actions/applications/${application.id}/move-stage`, { method: 'POST', body: { data: { stage: 'screening' } } });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  const gated = await request(`/actions/applications/${application.id}/move-stage`, { method: 'POST', body: { data: { stage: 'interview' } } });
  assert.equal(gated.status, 409, JSON.stringify(gated.payload));
  const after = await request(`/records/applications/${application.id}`);
  assert.equal(after.data.stage, 'screening');
});

test('sensitive candidate compensation is masked from recruiters and never exported by them', async t => {
  const { request } = await instance(t);
  const candidateList = await request('/records/candidates', { user: 'demo-recruiter' });
  assert.equal(candidateList.status, 200, JSON.stringify(candidateList.payload));
  const candidate = candidateList.data.find(row => row.email === 'priya@example.test');
  assert.ok(candidate, 'Recruiter should see their owned candidate');
  for (const field of ['expectedSalary', 'currentSalary']) assert.ok(candidate[field] == null || candidate[field] === 'Restricted', `${field} leaked`);
  const exportResult = await request('/export/candidates', { user: 'demo-recruiter' });
  assert.equal(exportResult.status, 403, JSON.stringify(exportResult.payload));
  const adminList = await request('/records/candidates');
  assert.equal(adminList.status, 200);
  assert.equal(typeof adminList.data.find(row => row.id === candidate.id).expectedSalary, 'number');
});

test('public application enforces selected job form and persists configured answers', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.applicationForms[0].sections[0].fields.push({ field: 'workAuthorization', label: 'Authorized to work?', type: 'checkbox', required: true });
  });
  const jobs = await request('/public/jobs', { user: 'no-login' });
  assert.equal(jobs.status, 200, JSON.stringify(jobs.payload));
  const job = jobs.data[0];
  const detail = await request(`/public/jobs/${job.id}`, { user: 'no-login' });
  assert.equal(detail.status, 200, JSON.stringify(detail.payload));
  assert.ok(detail.data.applicationForm?.sections?.some(section => section.fields?.some(field => field.field === 'workAuthorization' || field.id === 'workAuthorization')), 'Job detail should expose configured application form');
  const common = { fullName: 'Robin Example', email: 'robin@example.test', consent: true, resume: { filename: 'resume.txt', contentBase64: Buffer.from('Sample resume').toString('base64') } };
  const missing = await request(`/public/jobs/${job.id}/apply`, { user: 'no-login', method: 'POST', body: { data: common } });
  assert.equal(missing.status, 422, JSON.stringify(missing.payload));
  const valid = await request(`/public/jobs/${job.id}/apply`, { user: 'no-login', method: 'POST', body: { data: { ...common, workAuthorization: true } } });
  assert.equal(valid.status, 201, JSON.stringify(valid.payload));
  const saved = await request(`/records/applications/${valid.data.applicationId}`);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.answers?.workAuthorization, true);
});

test('corporate multi-step offer approval and acceptance start configured onboarding once', async t => {
  const { request, config } = await instance(t);
  const applications = await request('/records/applications');
  const app = applications.data[0];
  const created = await request('/records/offers', { user: 'demo-hr-head', method: 'POST', body: { data: {
    applicationId: app.id, candidateId: app.candidateId, jobId: app.jobId, salary: 180000, currency: config.regional.currency, joiningDate: '2026-12-01'
  } } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const endpoint = `/actions/offers/${created.data.id}`;
  const skip = await request(`${endpoint}/approve`, { user: 'demo-ceo', method: 'POST', body: { data: { comment: 'Early' } } });
  assert.equal(skip.status, 403, JSON.stringify(skip.payload));
  const hr = await request(`${endpoint}/approve`, { user: 'demo-hr-head', method: 'POST', body: { data: { comment: 'Approved' } } });
  assert.equal(hr.status, 200, JSON.stringify(hr.payload));
  assert.equal(hr.data.status, 'pending_approval');
  const ceo = await request(`${endpoint}/approve`, { user: 'demo-ceo', method: 'POST', body: { data: { comment: 'Approved' } } });
  assert.equal(ceo.status, 200, JSON.stringify(ceo.payload));
  assert.equal(ceo.data.status, 'sent');
  const accepted = await request(`${endpoint}/accept`, { method: 'POST', body: { data: {} } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.data.status, 'accepted');
  const plans = await request('/records/onboarding');
  assert.equal(plans.status, 200);
  const plan = plans.data.find(row => row.offerId === created.data.id);
  assert.ok(plan, 'Accepted offer should create an onboarding plan');
  assert.ok(Array.isArray(plan.checklist) && plan.checklist.length, 'Onboarding tasks should reflect configured template');
  const genericEdit = await request(`/records/onboarding/${plan.id}`, { method: 'PATCH', body: { data: { checklist: [] } } });
  assert.equal(genericEdit.status, 409, JSON.stringify(genericEdit.payload));
  const item = plan.checklist[0];
  const injectedChecklist = await request(`/actions/onboarding/${plan.id}/checklist-item`, { method: 'POST', body: { data: { itemId: item.id, status: 'completed', assigneeId: 'demo-admin' } } });
  assert.equal(injectedChecklist.status, 400, JSON.stringify(injectedChecklist.payload));
  const unauthorizedChecklist = await request(`/actions/onboarding/${plan.id}/checklist-item`, { user: 'demo-employee', method: 'POST', body: { data: { itemId: item.id, status: 'completed' } } });
  assert.equal(unauthorizedChecklist.status, 403, JSON.stringify(unauthorizedChecklist.payload));
  const completedItem = await request(`/actions/onboarding/${plan.id}/checklist-item`, { method: 'POST', body: { data: { itemId: item.id, status: 'completed' } } });
  assert.equal(completedItem.status, 200, JSON.stringify(completedItem.payload));
  assert.equal(completedItem.data.checklist.find(entry => entry.id === item.id).status, 'completed');
  const again = await request(`${endpoint}/accept`, { method: 'POST', body: { data: {} } });
  assert.equal(again.status, 409, JSON.stringify(again.payload));
  const plansAgain = await request('/records/onboarding');
  assert.equal(plansAgain.data.filter(row => row.offerId === created.data.id).length, 1);
});

test('configured required custom job fields are enforced at write boundary', async t => {
  const { request, config } = await instance(t, 'corporate', company => {
    company.customFields.jobs.push({ id: 'costCentreCode', label: 'Cost centre code', type: 'shortText', required: true, order: 1, visibility: 'internal' });
  });
  const job = { title: 'Operations Analyst', departmentId: config.organization.units[1].id,
    locationId: config.organization.locations[0].id, pipelineId: config.pipelines[0].id,
    employmentType: 'full-time', description: 'Support operational reporting.', openings: 1 };
  const missing = await request('/records/jobs', { method: 'POST', body: { data: job } });
  assert.equal(missing.status, 422, JSON.stringify(missing.payload));
  const saved = await request('/records/jobs', { method: 'POST', body: { data: { ...job, customFields: { costCentreCode: 'ENG-100' } } } });
  assert.equal(saved.status, 201, JSON.stringify(saved.payload));
  assert.equal(saved.data.customFields.costCentreCode, 'ENG-100');
});

test('audit viewer reflects actions and only authorized users can inspect it', async t => {
  const { request } = await instance(t);
  const jobs = await request('/records/jobs');
  const published = await request(`/actions/jobs/${jobs.data[0].id}/publish`, { method: 'POST', body: { data: { visibility: 'public' } } });
  assert.equal(published.status, 200, JSON.stringify(published.payload));
  const history = await request('/records/audit');
  assert.equal(history.status, 200, JSON.stringify(history.payload));
  assert.ok(history.data.some(row => row.action === 'job.published' && row.recordId === jobs.data[0].id), 'Audit viewer must show the publication event');
  const employee = await request('/records/audit', { user: 'demo-employee' });
  assert.equal(employee.status, 403, JSON.stringify(employee.payload));
});

test('mock employee can enter their limited workspace without gaining dashboard or candidate access', async t => {
  const { request } = await instance(t, 'startup');
  const boot = await request('/bootstrap', { user: 'demo-employee' });
  assert.equal(boot.status, 200, JSON.stringify(boot.payload));
  assert.equal(boot.data.user.roleId, 'employee');
  const referrals = await request('/records/referrals', { user: 'demo-employee' });
  assert.equal(referrals.status, 200, JSON.stringify(referrals.payload));
  const restricted = await request('/records/candidates', { user: 'demo-employee' });
  assert.equal(restricted.status, 403, JSON.stringify(restricted.payload));
});

test('configured application automation creates a task and logs its execution once', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.automation = true;
    config.automations = [{ id: 'review-new-applicant', name: 'Review new applicant', enabled: true,
      trigger: 'application.created', actions: [{ type: 'create_task', title: 'Review incoming application', ownerId: 'demo-recruiter' }] }];
  });
  const jobs = await request('/public/jobs', { user: 'no-login' });
  const applied = await request(`/public/jobs/${jobs.data[0].id}/apply`, { user: 'no-login', method: 'POST', body: { data: {
    fullName: 'Avery Example', email: 'avery@example.test', consent: true,
    resume: { filename: 'resume.txt', contentBase64: Buffer.from('Resume data').toString('base64') }
  } } });
  assert.equal(applied.status, 201, JSON.stringify(applied.payload));
  const tasks = await request('/records/tasks');
  assert.equal(tasks.status, 200, JSON.stringify(tasks.payload));
  assert.equal(tasks.data.filter(task => task.automationId === 'review-new-applicant' && task.relatedId === applied.data.applicationId).length, 1);
  const runs = await request('/records/automations');
  assert.equal(runs.status, 200, JSON.stringify(runs.payload));
  assert.equal(runs.data.filter(run => run.automationId === 'review-new-applicant' && run.recordId === applied.data.applicationId).length, 1);
});

test('automation executes the selected action without inventing a task', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.automation = true;
    config.automations = [{ id: 'notify-new-applicant', enabled: true, trigger: 'application.created',
      actions: [{ type: 'create_notification', userId: 'demo-recruiter', title: 'New applicant to review' }] }];
  });
  const jobs = await request('/public/jobs', { user: 'no-login' });
  const applied = await request(`/public/jobs/${jobs.data[0].id}/apply`, { user: 'no-login', method: 'POST', body: { data: {
    fullName: 'Maya Example', email: 'maya@example.test', consent: true,
    resume: { filename: 'resume.txt', contentBase64: Buffer.from('Resume').toString('base64') }
  } } });
  assert.equal(applied.status, 201);
  const tasks = await request('/records/tasks');
  assert.equal(tasks.status, 200);
  assert.equal(tasks.data.filter(row => row.automationId === 'notify-new-applicant' && row.relatedId === applied.data.applicationId).length, 0);
  const notifications = await request('/records/notifications');
  assert.equal(notifications.status, 200);
  assert.ok(notifications.data.some(row => row.automationId === 'notify-new-applicant' && row.userId === 'demo-recruiter' && row.title === 'New applicant to review'));
});

test('manual automation run executes only the configured rule once for a permitted target and audits the request', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.automation = true;
    config.automations = [
      { id: 'manual-review', name: 'Manual review', enabled: true, trigger: 'application.created', actions: [{ type: 'create_task', title: 'Review {{candidate.name}}', ownerId: 'demo-recruiter' }] },
      { id: 'other-rule', name: 'Other rule', enabled: true, trigger: 'application.created', actions: [{ type: 'create_notification', userId: 'demo-recruiter', title: 'Should not run' }] }
    ];
  });
  const app = (await request('/records/applications')).data[0];
  const body = { data: { targetKind: 'applications', targetId: app.id } };
  const first = await request('/automations/manual-review/run', { method: 'POST', body });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(first.data.matched, true);
  assert.equal(first.data.runs.length, 1);
  assert.equal(first.data.runs[0].automationId, 'manual-review');
  assert.equal(first.data.runs[0].executionMode, 'manual');
  assert.equal((await request('/records/tasks')).data.filter(task => task.automationId === 'manual-review' && task.relatedId === app.id).length, 1);
  assert.equal((await request('/records/notifications')).data.some(row => row.title === 'Should not run'), false);

  const retry = await request('/automations/manual-review/run', { method: 'POST', body });
  assert.equal(retry.status, 200, JSON.stringify(retry.payload));
  assert.equal(retry.data.duplicate, true);
  assert.equal((await request('/records/tasks')).data.filter(task => task.automationId === 'manual-review' && task.relatedId === app.id).length, 1);
  const history = await request('/records/audit');
  assert.ok(history.data.some(row => row.action === 'automation.manual-run-requested' && row.recordId === app.id && row.details.automationId === 'manual-review'));
});

test('manual automation run rejects injected rules/events, unauthorized users, disabled rules, and out-of-scope targets', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.automation = true;
    config.automations = [{ id: 'owned-only', name: 'Owned target only', enabled: true, trigger: 'application.created', actions: [{ type: 'create_task', title: 'Review target' }] }];
    config.roles.push({ id: 'automation-operator', name: 'Automation operator', permissions: { automations: ['edit'], applications: ['view'], tasks: ['create'] }, scope: 'owned', sensitive: [] });
    config.users.push({ id: 'demo-automation-operator', name: 'Automation Operator', email: 'automation@localhost.test', roleId: 'automation-operator', departmentId: 'unit-engineering', locationId: 'location-hq' });
  });
  const app = (await request('/records/applications')).data[0];
  const route = '/automations/owned-only/run';
  const targetBody = { data: { targetKind: 'applications', targetId: app.id } };
  const unauthorized = await request(route, { user: 'demo-recruiter', method: 'POST', body: targetBody });
  assert.equal(unauthorized.status, 403, JSON.stringify(unauthorized.payload));
  const outOfScope = await request(route, { user: 'demo-automation-operator', method: 'POST', body: targetBody });
  assert.equal(outOfScope.status, 404, JSON.stringify(outOfScope.payload));
  const injected = await request(route, { method: 'POST', body: { data: { ...targetBody.data, event: 'candidate.hired', actions: [{ type: 'delete' }] } } });
  assert.equal(injected.status, 400, JSON.stringify(injected.payload));
  const job = (await request('/records/jobs')).data[0];
  const mismatchedTarget = await request(route, { method: 'POST', body: { data: { targetKind: 'jobs', targetId: job.id } } });
  assert.equal(mismatchedTarget.status, 422, JSON.stringify(mismatchedTarget.payload));
  const unknownRule = await request('/automations/client-rule/run', { method: 'POST', body: targetBody });
  assert.equal(unknownRule.status, 404, JSON.stringify(unknownRule.payload));

  const disabled = await instance(t, 'corporate', config => {
    config.modules.automation = true;
    config.automations = [{ id: 'disabled-rule', enabled: false, trigger: 'application.created', actions: [{ type: 'create_task', title: 'No-op' }] }];
  });
  const disabledApp = (await disabled.request('/records/applications')).data[0];
  const disabledRun = await disabled.request('/automations/disabled-rule/run', { method: 'POST', body: { data: { targetKind: 'applications', targetId: disabledApp.id } } });
  assert.equal(disabledRun.status, 409, JSON.stringify(disabledRun.payload));
});

test('data administration detects duplicates, rejects restricted exports and supports CSV', async t => {
  const { request } = await instance(t);
  const duplicate = await request('/duplicates/candidates', { method: 'POST', body: { data: { name: 'Different Name', email: 'PRIYA@example.test' } } });
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.payload));
  assert.ok(duplicate.data.some(match => match.record.email === 'priya@example.test'));
  const imported = await request('/import/candidates', { method: 'POST', body: { csv: 'name,email,source\n"Taylor, Kai",taylor.kai@example.test,Referral' } });
  assert.equal(imported.status, 201, JSON.stringify(imported.payload));
  assert.ok(imported.data.some(row => row.name === 'Taylor, Kai'));
  const exported = await request('/export/candidates?format=csv');
  assert.equal(exported.status, 200, JSON.stringify(exported.payload));
  assert.match(String(exported.data), /"Taylor, Kai"/);
  const blocked = await request('/export/candidates?format=csv', { user: 'demo-employee' });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.payload));
});

test('reports use stored records and track changes without exposing data to employees', async t => {
  const { request, config } = await instance(t);
  const initial = await request('/reports/overview');
  assert.equal(initial.status, 200, JSON.stringify(initial.payload));
  const jobList = await request('/records/jobs');
  assert.equal(initial.data.metrics.jobs.total, jobList.data.length);
  assert.equal(initial.data.metrics.openJobs, jobList.data.filter(job => job.status === 'open').length);
  const added = await request('/records/jobs', { method: 'POST', body: { data: { title: 'Metrics Analyst', status: 'draft', pipelineId: config.pipelines[0].id, description: 'Analyze hiring data.' } } });
  assert.equal(added.status, 201, JSON.stringify(added.payload));
  const next = await request('/reports/overview');
  assert.equal(next.data.metrics.jobs.total, initial.data.metrics.jobs.total + 1);
  assert.equal(next.data.metrics.jobs.draft, initial.data.metrics.jobs.draft + 1);
  const restricted = await request('/reports/overview', { user: 'demo-employee' });
  assert.equal(restricted.status, 403, JSON.stringify(restricted.payload));
});

test('SLA overview uses legacy defaults, reports overdue work and respects record scope', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.sla = { applicationReviewHours: 72, interviewFeedbackHours: 24, offerApprovalHours: 48, defaultStageDays: 14 };
    const recruiterRole = config.roles.find(role => role.id === 'recruiter');
    recruiterRole.scope = 'owned';
    recruiterRole.permissions.reporting = ['view'];
  });
  const ownedJob = await request('/records/jobs', { method: 'POST', body: { data: { title: 'Owned SLA role', status: 'draft', pipelineId: 'general', recruiterId: 'demo-recruiter' } } });
  assert.equal(ownedJob.status, 201, JSON.stringify(ownedJob.payload));
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'SLA candidate', ownerId: 'demo-recruiter', departmentId: 'unit-engineering' } } });
  assert.equal(candidate.status, 201, JSON.stringify(candidate.payload));
  const application = await request('/records/applications', { method: 'POST', body: { data: { jobId: ownedJob.data.id, candidateId: candidate.data.id, status: 'active', stage: 'applied', appliedAt: '2020-01-01T00:00:00.000Z' } } });
  assert.equal(application.status, 201, JSON.stringify(application.payload));

  const admin = await request('/sla/overview');
  assert.equal(admin.status, 200, JSON.stringify(admin.payload));
  const overdue = admin.data.items.find(item => item.type === 'application_review' && item.recordId === application.data.id);
  assert.ok(overdue, JSON.stringify(admin.data));
  assert.equal(overdue.overdue, true);
  assert.deepEqual(overdue.threshold, { amount: 72, unit: 'hours' });

  const recruiter = await request('/sla/overview', { user: 'demo-recruiter' });
  assert.equal(recruiter.status, 200, JSON.stringify(recruiter.payload));
  assert.ok(recruiter.data.items.some(item => item.recordId === application.data.id));
  assert.ok(recruiter.data.items.every(item => item.recordId !== undefined));
  const employee = await request('/sla/overview', { user: 'demo-employee' });
  assert.equal(employee.status, 403, JSON.stringify(employee.payload));
});

test('SLA overview defaults produce no items when no SLA threshold is configured', async t => {
  const { request } = await instance(t, 'corporate', config => { config.sla = {}; });
  const result = await request('/sla/overview');
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.data.items, []);
  assert.deepEqual(result.data.summary, { total: 0, overdue: 0, onTrack: 0, byType: {} });
});

test('candidate anonymization requires a persisted approval from a second authorized user', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.approvals = true;
    const hr = config.roles.find(role => role.id === 'hr-head');
    hr.permissions.candidates = [...new Set([...(hr.permissions.candidates || []), 'approve'])];
    hr.permissions.approvals = ['view', 'approve'];
  });
  const candidate = (await request('/records/candidates')).data[0];
  const action = `/actions/candidates/${candidate.id}/anonymize`;
  const forged = await request(action, { method: 'POST', body: { data: { approved: true } } });
  assert.equal(forged.status, 403, JSON.stringify(forged.payload));
  const injected = await request('/records/approvals', { method: 'POST', body: { data: { workflow: 'privacy-deletion', recordKind: 'candidates', recordId: candidate.id, candidateId: candidate.id, requesterId: 'demo-employee', status: 'pending' } } });
  assert.equal(injected.status, 403, JSON.stringify(injected.payload));
  assert.equal((await request(`/records/candidates/${candidate.id}`)).data.email, candidate.email);

  const requestApproval = await request(action, { method: 'POST', body: { data: { reason: 'Candidate requested erasure' } } });
  assert.equal(requestApproval.status, 202, JSON.stringify(requestApproval.payload));
  assert.equal(requestApproval.data.status, 'pending');
  assert.equal(requestApproval.data.requesterId, 'demo-admin');
  const selfApproval = await request(`/actions/approvals/${requestApproval.data.id}/approve`, { method: 'POST', body: { data: {} } });
  assert.equal(selfApproval.status, 403, JSON.stringify(selfApproval.payload));
  const approved = await request(`/actions/approvals/${requestApproval.data.id}/approve`, { user: 'demo-hr-head', method: 'POST', body: { data: { comment: 'Verified request' } } });
  assert.equal(approved.status, 200, JSON.stringify(approved.payload));
  assert.equal(approved.data.status, 'approved');

  const processed = await request(action, { method: 'POST', body: { data: {} } });
  assert.equal(processed.status, 200, JSON.stringify(processed.payload));
  assert.equal(processed.data.anonymized, true);
  assert.ok(processed.data.email == null);
  const approvalAfter = await request(`/records/approvals/${requestApproval.data.id}`);
  assert.equal(approvalAfter.data.status, 'processed');
});

test('careers job payload is an allowlisted public projection', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.customFields.jobs.push({ id: 'internalForecast', label: 'Internal forecast', type: 'shortText', visibility: 'internal' });
  });
  const reqs = await request('/records/requisitions');
  const req = reqs.data.find(row => row.status === 'pending');
  await request(`/actions/requisitions/${req.id}/approve`, { user: 'demo-manager', method: 'POST', body: { data: {} } });
  const approved = await request(`/actions/requisitions/${req.id}/approve`, { user: 'demo-hr-head', method: 'POST', body: { data: {} } });
  const job = await request(`/actions/requisitions/${req.id}/create-job`, { method: 'POST', body: { data: {} } });
  await request(`/actions/jobs/${job.data.id}/publish`, { method: 'POST', body: { data: {} } });
  const publicJobs = await request('/public/jobs', { user: 'public' });
  const visible = publicJobs.data.find(item => item.id === job.data.id);
  assert.ok(visible);
  for (const key of ['requisitionId', 'recruiterId', 'hiringManagerId', 'salaryBand', 'internalNotes', 'createdBy', 'updatedBy']) assert.equal(visible[key], undefined, `${key} must not be public`);
  assert.equal(visible.internalForecast, undefined);
  assert.equal(approved.data.status, 'approved');
});

test('generic records reject missing foreign references and unauthorized owner assignment', async t => {
  const { request } = await instance(t, 'corporate', config => {
    const recruiter = config.roles.find(role => role.id === 'recruiter');
    recruiter.permissions.jobs = ['view', 'create'];
  });
  const invalidApplication = await request('/records/applications', { method: 'POST', body: { data: { candidateId: 'missing-candidate', jobId: 'missing-job', pipelineId: 'general', stage: 'applied' } } });
  assert.equal(invalidApplication.status, 422, JSON.stringify(invalidApplication.payload));
  const forgedOwner = await request('/records/jobs', { user: 'demo-recruiter', method: 'POST', body: { data: { title: 'Unauthorized assignment', recruiterId: 'demo-admin' } } });
  assert.equal(forgedOwner.status, 403, JSON.stringify(forgedOwner.payload));
});

test('placement invoice creation is permission-gated and idempotent', async t => {
  const { request } = await instance(t, 'agency', config => { config.roles.find(role => role.id === 'recruiter').permissions.placements = ['view', 'edit']; });
  const sub = (await request('/records/submissions')).data[0];
  const placement = await request('/records/placements', { method: 'POST', body: { data: { submissionId: sub.id, clientId: sub.clientId, candidateId: sub.candidateId, jobId: sub.jobId, fee: 9000 } } });
  assert.equal(placement.status, 201, JSON.stringify(placement.payload));
  const forbidden = await request(`/actions/placements/${placement.data.id}/invoice`, { user: 'demo-recruiter', method: 'POST', body: { data: {} } });
  assert.equal(forbidden.status, 403, JSON.stringify(forbidden.payload));
  const first = await request(`/actions/placements/${placement.data.id}/invoice`, { method: 'POST', body: { data: {} } });
  const second = await request(`/actions/placements/${placement.data.id}/invoice`, { method: 'POST', body: { data: {} } });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(second.data.id, first.data.id);
  const invoices = await request('/records/invoices');
  assert.equal(invoices.data.filter(invoice => invoice.placementId === placement.data.id).length, 1);
});

test('audit viewer filters records outside the acting user scope', async t => {
  const { request } = await instance(t, 'corporate', config => {
    const recruiter = config.roles.find(role => role.id === 'recruiter');
    recruiter.permissions.audit = ['view'];
  });
  const candidate = (await request('/records/candidates', { user: 'demo-recruiter' })).data[0];
  const created = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Private Example', email: 'private@example.test', status: 'active' } } });
  const outside = created.data;
  await request(`/actions/candidates/${candidate.id}/add-note`, { user: 'demo-recruiter', method: 'POST', body: { data: { body: 'Scoped audit entry' } } });
  await request(`/actions/candidates/${outside.id}/add-note`, { method: 'POST', body: { data: { body: 'Unrelated audit entry' } } });
  const audit = await request('/records/audit', { user: 'demo-recruiter' });
  assert.equal(audit.status, 200, JSON.stringify(audit.payload));
  assert.ok(audit.data.some(item => item.recordId === candidate.id));
  assert.ok(!audit.data.some(item => item.recordId === outside.id));
  assert.ok(!audit.data.some(item => item.kind === 'config' || item.kind === null));
});

test('retention preview is read-only and restricted to data administrators', async t => {
  const { request } = await instance(t);
  const before = await request('/records/candidates');
  const preview = await request('/retention/preview');
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.data.previewOnly, true);
  assert.equal(preview.data.summary.candidateCount, before.data.length);
  assert.equal(preview.data.items.length, before.data.length);
  const after = await request('/records/candidates');
  assert.deepEqual(after.data, before.data);
  const denied = await request('/retention/preview', { user: 'demo-recruiter' });
  assert.equal(denied.status, 403);
});

test('named reports expose only the requested stored metrics and respect module gates', async t => {
  const { request } = await instance(t);
  const overview = await request('/reports/overview');
  const pipeline = await request('/reports/pipeline');
  assert.equal(overview.status, 200);
  assert.equal(pipeline.status, 200);
  assert.ok(overview.data.metrics.jobs);
  assert.ok(pipeline.data.metrics.pipeline);
  assert.equal(pipeline.data.metrics.jobs, undefined);
  assert.equal((await request('/reports/does-not-exist')).status, 404);
  assert.equal((await request('/reports/agency')).status, 404);
});

test('workforce target report compares persisted targets with scoped dated outcomes', async t => {
  const corporate = await instance(t, 'corporate', config => { config.modules.workforcePlanning = true; });
  const corporateReport = await corporate.request('/reports/workforce-targets');
  assert.equal(corporateReport.status, 200, JSON.stringify(corporateReport.payload));
  assert.equal(corporateReport.data.name, 'workforce-targets');
  assert.equal(corporateReport.data.outcomeType, 'hires');
  assert.equal(corporateReport.data.summary.hasTargets, true);
  assert.equal(corporateReport.data.series[0].target, 3);
  assert.equal(corporateReport.data.series[0].actualHires, 0, 'active applications are not counted as hires');
  assert.equal(corporateReport.data.series[0].variance, -3);
  assert.equal((await corporate.request('/reports/workforce-targets', { user: 'demo-employee' })).status, 403);

  const agency = await instance(t, 'agency', config => { config.modules.workforcePlanning = true; });
  const agencyReport = await agency.request('/reports/workforce-targets');
  assert.equal(agencyReport.status, 200, JSON.stringify(agencyReport.payload));
  assert.equal(agencyReport.data.outcomeType, 'placements');
  assert.deepEqual(agencyReport.data.series, [], 'agency report does not treat submissions or applications as placements');

  const disabled = await instance(t, 'corporate');
  assert.equal((await disabled.request('/reports/workforce-targets')).status, 403);
  const restricted = await instance(t, 'corporate', config => {
    config.modules.workforcePlanning = true;
    config.roles.find(role => role.id === 'admin').permissions = { reporting: ['view'] };
  });
  assert.equal((await restricted.request('/reports/workforce-targets')).status, 403);
});

test('failed public resume upload does not leave a candidate or application behind', async t => {
  const { request } = await instance(t);
  const job = (await request('/public/jobs', { user: 'public' })).data[0];
  const beforeCandidates = (await request('/records/candidates')).data.length;
  const beforeApplications = (await request('/records/applications')).data.length;
  const failed = await request(`/public/jobs/${job.id}/apply`, { user: 'public', method: 'POST', body: { data: {
    fullName: 'Atomic Example', email: 'atomic@example.test', consent: true,
    resume: { filename: 'resume.txt', contentBase64: '!!!!' }
  } } });
  assert.equal(failed.status, 422, JSON.stringify(failed.payload));
  assert.equal((await request('/records/candidates')).data.length, beforeCandidates);
  assert.equal((await request('/records/applications')).data.length, beforeApplications);
});

test('agency invoice document renders locally and enforces record permissions', async t => {
  const { request } = await instance(t, 'agency');
  const submission = (await request('/records/submissions')).data[0];
  const placement = await request('/records/placements', { method: 'POST', body: { data: { submissionId: submission.id, clientId: submission.clientId, candidateId: submission.candidateId, jobId: submission.jobId, fee: 9000 } } });
  assert.equal(placement.status, 201, JSON.stringify(placement.payload));
  const invoice = await request(`/actions/placements/${placement.data.id}/invoice`, { method: 'POST', body: { data: {} } });
  assert.equal(invoice.status, 200, JSON.stringify(invoice.payload));
  const preview = await request(`/invoices/${invoice.data.id}/document`);
  assert.equal(preview.status, 200);
  assert.match(preview.data, /<!doctype html>/i);
  assert.match(preview.data, /Northstar Analytics/);
  assert.match(preview.data, /9,000/);
  const denied = await request(`/invoices/${invoice.data.id}/document`, { user: 'demo-agency-consultant' });
  assert.equal(denied.status, 403);
  const audit = await request('/records/audit');
  assert.ok(audit.data.some(item => item.action === 'invoice.document-viewed' && item.recordId === invoice.data.id));
});

test('offer document requires salary permissions, enforces related record scope, and escapes HTML', async t => {
  const { request } = await instance(t, 'corporate', config => {
    const recruiter = config.roles.find(role => role.id === 'recruiter');
    recruiter.permissions.offers = ['view'];
    recruiter.scope = 'all';
  });
  const app = (await request('/records/applications')).data[0];
  const offer = await request('/records/offers', { user: 'demo-hr-head', method: 'POST', body: { data: {
    applicationId: app.id, candidateId: app.candidateId, jobId: app.jobId, salary: 150000, currency: 'USD'
  } } });
  assert.equal(offer.status, 201, JSON.stringify(offer.payload));
  const injected = '</title><script>alert(1)</script><img src=x onerror=alert(2)>';
  const changed = await request(`/records/candidates/${app.candidateId}`, { user: 'demo-hr-head', method: 'PATCH', body: { data: { name: injected } } });
  assert.equal(changed.status, 200, JSON.stringify(changed.payload));
  const blocked = await request(`/offers/${offer.data.id}/document`, { user: 'demo-recruiter' });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.payload));
  const preview = await request(`/offers/${offer.data.id}/document`, { user: 'demo-hr-head' });
  assert.equal(preview.status, 200);
  assert.match(preview.data, /<!doctype html>/i);
  assert.match(preview.data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/i);
  assert.doesNotMatch(preview.data, /<script>alert\(1\)<\/script>/i);
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  assert.equal(preview.headers.get('cache-control'), 'no-store');
  const audit = await request('/records/audit');
  assert.ok(audit.data.some(item => item.action === 'offer.document-viewed' && item.recordId === offer.data.id));
});

test('retention execution defaults to dry-run and approval decisions are independent', async t => {
  const { request } = await instance(t, 'corporate', config => { config.privacy.retentionDays = 1; });
  const before = (await request('/records/candidates')).data;
  const dryRun = await request('/retention/process', { method: 'POST', body: { data: {} } });
  assert.equal(dryRun.status, 200, JSON.stringify(dryRun.payload));
  assert.equal(dryRun.data.dryRun, true);
  assert.equal((await request('/records/candidates')).data.length, before.length);
  const candidate = before[0];
  const requested = await request(`/retention/approvals/${candidate.id}`, { method: 'POST', body: { data: { reason: 'Retention review' } } });
  assert.equal(requested.status, 201, JSON.stringify(requested.payload));
  assert.equal(requested.data.status, 'pending');
  const selfDecision = await request(`/retention/approvals/${requested.data.id}/decision`, { method: 'POST', body: { data: { decision: 'approved' } } });
  assert.equal(selfDecision.status, 403);
  const decision = await request(`/retention/approvals/${requested.data.id}/decision`, { user: 'demo-hr-head', method: 'POST', body: { data: { decision: 'approved' } } });
  assert.equal(decision.status, 200, JSON.stringify(decision.payload));
  assert.equal(decision.data.decidedBy, 'demo-hr-head');
  const spoofed = await request('/retention/process', { method: 'POST', body: { data: { dryRun: false, approved: true, candidateIds: [candidate.id] } } });
  assert.equal(spoofed.status, 400);
});

test('referral milestone and payout actions are scoped, strict, audited, and idempotent', async t => {
  const { request } = await instance(t, 'corporate', config => {
    config.modules.referrals = true;
    config.referrals.enabled = true;
    config.referrals.rewards = [{ id: 'joined', milestone: 'joined', amount: 250, currency: 'USD' }];
    config.roles.find(role => role.id === 'employee').permissions.referrals.push('edit');
  });
  const submitted = await request('/referrals/submit', { user: 'demo-employee', method: 'POST', body: { data: {
    candidateDetails: { name: 'Referral Test', email: 'referral-test@example.test', consent: true }, consent: true,
  } } });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.payload));
  const id = submitted.data.id;
  const wrongPayload = await request(`/actions/referrals/${id}/complete-milestone`, { user: 'demo-employee', method: 'POST', body: { data: { milestone: 'joined', payoutStatus: 'paid' } } });
  assert.equal(wrongPayload.status, 400);
  const generic = await request(`/records/referrals/${id}`, { user: 'demo-employee', method: 'PATCH', body: { data: { payoutStatus: 'paid' } } });
  assert.equal(generic.status, 409);
  const completed = await request(`/actions/referrals/${id}/complete-milestone`, { user: 'demo-employee', method: 'POST', body: { data: { milestone: 'joined' } } });
  assert.equal(completed.status, 200, JSON.stringify(completed.payload));
  assert.equal(completed.data.reward.amount, 250);
  const again = await request(`/actions/referrals/${id}/complete-milestone`, { user: 'demo-employee', method: 'POST', body: { data: { milestone: 'joined' } } });
  assert.equal(again.data.milestonesCompleted.length, 1);
  const paid = await request(`/actions/referrals/${id}/set-payout-status`, { user: 'demo-employee', method: 'POST', body: { data: { status: 'paid' } } });
  assert.equal(paid.status, 200, JSON.stringify(paid.payload));
  assert.ok(paid.data.paidAt);
  const backwards = await request(`/actions/referrals/${id}/set-payout-status`, { user: 'demo-employee', method: 'POST', body: { data: { status: 'pending' } } });
  assert.equal(backwards.status, 409);
  const mine = await request('/referrals/mine', { user: 'demo-employee' });
  assert.equal(mine.status, 200);
  assert.equal(mine.data[0].id, id);
  assert.equal(Object.hasOwn(mine.data[0], 'candidateEmail'), false);
  assert.equal(Object.hasOwn(mine.data[0], 'referrerId'), false);
  const unauthorized = await request(`/actions/referrals/${id}/complete-milestone`, { user: 'demo-recruiter', method: 'POST', body: { data: { milestone: 'hired' } } });
  assert.ok([403, 404].includes(unauthorized.status));
});

test('candidate merge relinks applications, archives the duplicate, audits, and rejects unsafe targets atomically', async t => {
  const { request } = await instance(t);
  const primary = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Merge primary', email: 'primary-merge@example.test', ownerId: 'demo-admin', skills: ['systems'] } } });
  const duplicate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Merge duplicate', email: 'duplicate-merge@example.test', ownerId: 'demo-admin', skills: ['research'] } } });
  assert.equal(primary.status, 201, JSON.stringify(primary.payload));
  assert.equal(duplicate.status, 201, JSON.stringify(duplicate.payload));
  const job = (await request('/records/jobs')).data[0];
  const application = await request('/records/applications', { method: 'POST', body: { data: { candidateId: duplicate.data.id, jobId: job.id } } });
  assert.equal(application.status, 201, JSON.stringify(application.payload));

  const merged = await request(`/actions/candidates/${duplicate.data.id}/merge`, { method: 'POST', body: { data: { targetId: primary.data.id } } });
  assert.equal(merged.status, 200, JSON.stringify(merged.payload));
  assert.ok(merged.data.mergedFrom.includes(duplicate.data.id));
  assert.ok(merged.data.skills.includes('research'));
  assert.equal((await request(`/records/applications/${application.data.id}`)).data.candidateId, primary.data.id);
  assert.equal((await request('/records/candidates')).data.some(row => row.id === duplicate.data.id), false, 'Merged duplicate must be archived');
  const events = (await request('/records/audit')).data;
  assert.ok(events.some(event => event.action === 'record.merged' && event.recordId === primary.data.id && event.details?.duplicateId === duplicate.data.id));

  const self = await request(`/actions/candidates/${primary.data.id}/merge`, { method: 'POST', body: { data: { targetId: primary.data.id } } });
  assert.equal(self.status, 422, JSON.stringify(self.payload));
  const missing = await request(`/actions/candidates/${primary.data.id}/merge`, { method: 'POST', body: { data: { targetId: 'missing-candidate' } } });
  assert.equal(missing.status, 404, JSON.stringify(missing.payload));

  const source = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Scoped source', ownerId: 'demo-recruiter' } } });
  const outsideTarget = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Scoped target', ownerId: 'demo-admin' } } });
  assert.equal(source.status, 201, JSON.stringify(source.payload));
  assert.equal(outsideTarget.status, 201, JSON.stringify(outsideTarget.payload));
  const auditBefore = (await request('/records/audit')).data.length;
  const outOfScope = await request(`/actions/candidates/${source.data.id}/merge`, { user: 'demo-recruiter', method: 'POST', body: { data: { targetId: outsideTarget.data.id } } });
  assert.equal(outOfScope.status, 404, JSON.stringify(outOfScope.payload));
  assert.equal((await request(`/records/candidates/${source.data.id}`)).data.archivedAt, undefined);
  assert.equal((await request(`/records/candidates/${outsideTarget.data.id}`)).data.mergedFrom, undefined);
  assert.equal((await request('/records/audit')).data.length, auditBefore, 'Rejected merges must not leave audit writes');
});

test('workforce targets validate create, edit, and import and canonicalize configured dimensions', async t => {
  const { request } = await instance(t, 'corporate', config => { config.modules.workforcePlanning = true; });
  for (const data of [
    { period: '2026-Q5', target: 2 }, { period: '2026-Q3', target: 0 },
    { period: '2026-Q3', target: 2, department: 'Not configured' },
  ]) {
    const invalid = await request('/records/workforceTargets', { method: 'POST', body: { data } });
    assert.equal(invalid.status, 422, JSON.stringify(invalid.payload));
  }
  const created = await request('/records/workforceTargets', { method: 'POST', body: { data: {
    period: '2026-Q3', target: 4, departmentId: 'unit-engineering', location: 'headquarters', role: '  Engineer  '
  } } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.data.department, 'Engineering');
  assert.equal(created.data.location, 'Headquarters');
  assert.equal(created.data.role, 'Engineer');
  assert.equal(created.data.target, 4);

  const invalidEdit = await request(`/records/workforceTargets/${created.data.id}`, { method: 'PATCH', body: { data: { target: -1 } } });
  assert.equal(invalidEdit.status, 422, JSON.stringify(invalidEdit.payload));
  assert.equal((await request(`/records/workforceTargets/${created.data.id}`)).data.target, 4, 'Invalid edit must not change the saved target');
  const edited = await request(`/records/workforceTargets/${created.data.id}`, { method: 'PATCH', body: { data: { department: 'sales', period: '2027-01', target: '7' } } });
  assert.equal(edited.status, 200, JSON.stringify(edited.payload));
  assert.equal(edited.data.department, 'Sales');
  assert.equal(edited.data.period, '2027-01');
  assert.equal(edited.data.target, 7);

  const beforeImportCount = (await request('/records/workforceTargets')).data.length;
  const badImport = await request('/import/workforceTargets', { method: 'POST', body: { data: [
    { period: '2026-13', target: 1, department: 'Engineering' }, { period: '2026-Q4', target: 0 }
  ] } });
  assert.equal(badImport.status, 422, JSON.stringify(badImport.payload));
  assert.equal((await request('/records/workforceTargets')).data.length, beforeImportCount, 'Invalid import must not partially persist rows');
  const imported = await request('/import/workforceTargets', { method: 'POST', body: { data: [
    { period: '2026-Q4', target: 3, department: ' engineering ', locationId: 'location-hq', role: 'Analyst' }
  ] } });
  assert.equal(imported.status, 201, JSON.stringify(imported.payload));
  assert.equal(imported.data[0].department, 'Engineering');
  assert.equal(imported.data[0].location, 'Headquarters');
});

test('restricted document versions and downloads require ownership or administer permission', async t => {
  const { request } = await instance(t);
  const candidate = await request('/records/candidates', { method: 'POST', body: { data: { name: 'Restricted parent', ownerId: 'demo-recruiter' } } });
  assert.equal(candidate.status, 201, JSON.stringify(candidate.payload));
  const uploaded = await request(`/records/candidates/${candidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'restricted.txt', category: 'Resume', visibility: 'restricted', contentBase64: Buffer.from('restricted content').toString('base64'), mimeType: 'text/plain'
  } } });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.payload));
  const deniedVersions = await request(`/documents/${uploaded.data.id}/versions`, { user: 'demo-recruiter' });
  const deniedDownload = await request(`/documents/${uploaded.data.id}/download`, { user: 'demo-recruiter' });
  assert.equal(deniedVersions.status, 404, JSON.stringify(deniedVersions.payload));
  assert.equal(deniedDownload.status, 404, JSON.stringify(deniedDownload.payload));
  const ownerVersions = await request(`/documents/${uploaded.data.id}/versions`);
  const ownerDownload = await request(`/documents/${uploaded.data.id}/download`);
  assert.equal(ownerVersions.status, 200, JSON.stringify(ownerVersions.payload));
  assert.deepEqual(ownerVersions.data.map(version => version.id), [uploaded.data.id]);
  assert.equal(ownerDownload.status, 200, JSON.stringify(ownerDownload.payload));
  assert.equal(ownerDownload.data, 'restricted content');

  const { request: adminAllowed } = await instance(t, 'corporate', config => {
    config.roles.find(role => role.id === 'hr-head').permissions.documents.push('administer');
  });
  const adminCandidate = await adminAllowed('/records/candidates', { method: 'POST', body: { data: { name: 'Administered parent', ownerId: 'demo-recruiter' } } });
  const adminDoc = await adminAllowed(`/records/candidates/${adminCandidate.data.id}/documents`, { method: 'POST', body: { data: {
    filename: 'admin-restricted.txt', category: 'Resume', visibility: 'restricted', contentBase64: Buffer.from('admin content').toString('base64'), mimeType: 'text/plain'
  } } });
  assert.equal(adminDoc.status, 201, JSON.stringify(adminDoc.payload));
  assert.equal((await adminAllowed(`/documents/${adminDoc.data.id}/versions`, { user: 'demo-hr-head' })).status, 200);
  const adminDownload = await adminAllowed(`/documents/${adminDoc.data.id}/download`, { user: 'demo-hr-head' });
  assert.equal(adminDownload.status, 200, JSON.stringify(adminDownload.payload));
  assert.equal(adminDownload.data, 'admin content');
});
