const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const RECORD_KINDS = [
  'jobs', 'candidates', 'applications', 'requisitions', 'approvals', 'interviews', 'feedback', 'offers', 'onboarding', 'tasks', 'notifications', 'clients', 'contacts', 'submissions', 'placements', 'invoices', 'talentPools', 'referrals', 'notes', 'workforceTargets', 'savedViews', 'audit', 'outbox', 'automations', 'documents'
];

function openDatabase(dbPath = process.env.ATS_PLATFORM_DB || path.join(process.cwd(), 'server', 'data', 'platform.sqlite')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS platform_records (
      company_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      PRIMARY KEY(company_id, kind, id)
    );
    CREATE INDEX IF NOT EXISTS platform_records_kind ON platform_records(company_id, kind, archived_at);
    CREATE TABLE IF NOT EXISTS platform_users (
      company_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(company_id, id)
    );
    CREATE TABLE IF NOT EXISTS platform_config (
      company_id TEXT PRIMARY KEY, active TEXT NOT NULL, draft TEXT NOT NULL,
      active_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_config_versions (
      company_id TEXT NOT NULL, version INTEGER NOT NULL, config TEXT NOT NULL,
      actor_id TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT,
      PRIMARY KEY(company_id, version)
    );
    CREATE TABLE IF NOT EXISTS platform_audit (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, kind TEXT, record_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return db;
}

const now = () => new Date().toISOString();
const uid = (prefix = 'rec') => `${prefix}_${crypto.randomUUID()}`;
const crypto = require('node:crypto');

function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }

function createStore(db, companyId) {
  const getStmt = db.prepare('SELECT data, created_at, updated_at, archived_at FROM platform_records WHERE company_id=? AND kind=? AND id=?');
  const listStmt = db.prepare('SELECT data, created_at, updated_at, archived_at FROM platform_records WHERE company_id=? AND kind=? AND archived_at IS NULL ORDER BY updated_at DESC');
  return {
    get(kind, id, { includeArchived = false } = {}) {
      const row = getStmt.get(companyId, kind, id);
      if (!row || (!includeArchived && row.archived_at)) return null;
      return { ...parseJson(row.data), id, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}) };
    },
    list(kind, { includeArchived = false } = {}) {
      const rows = (includeArchived ? db.prepare('SELECT data, id, created_at, updated_at, archived_at FROM platform_records WHERE company_id=? AND kind=? ORDER BY updated_at DESC').all(companyId, kind) : listStmt.all(companyId, kind));
      return rows.map(row => ({ ...parseJson(row.data), id: row.id || parseJson(row.data).id, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.archived_at ? { archivedAt: row.archived_at } : {}) }));
    },
    put(kind, input, actor = 'system') {
      const timestamp = now();
      const id = input.id || uid(kind.slice(0, -1));
      const prior = this.get(kind, id, { includeArchived: true });
      const data = { ...(prior || {}), ...input, id, createdAt: prior?.createdAt || timestamp, updatedAt: timestamp };
      delete data.archivedAt;
      db.prepare(`INSERT INTO platform_records(company_id,kind,id,data,created_at,updated_at,archived_at)
        VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(company_id,kind,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at,archived_at=NULL`)
        .run(companyId, kind, id, JSON.stringify(data), data.createdAt, timestamp);
      return data;
    },
    archive(kind, id) {
      const current = this.get(kind, id);
      if (!current) return null;
      const timestamp = now();
      db.prepare('UPDATE platform_records SET archived_at=?,updated_at=? WHERE company_id=? AND kind=? AND id=?').run(timestamp, timestamp, companyId, kind, id);
      return { ...current, archivedAt: timestamp, updatedAt: timestamp };
    },
    count(kind) { return db.prepare('SELECT count(*) AS n FROM platform_records WHERE company_id=? AND kind=? AND archived_at IS NULL').get(companyId, kind).n; }
  };
}

