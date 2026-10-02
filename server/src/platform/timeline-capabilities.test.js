'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { defaults } = require('../../../shared/ats-config.cjs');
const { openDatabase, createStore, seedCompany, RECORD_KINDS } = require('./database');
const { createPlatformRouter } = require('./index');

const EXCLUDED_TIMELINE_KINDS = ['audit', 'outbox', 'automations', 'notifications', 'notes', 'documents', 'savedViews'];
const SUPPORTED_TIMELINE_KINDS = RECORD_KINDS.filter(kind => !EXCLUDED_TIMELINE_KINDS.includes(kind));
const FIXTURE_KINDS = ['requisitions', 'interviews', 'submissions', 'placements', 'invoices', 'onboarding', 'tasks'];

test('bootstrap advertises the timeline contract and supported records return isolated activity', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-timeline-capabilities-'));
  const dbPath = path.join(directory, 'platform.sqlite');
  const config = defaults('corporate');
  config.modules.agency = true;
  config.modules.invoices = true;
  config.modules.onboarding = true;
  config.roles.push(
    { id: 'timeline-no-view', name: 'No timeline access', scope: 'all', permissions: { dashboard: ['view'] }, sensitive: [] },
    { id: 'timeline-owned-tasks', name: 'Owned tasks only', scope: 'owned', permissions: { tasks: ['view'] }, sensitive: [] }
  );
  config.users.push(
    { id: 'timeline-no-view-user', name: 'No Timeline Access', roleId: 'timeline-no-view' },
    { id: 'timeline-scoped-user', name: 'Scoped Task Reader', roleId: 'timeline-owned-tasks' }
  );

  const fixtureDb = openDatabase(dbPath);
  seedCompany(fixtureDb, 'local-company', config, { seedDemo: false });
  const store = createStore(fixtureDb, 'local-company');
  for (const kind of FIXTURE_KINDS) {
    store.put(kind, {
      id: `timeline-${kind}`,
      title: `Fixture ${kind}`,
      name: `Fixture ${kind}`,
      status: 'open',
      ownerId: 'demo-admin',
      email: 'parent-private@example.test',
      salary: 987654,
      contactEmail: 'parent-contact@example.test'
    });
    fixtureDb.prepare('INSERT INTO platform_audit(company_id,actor_id,action,kind,record_id,details,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('local-company', 'demo-admin', 'fixture.activity', kind, `timeline-${kind}`, JSON.stringify({ salary: 'AUDIT_SALARY_SECRET', email: 'AUDIT_EMAIL_SECRET' }), '2026-09-01T12:00:00.000Z');
    store.put('tasks', {
      id: `timeline-child-task-${kind}`, title: 'Fixture task', status: 'open',
      relatedKind: kind, relatedId: `timeline-${kind}`, ownerId: 'demo-admin', privateNotes: 'TASK_PRIVATE_SECRET'
    });
    store.put('interviews', {
      id: `timeline-child-interview-${kind}`, status: 'scheduled', scheduledAt: '2026-09-02T12:00:00.000Z',
      relatedKind: kind, relatedId: `timeline-${kind}`, feedback: 'INTERVIEW_FEEDBACK_SECRET', contactEmail: 'INTERVIEW_EMAIL_SECRET'
    });
    store.put('offers', {
      id: `timeline-child-offer-${kind}`, status: 'sent', sentAt: '2026-09-03T12:00:00.000Z',
      relatedKind: kind, relatedId: `timeline-${kind}`, salary: 876543, compensation: { base: 876543 }
    });
  }
  fixtureDb.close();

  const router = createPlatformRouter({ dbPath, dataDir: path.join(directory, 'documents'), initialConfig: config, seedDemo: false });
  const app = express();
  app.use('/api/platform', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    router.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const request = (route, user = 'demo-admin') => fetch(`http://127.0.0.1:${server.address().port}/api/platform${route}`, { headers: { 'X-Demo-User': user } });
  const bootstrapResponse = await request('/bootstrap');
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = (await bootstrapResponse.json()).data;
  assert.deepEqual(bootstrap.capabilities.timelineKinds, SUPPORTED_TIMELINE_KINDS);
  for (const excludedKind of EXCLUDED_TIMELINE_KINDS) {
    const excludedResponse = await request(`/timeline/${excludedKind}/not-a-record`);
    assert.equal(excludedResponse.status, 404, `${excludedKind} should be excluded from timeline routes`);
  }

  for (const kind of FIXTURE_KINDS) {
    const response = await request(`/timeline/${kind}/timeline-${kind}`);
    assert.equal(response.status, 200, `${kind} timeline should be available`);
    const result = (await response.json()).data;
    assert.equal(result.kind, kind);
    assert.equal(result.id, `timeline-${kind}`);
    assert.ok(result.items.some(item => item.type === 'audit' && item.action === 'fixture.activity'));
    assert.ok(result.items.some(item => item.type === 'task' && item.id === `timeline-child-task-${kind}`));
    assert.ok(result.items.some(item => item.type === 'interview' && item.id === `timeline-child-interview-${kind}`));
    assert.ok(result.items.some(item => item.type === 'offer' && item.id === `timeline-child-offer-${kind}`));
    const serialized = JSON.stringify(result);
    for (const privateValue of ['AUDIT_SALARY_SECRET', 'AUDIT_EMAIL_SECRET', 'TASK_PRIVATE_SECRET', 'INTERVIEW_FEEDBACK_SECRET', 'INTERVIEW_EMAIL_SECRET', '876543', 'parent-private@example.test', 'parent-contact@example.test']) {
      assert.equal(serialized.includes(privateValue), false, `${kind} timeline leaked ${privateValue}`);
    }
  }

  const deniedPermission = await request('/timeline/tasks/timeline-tasks', 'timeline-no-view-user');
  assert.equal(deniedPermission.status, 403);
  const deniedScope = await request('/timeline/tasks/timeline-tasks', 'timeline-scoped-user');
  assert.equal(deniedScope.status, 404);
  const unknownRecord = await request('/timeline/tasks/does-not-exist');
  assert.equal(unknownRecord.status, 404);
});
