'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, createStore, seedCompany } = require('./database');
const { defaults } = require('../../../shared/ats-config.cjs');
const { createInterviewReminderScheduler, enqueueDueInterviewReminders, DEFAULT_INTERVAL_MS } = require('./local-scheduler');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-reminders-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const config = defaults('corporate');
  config.interviews.remindersHours = [1];
  config.communicationTemplates = [{ id: 'interview-reminder', event: 'interview.reminder', channel: 'email', subject: 'Reminder', body: 'See calendar.' }];
  seedCompany(db, 'local-company', config);
  const store = createStore(db, 'local-company');
  const recipient = config.users[0];
  store.put('interviews', {
    id: 'upcoming-interview', status: 'scheduled', type: 'Panel',
    scheduledAt: '2030-01-01T12:30:00.000Z', panel: [recipient.id],
  });
  t.after(() => { try { db.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, store, config, recipient };
}

test('scheduler is off by default and an enabled start runs immediately and idempotently', t => {
  const { db, store, config } = fixture(t);
  const scheduler = createInterviewReminderScheduler({ db, store, config: () => config, users: () => config.users, now: () => new Date('2030-01-01T12:00:00.000Z') });
  scheduler.start();
  assert.equal(store.list('notifications').filter(row => row.kind === 'interview_reminder').length, 0);
  scheduler.stop();

  const enabled = createInterviewReminderScheduler({
    db, store, config: () => config, users: () => config.users,
    audit: () => {}, now: () => new Date('2030-01-01T12:00:00.000Z'), enabled: true,
  });
  enabled.start();
  assert.equal(store.list('notifications').filter(row => row.kind === 'interview_reminder').length, 1);
  assert.equal(store.list('outbox').filter(row => row.event === 'interview.reminder').length, 1);
  assert.equal(enabled.runOnce(), 0);
  enabled.stop();
  assert.equal(DEFAULT_INTERVAL_MS, 60_000);
});

test('planner rolls back notification and outbox writes if its audit helper fails', t => {
  const { db, store, config } = fixture(t);
  const args = { db, store, config, users: config.users, now: new Date('2030-01-01T12:00:00.000Z') };
  assert.throws(() => enqueueDueInterviewReminders({ ...args, audit: () => { throw new Error('audit failure'); } }), /audit failure/);
  assert.equal(store.list('notifications').filter(row => row.kind === 'interview_reminder').length, 0);
  assert.equal(store.list('outbox').filter(row => row.event === 'interview.reminder').length, 0);
  const result = enqueueDueInterviewReminders({ ...args, audit: () => {} });
  assert.deepEqual(result, { notifications: 1, outbox: 1 });
});

test('scheduler honors notification policy and integrations module independently', t => {
  const { db, store, config } = fixture(t);
  const args = { db, store, users: config.users, now: new Date('2030-01-01T12:00:00.000Z'), audit: () => {} };
  config.modules.notifications = false;
  assert.deepEqual(enqueueDueInterviewReminders({ ...args, config }), { notifications: 0, outbox: 1 });
  assert.equal(store.list('notifications').filter(row => row.kind === 'interview_reminder').length, 0);
  assert.equal(store.list('outbox').filter(row => row.event === 'interview.reminder').length, 1);

  config.modules.notifications = true;
  config.modules.integrations = false;
  assert.deepEqual(enqueueDueInterviewReminders({ ...args, config }), { notifications: 1, outbox: 0 });
  assert.equal(store.list('notifications').filter(row => row.kind === 'interview_reminder').length, 1);
  assert.equal(store.list('outbox').filter(row => row.event === 'interview.reminder').length, 1);
});

test('scheduler applies interview category and in-app channel preferences, preserving legacy defaults', t => {
  const { db, store, config } = fixture(t);
  const args = { db, store, users: config.users, now: new Date('2030-01-01T12:00:00.000Z'), audit: () => {} };
  config.notifications = { preferences: { interviews: false } };
  assert.deepEqual(enqueueDueInterviewReminders({ ...args, config }), { notifications: 0, outbox: 1 });

  config.notifications = { channels: ['email'] };
  assert.deepEqual(enqueueDueInterviewReminders({ ...args, config }), { notifications: 0, outbox: 0 });

  // Missing channel and module fields in older configs retain historical behavior.
  delete config.notifications;
  delete config.modules;
  assert.deepEqual(enqueueDueInterviewReminders({ ...args, config }), { notifications: 1, outbox: 0 });
});

test('reminder outbox renders a localized template and keeps approval-required messages gated', t => {
  const { db, store, config, recipient } = fixture(t);
  recipient.language = 'fr';
  config.communicationTemplates = [
    { id: 'reminder-en', event: 'interview.reminder', channel: 'email', language: 'en', subject: 'English' },
    { id: 'reminder-fr', event: 'interview.reminder', channel: 'email', language: 'fr', sender: 'Recruiting <jobs@example.test>', subject: '{{candidate.name}} — {{job.title}}', body: 'At {{scheduledAt}}', approvalRequired: true },
  ];
  store.put('candidates', { id: 'candidate-fr', name: 'Camille', language: 'fr' });
  store.put('jobs', { id: 'job-fr', title: 'Designer' });
  store.put('interviews', { id: 'fr-interview', candidateId: 'candidate-fr', jobId: 'job-fr', status: 'scheduled', type: 'Panel', scheduledAt: '2030-01-01T12:30:00.000Z', panel: [recipient.id] });
  enqueueDueInterviewReminders({ db, store, config, users: config.users, now: new Date('2030-01-01T12:00:00.000Z'), audit: () => {} });
  const message = store.get('outbox', 'interview-reminder:fr-interview:1:' + recipient.id + ':outbox');
  assert.equal(message.templateId, 'reminder-fr');
  assert.equal(message.language, 'fr');
  assert.equal(message.sender, 'Recruiting <jobs@example.test>');
  assert.equal(message.subject, 'Camille — Designer');
  assert.match(message.body, /2030-01-01T12:30:00/);
  assert.equal(message.status, 'approval_required');
  assert.equal(message.approvalRequired, true);
});
