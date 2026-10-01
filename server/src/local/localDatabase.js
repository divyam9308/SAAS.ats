const { DatabaseSync } = require('node:sqlite')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { companyConfig } = require('../config/companyConfig')

const dataDirectory = path.resolve(process.env.LOCAL_DATA_DIR || path.join(__dirname, '../../data'))
mkdirSync(dataDirectory, { recursive: true })
const databasePath = path.join(dataDirectory, `${companyConfig.slug || 'ats'}-demo.sqlite`)
const db = new DatabaseSync(databasePath)

db.exec(`
  pragma journal_mode = WAL;
  pragma foreign_keys = on;
  create table if not exists local_records (
    kind text not null,
    id text not null,
    payload text not null,
    created_at text not null,
    updated_at text not null,
    primary key (kind, id)
  );
  create index if not exists local_records_kind_created_idx
    on local_records (kind, created_at desc);
  create table if not exists local_settings (
    key text primary key,
    payload text not null,
    updated_at text not null
  );
`)

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const parse = row => row ? JSON.parse(row.payload) : null
const json = value => JSON.stringify(value ?? null)

const statements = {
  list: db.prepare('select payload from local_records where kind = ? order by created_at desc'),
  get: db.prepare('select payload from local_records where kind = ? and id = ?'),
  put: db.prepare(`insert into local_records (kind, id, payload, created_at, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(kind, id) do update set payload = excluded.payload, updated_at = excluded.updated_at`),
  remove: db.prepare('delete from local_records where kind = ? and id = ?'),
  count: db.prepare('select count(*) as value from local_records where kind = ?'),
  clear: db.prepare('delete from local_records'),
  clearSettings: db.prepare('delete from local_settings'),
  getSetting: db.prepare('select payload from local_settings where key = ?'),
  setSetting: db.prepare(`insert into local_settings (key, payload, updated_at) values (?, ?, ?)
    on conflict(key) do update set payload = excluded.payload, updated_at = excluded.updated_at`)
}

function list(kind) {
  return statements.list.all(kind).map(parse)
}

function get(kind, recordId) {
  if (!recordId) return null
  return parse(statements.get.get(kind, recordId))
}

function put(kind, value) {
  const timestamp = now()
  const current = value.id ? get(kind, value.id) : null
  const record = {
    ...current,
    ...value,
    id: value.id || id(),
    created_at: current?.created_at || value.created_at || timestamp,
    updated_at: timestamp
  }
  statements.put.run(kind, record.id, json(record), record.created_at, record.updated_at)
  return record
}

function remove(kind, recordId) {
  return statements.remove.run(kind, recordId).changes > 0
}

function count(kind) {
  return Number(statements.count.get(kind)?.value || 0)
}

function setting(key, fallback = null) {
  const row = statements.getSetting.get(key)
  return row ? JSON.parse(row.payload) : fallback
}

function setSetting(key, value) {
  statements.setSetting.run(key, json(value), now())
  return value
}

function displayId(prefix, kind) {
  const values = list(kind).map(item => String(item[`${kind.slice(0, -1)}_display_id`] || item.display_id || ''))
  const highest = values.reduce((max, value) => {
    const match = value.match(/(\d+)$/)
    return Math.max(max, Number(match?.[1] || 0))
  }, 0)
  return `${prefix}${String(highest + 1).padStart(4, '0')}`
}