function insertSeedRecord(db, companyId, kind, record) {
  const timestamp = now();
  const id = record.id || uid(kind.slice(0, -1));
  const data = { ...record, id, createdAt: timestamp, updatedAt: timestamp };
  db.prepare('INSERT OR IGNORE INTO platform_records(company_id,kind,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(companyId, kind, id, JSON.stringify(data), timestamp, timestamp);
  return data;
}

function seedCompany(db, companyId, config) {
  const exists = db.prepare('SELECT 1 FROM platform_config WHERE company_id=?').get(companyId);
  if (exists) return;
  const timestamp = now();
  const configuration = JSON.stringify(config);
  db.prepare('INSERT INTO platform_config(company_id,active,draft,active_version,updated_at) VALUES(?,?,?,?,?)').run(companyId, configuration, configuration, 1, timestamp);
  db.prepare('INSERT INTO platform_config_versions(company_id,version,config,actor_id,created_at,note) VALUES(?,?,?,?,?,?)').run(companyId, 1, configuration, 'system', timestamp, 'Initial configuration');

  const units = config?.organization?.units || [];
  const locations = config?.organization?.locations || [];
  const configuredUsers = Array.isArray(config?.users) ? config.users : [];
  const configuredRoles = config?.roles || [];
  const users = configuredUsers.map(user => {
    const role = configuredRoles.find(item => item.id === user.roleId);
    const unit = units.find(item => item.id === user.departmentId);
    const location = locations.find(item => item.id === user.locationId);
    return { ...user, role: user.roleId, roleName: role?.name || user.roleId, department: unit?.name || user.departmentId || '', location: location?.name || user.locationId || '' };
  });
  for (const user of users) db.prepare('INSERT INTO platform_users(company_id,id,data) VALUES(?,?,?)').run(companyId, user.id, JSON.stringify(user));
  const consultantRole = configuredRoles.find(role => /agency|consultant/i.test(`${role.id} ${role.name}`));
  if ((config?.mode === 'agency' || config?.modules?.agency) && consultantRole && !users.some(user => user.roleId === consultantRole.id)) {
    const consultant = { id: 'demo-consultant', name: 'Avery Kim', email: 'consultant@localhost.test', roleId: consultantRole.id, role: consultantRole.id, roleName: consultantRole.name, department: 'Recruitment', location: locations[0]?.name || '' };
    db.prepare('INSERT INTO platform_users(company_id,id,data) VALUES(?,?,?)').run(companyId, consultant.id, JSON.stringify(consultant));
  }

  const agency = config?.mode === 'agency' || config?.modules?.agency === true;
  const defaultPipeline = (config?.pipelines || []).find(item => item.default) || config?.pipelines?.[0];
  const firstStage = defaultPipeline?.stages?.[0];
  const defaultStage = firstStage?.id || firstStage?.name || 'Applied';
  const engineeringPipeline = (config?.pipelines || []).find(item => /engineer/i.test(`${item.id} ${item.name}`)) || defaultPipeline;
  const consultantId = users.find(user => user.roleId === consultantRole?.id)?.id;
  if (agency) {
    const client = insertSeedRecord(db, companyId, 'clients', { name: 'Northstar Analytics', status: 'active', industry: 'Technology', ownerId: consultantId, contacts: [] });
    const job = insertSeedRecord(db, companyId, 'jobs', { title: 'Senior Data Engineer', department: 'Data', location: locations[0]?.name || 'London', status: 'open', visibility: config?.modules?.careers ? 'public' : 'private', clientId: client.id, openings: 2, employmentType: 'full-time', pipelineId: defaultPipeline?.id, ownerId: consultantId });
    const candidate = insertSeedRecord(db, companyId, 'candidates', { name: 'Priya Nair', email: 'priya@example.test', phone: '+44 7700 900123', source: 'Referral', skills: ['Python', 'SQL'], status: 'active', consentStatus: 'granted', ownerId: consultantId });
    insertSeedRecord(db, companyId, 'applications', { candidateId: candidate.id, jobId: job.id, stage: defaultStage, status: 'active', source: 'Referral', ownerId: consultantId });
    if (config?.modules?.agency) insertSeedRecord(db, companyId, 'submissions', { clientId: client.id, candidateId: candidate.id, jobId: job.id, status: 'submitted', ownerId: consultantId });
  } else {
    const manager = users.find(user => /manager/i.test(`${user.roleId} ${user.roleName}`));
    const recruiter = users.find(user => /recruit/i.test(`${user.roleId} ${user.roleName}`));
    const location = locations[0]?.name || '';
    const job1 = insertSeedRecord(db, companyId, 'jobs', { title: 'Senior Software Engineer', department: manager?.department || units.find(unit => /engineering/i.test(unit.name))?.name || 'Engineering', team: 'Platform', location, status: 'open', visibility: config?.modules?.careers ? 'public' : 'private', openings: 2, employmentType: (config?.employmentTypes || []).find(item => item.enabled)?.id || 'full-time', pipelineId: engineeringPipeline?.id, hiringManagerId: manager?.id, recruiterId: recruiter?.id, salaryBand: { min: 150000, max: 190000, currency: config?.regional?.currency || 'USD' }, targetDate: '2026-12-15', description: 'Build reliable product systems for teams using our platform.' });
    insertSeedRecord(db, companyId, 'jobs', { title: 'Product Marketing Manager', department: 'Marketing', location: location || 'Remote', status: 'open', visibility: config?.modules?.careers ? 'public' : 'private', openings: 1, employmentType: (config?.employmentTypes || []).find(item => item.enabled)?.id || 'full-time', pipelineId: defaultPipeline?.id, recruiterId: recruiter?.id, description: 'Shape positioning and launches for a growing product.' });
    const candidate = insertSeedRecord(db, companyId, 'candidates', { name: 'Priya Nair', email: 'priya@example.test', phone: '+1 555 010 3421', source: 'Employee referral', skills: ['TypeScript', 'React', 'Node.js'], status: 'active', consentStatus: 'granted', noticePeriodDays: 30, expectedSalary: 175000, currentSalary: 155000, ownerId: recruiter?.id });
    const app = insertSeedRecord(db, companyId, 'applications', { candidateId: candidate.id, jobId: job1.id, stage: defaultStage, status: 'active', source: 'Employee referral', ownerId: recruiter?.id, pipelineId: engineeringPipeline?.id });
    insertSeedRecord(db, companyId, 'interviews', { applicationId: app.id, candidateId: candidate.id, jobId: job1.id, type: 'Technical interview', status: 'scheduled', scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(), durationMinutes: 60, panel: users.filter(user => /interviewer/i.test(`${user.roleId} ${user.roleName}`)).map(user => user.id).slice(0, 1), requiredFeedback: true });
    const requisitionFlow = (config?.approvalWorkflows || []).find(item => item.module === 'requisitions');
    const approverSteps = requisitionFlow?.steps || [];
    insertSeedRecord(db, companyId, 'requisitions', { title: 'Design Systems Engineer', department: job1.department, location, headcount: 1, type: 'new', status: approverSteps.length ? 'pending' : 'approved', requestedBy: manager?.id || recruiter?.id, justification: 'Support the growing product design system.', budget: 165000, currency: config?.regional?.currency || 'USD', approvals: approverSteps.map(step => step.userId || step.roleId), approvalsCompleted: [], pipelineId: engineeringPipeline?.id });
    if (config?.modules?.workforcePlanning) insertSeedRecord(db, companyId, 'workforceTargets', { period: '2026-Q4', department: job1.department, location, target: 3, hired: 0 });
    if (config?.modules?.tasks) insertSeedRecord(db, companyId, 'tasks', { title: 'Review Senior Software Engineer applications', ownerId: recruiter?.id, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), status: 'open', priority: 'high', relatedKind: 'jobs', relatedId: job1.id });
  }
  for (const kind of ['notifications', 'automations', 'talentPools', 'referrals', 'savedViews', 'outbox']) {
    if (kind === 'notifications') insertSeedRecord(db, companyId, kind, { userId: users.find(user => user.roleId === 'recruiter')?.id || consultantId || users[0]?.id, title: 'New application received', body: 'A candidate applied to a published role.', read: false, createdAt: timestamp });
  }
}

module.exports = { RECORD_KINDS, openDatabase, createStore, seedCompany, parseJson, now, uid };
