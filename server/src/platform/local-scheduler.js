'use strict';

const { allowsAutomationNotification } = require('./notification-policy');

const DEFAULT_INTERVAL_MS = 60_000;

function renderTemplate(value, context) {
  return String(value || '').replace(/{{\s*([^{}]+?)\s*}}/g, (_, path) => {
    const parts = String(path).trim().split('.');
    let resolved = parts.reduce((cursor, key) => cursor == null ? undefined : cursor[key], context);
    if (resolved && typeof resolved === 'object') resolved = resolved.name || resolved.title || resolved.fullName || '';
    return resolved == null ? '' : String(resolved);
  });
}

/**
 * Local-only interview reminders. The work inside each transaction is entirely
 * synchronous: DatabaseSync and the platform store must never be held open
 * across an awaited helper/promise.
 */
function enqueueDueInterviewReminders({ db, store, companyId = 'local-company', config, users = [], audit = () => {}, now = new Date() } = {}) {
  if (!db || !store || !config) throw new TypeError('db, store, and config are required');
  const currentMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(currentMs)) throw new TypeError('Planner clock returned an invalid date');
  const stamp = new Date(currentMs).toISOString();
  const hours = Array.isArray(config.interviews?.remindersHours)
    ? [...new Set(config.interviews.remindersHours.map(Number).filter(value => Number.isFinite(value) && value >= 0))]
    : [];
  if (!hours.length) return { notifications: 0, outbox: 0 };
  const configuredUsers = new Map(users.map(user => [user.id, user]));
  const notificationPolicy = allowsAutomationNotification(config, { event: 'interview.reminder', record: { __kind: 'interviews' } });
  const enqueueNotifications = notificationPolicy.allowed;
  // Older tenant configs had no integrations module flag; keep their template
  // behavior, while respecting an explicit integrations:false setting.
  const enqueueOutbox = config.modules?.integrations !== false;
  let notificationCount = 0;
  let outboxCount = 0;
  const templates = Array.isArray(config.communicationTemplates) ? config.communicationTemplates : [];
  const interviews = store.list('interviews');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const interview of interviews) {
      if (interview.status !== 'scheduled' || !interview.scheduledAt) continue;
      const scheduledMs = new Date(interview.scheduledAt).getTime();
      if (!Number.isFinite(scheduledMs) || scheduledMs <= currentMs) continue;
      const candidate = interview.candidateId ? store.get('candidates', interview.candidateId) || {} : {};
      const job = interview.jobId ? store.get('jobs', interview.jobId) || {} : {};
      const recipients = [...new Set([...(Array.isArray(interview.panel) ? interview.panel : []), interview.interviewerId].filter(id => configuredUsers.has(id)))];
      for (const reminderHours of hours) {
        const dueMs = scheduledMs - reminderHours * 60 * 60 * 1000;
        if (dueMs > currentMs) continue;
        const dueAt = new Date(dueMs).toISOString();
        for (const userId of recipients) {
          const id = `interview-reminder:${interview.id}:${reminderHours}:${userId}`;
          if (enqueueNotifications && !store.get('notifications', id, { includeArchived: true })) {
            store.put('notifications', {
              id, userId, title: 'Interview reminder',
              body: `${interview.type || 'Interview'} is scheduled for ${new Date(scheduledMs).toISOString()}.`,
              read: false, kind: 'interview_reminder', interviewId: interview.id,
              scheduledAt: new Date(scheduledMs).toISOString(), reminderHours, reminderAt: dueAt,
            }, 'system');
            notificationCount += 1;
          }
          const user = configuredUsers.get(userId);
          const language = user.language || candidate.language || config.locale || 'en';
          const sameLanguage = item => String(item?.language || '').toLowerCase() === String(language).toLowerCase();
          const eventTemplates = templates.filter(item => item?.event === 'interview.reminder' && typeof item.channel === 'string' && item.channel);
          const template = eventTemplates.find(sameLanguage)
            || eventTemplates.find(item => String(item.language || '').split(/[-_]/)[0] === String(language).split(/[-_]/)[0])
            || eventTemplates.find(item => !item.language || item.language === 'en')
            || eventTemplates[0];
          if (template && enqueueOutbox) {
            const outboxId = `${id}:outbox`;
            if (!store.get('outbox', outboxId, { includeArchived: true })) {
              const templateContext = { interview, candidate, job, user, company: config.company || { name: config.companyName || config.branding?.name || '' }, scheduledAt: new Date(scheduledMs).toISOString(), reminderHours };
              const approvalRequired = template.approvalRequired === true;
              store.put('outbox', {
                id: outboxId, event: 'interview.reminder', eventKey: id,
                status: approvalRequired ? 'approval_required' : 'queued', deliveryMode: 'mock', channel: template.channel,
                recipient: user.email || '', sender: template.sender || config.integrations?.email?.from || config.integrations?.email?.sender || '',
                language: template.language || language, templateId: template.id, approvalRequired, approvedAt: null, approvedBy: null,
                subject: renderTemplate(template.subject || 'Interview reminder', templateContext), body: renderTemplate(template.body || '', templateContext),
                interviewId: interview.id, reminderAt: dueAt, createdAt: stamp,
              }, 'system');
              outboxCount += 1;
            }
          }
        }
      }
    }
    if (notificationCount || outboxCount) audit('interview.reminders-enqueued', 'interviews', null, { notifications: notificationCount, outbox: outboxCount });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { notifications: notificationCount, outbox: outboxCount };
}

function createInterviewReminderScheduler({ db, store, config, users = () => [], audit = () => {}, companyId = 'local-company', intervalMs = DEFAULT_INTERVAL_MS, now = () => new Date(), enabled = false } = {}) {
  if (!db || !store || typeof config !== 'function') throw new TypeError('db, store, and config are required');
  let timer = null;
  let stopped = false;
  let running = false;

  function runOnce() {
    if (stopped || running) return 0;
    running = true;
    let created = 0;
    try {
      const result = enqueueDueInterviewReminders({ db, store, companyId, config: config() || {}, users: users() || [], audit, now: now() });
      created = result.notifications + result.outbox;
      return created;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!enabled || stopped || timer) return;
    runOnce();
    timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, runOnce, get running() { return running; } };
}

module.exports = { DEFAULT_INTERVAL_MS, enqueueDueInterviewReminders, createInterviewReminderScheduler };