function seed() {
  if (count('profiles')) return
  const demoUser = put('profiles', {
    id: 'demo-admin', user_id: 'demo-admin', name: 'Demo Administrator',
    email: 'demo@localhost.test', status: 'active', role: 'super_admin'
  })
  const clientA = put('clients', {
    id: id(), client_display_id: `${companyConfig.ids.clientPrefix}0001`, client_name: 'Northstar Labs',
    name: 'Northstar Labs', contact_person: 'Ananya Mehta', email: 'ananya@northstar.test',
    mobile: '9876500001', city: 'New Delhi', state: 'Delhi', location: 'New Delhi',
    sector: 'Technology', status: 'Active', consultant_name: demoUser.name, consultant: demoUser.name,
    connected_on_date: new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10),
    contract_signed: true, billing_entity: companyConfig.billing.entities[0]?.key || ''
  })
  const clientB = put('clients', {
    id: id(), client_display_id: `${companyConfig.ids.clientPrefix}0002`, client_name: 'Summit Retail',
    name: 'Summit Retail', contact_person: 'Rohan Kapoor', email: 'rohan@summit.test',
    mobile: '9876500002', city: 'Mumbai', state: 'Maharashtra', location: 'Mumbai',
    sector: 'Retail', status: 'Active', consultant_name: demoUser.name, consultant: demoUser.name,
    connected_on_date: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10), contract_signed: false
  })
  const jobA = put('jobs', {
    id: id(), job_display_id: `${companyConfig.ids.jobPrefix}0001`, title: 'Senior Product Manager', role: 'Senior Product Manager',
    client_id: clientA.id, client_name: clientA.client_name, city: 'New Delhi', location: 'New Delhi',
    vertical: 'Product', mandate_status: companyConfig.jobs.statuses[0] || 'Ongoing (P1)', status: companyConfig.jobs.statuses[0] || 'Ongoing (P1)',
    consultants: [demoUser.name], team_lead: demoUser.name, allocation_date: new Date(Date.now() - 18 * 86400000).toISOString().slice(0, 10),
    is_public: true, public_slug: 'senior-product-manager', public_name: 'Senior Product Manager',
    public_location: 'New Delhi', public_experience: '5–8 years', public_skills: ['Product Strategy', 'Analytics']
  })
  const jobB = put('jobs', {
    id: id(), job_display_id: `${companyConfig.ids.jobPrefix}0002`, title: 'Talent Acquisition Lead', role: 'Talent Acquisition Lead',
    client_id: clientB.id, client_name: clientB.client_name, city: 'Mumbai', location: 'Mumbai', vertical: 'Human Resources',
    mandate_status: companyConfig.jobs.statuses[0] || 'Ongoing (P1)', status: companyConfig.jobs.statuses[0] || 'Ongoing (P1)',
    consultants: [demoUser.name], team_lead: demoUser.name, allocation_date: new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10),
    is_public: true, public_slug: 'talent-acquisition-lead', public_name: 'Talent Acquisition Lead', public_location: 'Mumbai', public_experience: '4–7 years'
  })
  put('invoice_entities', {
    id: id(), entity_display_id: 'EID1', invoice_id: 'EID1', legal_entity_name: clientA.client_name,
    optional_name: 'Northstar', address: 'New Delhi, Delhi', state: 'Delhi', state_code: '07',
    place_of_supply: 'Delhi', gstin: '', pan: '', contact_person: clientA.contact_person, email: clientA.email,
    sac: companyConfig.billing.defaultSac, billing_entity: companyConfig.billing.entities[0]?.key || 'PRIMARY',
    gst_component: 'CGST_SGST', igst_rate: companyConfig.billing.gstPercentage,
    cgst_rate: companyConfig.billing.gstPercentage / 2, sgst_rate: companyConfig.billing.gstPercentage / 2
  })
  put('invoice_entities', {
    id: id(), entity_display_id: 'EID2', invoice_id: 'EID2', legal_entity_name: clientB.client_name,
    optional_name: 'Summit', address: 'Mumbai, Maharashtra', state: 'Maharashtra', state_code: '27',
    place_of_supply: 'Maharashtra', gstin: '', pan: '', contact_person: clientB.contact_person, email: clientB.email,
    sac: companyConfig.billing.defaultSac, billing_entity: companyConfig.billing.entities[0]?.key || 'PRIMARY',
    gst_component: 'IGST', igst_rate: companyConfig.billing.gstPercentage,
    cgst_rate: companyConfig.billing.gstPercentage / 2, sgst_rate: companyConfig.billing.gstPercentage / 2
  })
  const stages = companyConfig.pipeline.filter(stage => stage.enabled && stage.key !== 'duplicate')
  ;[
    ['Aarav Sharma', 'aarav@example.test', clientA, jobA, stages[0]?.label || 'Interested'],
    ['Meera Iyer', 'meera@example.test', clientA, jobA, stages[3]?.label || 'Interview'],
    ['Kabir Singh', 'kabir@example.test', clientB, jobB, stages[4]?.label || 'Client Submission'],
    ['Ishita Rao', 'ishita@example.test', clientB, jobB, companyConfig.terminology.hiredStage || 'Joined']
  ].forEach(([fullName, email, client, job, status], index) => put('candidates', {
    id: id(), associationId: id(), candidateId: id(), candidate_display_id: `${companyConfig.ids.candidatePrefix}${String(index + 1).padStart(4, '0')}`,
    full_name: fullName, candidate_name: fullName, email, mobile_number: `987650001${index}`,
    city: index % 2 ? 'Mumbai' : 'New Delhi', state: index % 2 ? 'Maharashtra' : 'Delhi',
    current_designation: index % 2 ? 'Recruitment Manager' : 'Product Manager', current_organisation: 'Demo Company',
    experience_years: 4 + index, notice_period: '30 days', skills: ['Communication', 'Leadership'],
    status, candidate_status: status, client_id: client.id, client_name: client.client_name,
    job_id: job.id, job_title: job.title, consultant_name: demoUser.name, consultant_user_id: demoUser.id
  }))
}

function reset() {
  statements.clear.run()
  statements.clearSettings.run()
  seed()
}

seed()

module.exports = { databasePath, count, displayId, get, list, put, remove, reset, setting, setSetting }
