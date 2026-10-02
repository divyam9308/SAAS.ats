import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Clock3, Download, ExternalLink, FileInput, FileOutput, History, PackagePlus, Plus, RotateCcw, Save, Search, Settings2, ShieldCheck, Trash2, Upload, WandSparkles, X } from 'lucide-react'
import { platformRequest } from './api'
import { getConfigDiff, getDisabledModuleWarnings, resolveConfigPath } from './config-review.js'
import './Settings.css'

const BUILDER_AVAILABLE = import.meta.env.VITE_BUILDER_AVAILABLE === 'true'

const SECTIONS = [
  { id: 'organization', label: 'Organization', group: 'Company', path: 'organization', required: true, desc: 'Structure, entities, departments, offices and ownership defaults.' },
  { id: 'branding', label: 'Branding', group: 'Company', path: 'branding', required: true, desc: 'Names, visual identity, login, email and careers branding.' },
  { id: 'terminology', label: 'Terminology', group: 'Company', path: 'terminology', required: true, desc: 'Use the words your people use for jobs, candidates and teams.' },
  { id: 'regional', label: 'Regional settings', group: 'Company', path: 'regional', desc: 'Currency, date and time formats, language and working hours.' },
  { id: 'modules', label: 'Modules', group: 'Company', path: 'modules', required: true, desc: 'Choose which capabilities are available in this workspace.' },
  { id: 'access', label: 'Users & permissions', group: 'People & access', path: 'access', required: true, desc: 'Users, role templates, custom roles and data access boundaries.' },
  { id: 'sensitiveData', label: 'Sensitive information', group: 'People & access', path: 'sensitiveData', desc: 'Restrict compensation, private notes, feedback and confidential files.' },
  { id: 'hiring', label: 'Hiring requests', group: 'Hiring', path: 'hiring', desc: 'Request, review and approve headcount before opening a role.' },
  { id: 'jobs', label: 'Jobs & templates', group: 'Hiring', path: 'jobs', desc: 'Job fields, employment types, reusable templates and publication rules.' },
  { id: 'pipelines', label: 'Pipelines', group: 'Hiring', path: 'pipelines', required: true, desc: 'Stages, transitions, stage requirements and default pipeline rules.' },
  { id: 'applications', label: 'Application forms', group: 'Hiring', path: 'applications', desc: 'Internal and public forms, screening questions and consent.' },
  { id: 'candidates', label: 'Candidate profiles', group: 'Hiring', path: 'candidates', desc: 'Profile sections, custom fields, tags, sources and documents.' },
  { id: 'ownership', label: 'Recruitment ownership', group: 'Hiring', path: 'ownership', desc: 'Recruiters, managers, coordinators, assignment and backups.' },
  { id: 'interviews', label: 'Interviews', group: 'Interviews & offers', path: 'interviews', desc: 'Rounds, panels, scheduling, reminders and feedback requirements.' },
  { id: 'scorecards', label: 'Scorecards & plans', group: 'Interviews & offers', path: 'scorecards', desc: 'Competencies, interview plans, ratings and recommendation rules.' },
  { id: 'approvals', label: 'Approvals', group: 'Interviews & offers', path: 'approvals', desc: 'Sequential or parallel approval chains, thresholds and delegation.' },
  { id: 'offers', label: 'Offers', group: 'Interviews & offers', path: 'offers', desc: 'Compensation, templates, expiry, approval and acceptance tracking.' },
  { id: 'onboarding', label: 'Joining & onboarding', group: 'Interviews & offers', path: 'onboarding', desc: 'Preboarding checklists, tasks, verification and HR handoff.' },
  { id: 'communications', label: 'Communications', group: 'Workflows', path: 'communications', desc: 'Message templates, sender identity, language and mock outbox.' },
  { id: 'automation', label: 'Automations', group: 'Workflows', path: 'automation', desc: 'Triggers, actions, safeguards and execution history.' },
  { id: 'tasks', label: 'Tasks & SLAs', group: 'Workflows', path: 'tasks', desc: 'Follow-ups, task ownership, expected stage times and escalation.' },
  { id: 'notifications', label: 'Notifications', group: 'Workflows', path: 'notifications', desc: 'In-app events and user delivery preferences.' },
  { id: 'careers', label: 'Careers site', group: 'Candidate experience', path: 'careers', desc: 'Public jobs, search, filters, forms, referral links and privacy content.' },
  { id: 'referrals', label: 'Employee referrals', group: 'Candidate experience', path: 'referrals', desc: 'Eligibility, milestones, duplicate handling and reward tracking.' },
  { id: 'talent', label: 'Talent pools & CRM', group: 'Candidate experience', path: 'talent', desc: 'Pools, saved searches, consent and candidate follow-ups.' },
  { id: 'reporting', label: 'Reports & targets', group: 'Insights & data', path: 'reporting', desc: 'Metrics, dashboard visibility, hiring targets and source performance.' },
  { id: 'data', label: 'Data administration', group: 'Insights & data', path: 'data', desc: 'Import, duplicate review, exports, retention, archive and restore.' },
  { id: 'privacy', label: 'Privacy & retention', group: 'Insights & data', path: 'privacy', desc: 'Consent records, retention schedule and deletion requests.' },
  { id: 'audit', label: 'Audit log', group: 'Insights & data', path: 'audit', desc: 'Track configuration, access, workflow and data changes.' },
  { id: 'integrations', label: 'Integrations', group: 'Platform', path: 'integrations', desc: 'Provider adapters for email, calendar, HRIS, boards and storage.' },
  { id: 'agency', label: 'Agency workflows', group: 'Platform', path: 'agency', module: 'agency', desc: 'Clients, mandates, submissions, placements, fees and guarantees.' },
  { id: 'workforce', label: 'Workforce plan', group: 'Platform', path: 'workforce', module: 'workforcePlanning', desc: 'Hiring targets by period, department, location and job category.' },
  { id: 'collaboration', label: 'Notes & activity', group: 'Platform', path: 'collaboration', desc: 'Shared notes, private notes, mentions and record timelines.' },
]

const FIELD_META = {
  displayName: { label: 'Company name', required: true }, legalName: { label: 'Legal entity name' },
  productName: { label: 'ATS display name', required: true }, atsProductName: { label: 'ATS display name', required: true },
  companyType: { label: 'Organization type', type: 'select', options: ['corporate', 'agency', 'hybrid'] },
  preset: { label: 'Starting preset', type: 'select', options: ['startup', 'corporate', 'agency', 'campus', 'basic'] },
  primaryColor: { label: 'Primary colour', type: 'color' }, secondaryColor: { label: 'Secondary colour', type: 'color' }, accentColor: { label: 'Accent colour', type: 'color' },
  enabled: { label: 'Enabled', type: 'boolean' }, required: { label: 'Required', type: 'boolean' }, visible: { label: 'Visible', type: 'boolean' },
  stages: { label: 'Stages' }, order: { label: 'Display order', type: 'number' }, active: { label: 'Active', type: 'boolean' },
  currency: { label: 'Currency', type: 'select', options: ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'] },
  timezone: { label: 'Time zone' }, locale: { label: 'Language and locale' }, dateFormat: { label: 'Date format', type: 'select', options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] },
  name: { label: 'Name', required: true }, label: { label: 'Label', required: true }, title: { label: 'Title', required: true }, description: { label: 'Description', type: 'longText' },
  color: { label: 'Colour', type: 'color' }, type: { label: 'Type', type: 'select', options: ['shortText', 'longText', 'number', 'currency', 'date', 'checkbox', 'singleSelect', 'multiSelect', 'url', 'email', 'phone', 'file'] },
  email: { label: 'Email', type: 'email' }, phone: { label: 'Phone', type: 'phone' }, url: { label: 'Website', type: 'url' },
  salary: { label: 'Salary information', type: 'boolean' }, compensation: { label: 'Compensation information', type: 'boolean' }, privateNotes: { label: 'Private notes', type: 'boolean' }, interviewerFeedback: { label: 'Interviewer feedback', type: 'boolean' },
  approvalMode: { label: 'Approval mode', type: 'select', options: ['single', 'sequential', 'parallel'] }, mode: { label: 'Mode', type: 'select', options: ['corporate', 'agency', 'hybrid', 'local-demo'] },
  days: { label: 'Days', type: 'number' }, hours: { label: 'Hours', type: 'number' }, amount: { label: 'Amount', type: 'currency' }, threshold: { label: 'Threshold', type: 'currency' },
  retentionDays: { label: 'Candidate data retention period (days)', type: 'number', help: 'Records become eligible for retention review after this many days of inactivity. Review and processing safeguards still apply.' },
  modules: { label: 'Modules' },
}

const pathParts = (path) => Array.isArray(path) ? path : String(path).split('.').filter(Boolean)
function getAt(obj, path) { return pathParts(path).reduce((value, key) => value?.[key], obj) }
function setAt(obj, path, value) {
  const next = structuredClone(obj || {})
  const keys = pathParts(path)
  let cursor = next
  keys.slice(0, -1).forEach((key) => { if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}; cursor = cursor[key] })
  cursor[keys.at(-1)] = value
  return next
}
function humanize(value = '') { return String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) }
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) }
function normalizeConfig(config = {}) {
  const normalized = clone(config || {})
  normalized.schemaVersion ??= normalized.version ?? 1
  normalized.company ??= { name: '', slug: '', legalName: '', website: '', supportEmail: '' }
  normalized.branding ??= {}
  normalized.terminology ??= {}
  normalized.modules ??= {}
  const careerCopyDefaults = Object.fromEntries(['eyebrow', 'brandSubheading', 'searchPlaceholder', 'noMatchesTitle', 'noMatchesDescription', 'apply', 'applicationIntro', 'submit', 'submitting', 'receivedTitle', 'receivedDescription', 'poweredBy', 'privacyFooter'].map((key) => [key, '']))
  normalized.careers = { headline: '', intro: '', footer: '', ...normalized.careers, copy: { ...careerCopyDefaults, ...(normalized.careers?.copy || {}) } }
  return normalized
}
function emptyLike(sample) {
  if (Array.isArray(sample)) return []
  if (typeof sample === 'boolean') return false
  if (typeof sample === 'number') return 0
  if (sample && typeof sample === 'object') return Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, emptyLike(value)]))
  return ''
}
function guessType(value, key) {
  if (FIELD_META[key]?.type) return FIELD_META[key].type
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'object'
  if (/email/i.test(key)) return 'email'
  if (/url|website|linkedin/i.test(key)) return 'url'
  if (/date|joining/i.test(key)) return 'date'
  if (/color/i.test(key)) return 'color'
  if (/description|justification|address|notes|intro|notice/i.test(key)) return 'longText'
  return 'text'
}
function getSchemaVersion(config) { return config?.schemaVersion ?? config?.version ?? 1 }

function formatRegionalDate(value, regional = {}) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Not available'
  const locale = regional.numberLocale || regional.language || 'en-US'
  const options = { timeZone: regional.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat(locale, options).formatToParts(date).map(({ type, value: part }) => [type, part]))
    const tokens = { YYYY: parts.year, MM: parts.month, DD: parts.day }
    const pattern = regional.dateFormat || 'YYYY-MM-DD'
    return pattern.replace(/YYYY|MM|DD/g, (token) => tokens[token])
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function ScalarControl({ label, path, value, onChange, help, required = false }) {
  const id = `setting-${path.replace(/[^a-z0-9]/gi, '-')}`
  const type = guessType(value, pathParts(path).at(-1))
  const meta = FIELD_META[pathParts(path).at(-1)] || {}
  if (type === 'boolean') return <label className="ats-setting-toggle" htmlFor={id}><span><strong>{label}</strong>{help && <small>{help}</small>}</span><input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
  if (type === 'array') return <div className="ats-setting-control"><label>{label}{required && <em>*</em>}</label><div className="ats-string-list">{(value || []).map((item, index) => <div className="ats-string-list-row" key={`${path}-${index}`}><input aria-label={`${label} ${index + 1}`} value={item ?? ''} onChange={(event) => { const next = [...value]; next[index] = event.target.value; onChange(next) }} /><button type="button" className="ats-icon-button danger" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button></div>)}</div><button type="button" className="ats-list-add" onClick={() => onChange([...(value || []), ''])}><Plus size={13} /> Add value</button>{help && <small>{help}</small>}</div>
  if (type === 'object') return null
  const inputType = ({ number: 'number', currency: 'number', date: 'date', email: 'email', phone: 'tel', url: 'url', color: 'color' })[type] || (meta.options ? 'select' : 'text')
  return <div className="ats-setting-control"><label htmlFor={id}>{label}{required && <em>*</em>}</label>{meta.options ? <select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{meta.options.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}</select> : type === 'longText' ? <textarea id={id} rows={4} value={value ?? ''} onChange={(event) => onChange(event.target.value)} /> : <input id={id} type={inputType} step={type === 'currency' ? '.01' : undefined} value={value ?? ''} onChange={(event) => onChange(inputType === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />}{help && <small>{help}</small>}</div>
}

function ObjectFields({ value = {}, path, onChange, depth = 0, omit = [] }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const isStringList = (key, child) => Array.isArray(child) && (key === 'options' || (child.length > 0 && child.every((item) => !item || typeof item !== 'object')))
  return <div className={`ats-setting-fields ${depth ? 'is-nested' : ''}`}>{Object.entries(value).filter(([key, child]) => !omit.includes(key) && !Array.isArray(child) && (!child || typeof child !== 'object')).map(([key, child]) => <ScalarControl key={`${path}.${key}`} path={`${path}.${key}`} label={FIELD_META[key]?.label || humanize(key)} value={child} help={FIELD_META[key]?.help} onChange={(next) => onChange(`${path}.${key}`, next)} required={FIELD_META[key]?.required} />)}{Object.entries(value).filter(([key, child]) => !omit.includes(key) && child && typeof child === 'object' && !Array.isArray(child)).map(([key, child]) => <fieldset className="ats-setting-subgroup" key={`${path}.${key}`}><legend>{humanize(key)}</legend><ObjectFields value={child} path={`${path}.${key}`} onChange={onChange} depth={depth + 1} /></fieldset>)}{Object.entries(value).filter(([key, child]) => !omit.includes(key) && isStringList(key, child)).map(([key, child]) => <ScalarControl key={`${path}.${key}`} path={`${path}.${key}`} label={FIELD_META[key]?.label || humanize(key)} value={child} onChange={(next) => onChange(`${path}.${key}`, next)} />)}{Object.entries(value).filter(([key, child]) => !omit.includes(key) && Array.isArray(child) && !isStringList(key, child)).map(([key, child]) => <CollectionEditor key={`${path}.${key}`} title={humanize(key)} items={child} path={`${path}.${key}`} onChange={onChange} />)}</div>
}

function CollectionEditor({ title, items, path, onChange, hint, keyName = 'name' }) {
  const [expanded, setExpanded] = useState(null)
  const list = Array.isArray(items) ? items : []
  const createItem = () => {
    const templates = {
      'customFields.jobs': { id: '', key: '', label: '', type: 'shortText', required: false, options: [] },
      'customFields.candidates': { id: '', key: '', label: '', type: 'shortText', required: false, options: [] },
      'customFields.requisitions': { id: '', key: '', label: '', type: 'shortText', required: false, options: [] },
      delegations: { id: '', roleId: 'recruiter', delegateRoleId: 'hr-head', startsOn: '', endsOn: '' },
      automations: { id: '', name: '', enabled: true, trigger: { event: '' }, conditions: [], actions: [] },
      workforceTargets: { id: '', period: '', departmentId: '', locationId: '', target: 0 },
      'organization.costCentres': { id: '', name: '', code: '', unitId: '' },
      'organization.reportingRelationships': { id: '', userId: '', managerId: '', effectiveFrom: '' },
    }
    const sample = list[0] || templates[path] || { id: `${pathParts(path).at(-1)}-${Date.now()}`, name: '', label: '', description: '', enabled: true, required: false, order: list.length + 1 }
    const fresh = emptyLike(sample)
    if (fresh.id !== undefined) fresh.id = `${pathParts(path).at(-1)}-${Date.now()}`
    if (fresh[keyName] !== undefined) fresh[keyName] = ''
    if (fresh.label !== undefined) fresh.label = ''
    if (fresh.enabled !== undefined) fresh.enabled = true
    if (fresh.order !== undefined) fresh.order = list.length + 1
    const next = [...list, fresh]
    onChange(path, next)
    setExpanded(next.length - 1)
  }
  const patchItem = (index, childPath, childValue) => {
    const next = clone(list)
    const relative = childPath.slice(path.length + 1).split('.')
    let cursor = next[index]
    relative.slice(0, -1).forEach((key) => { cursor[key] ||= {}; cursor = cursor[key] })
    cursor[relative.at(-1)] = childValue
    onChange(path, next)
  }
  return <section className="ats-setting-collection"><div className="ats-setting-collection-head"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div><button className="ats-button ats-button--subtle" type="button" onClick={createItem}><Plus size={15} /> Add {title.replace(/s$/, '')}</button></div>
    {list.length === 0 ? <div className="ats-setting-empty">Nothing configured yet. Add your first {title.toLowerCase().replace(/s$/, '')} to make this part of the ATS yours.</div> : <div className="ats-setting-list">{list.map((item, index) => {
      const name = item?.[keyName] || item?.label || item?.title || item?.id || `${title.slice(0, -1)} ${index + 1}`
      const open = expanded === index
      return <article className={`ats-setting-row ${open ? 'is-open' : ''}`} key={item?.id || `${path}-${index}`}><div className="ats-setting-row-summary"><button type="button" className="ats-setting-row-title" onClick={() => setExpanded(open ? null : index)} aria-expanded={open}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span><strong>{name}</strong><small>{item?.description || item?.helpText || `${Object.keys(item || {}).length} configurable properties`}</small></span></button><div className="ats-setting-row-actions"><button type="button" className="ats-icon-button" title="Move up" aria-label={`Move ${name} up`} disabled={!index} onClick={() => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(path, next) }}><ArrowUp size={14} /></button><button type="button" className="ats-icon-button" title="Move down" aria-label={`Move ${name} down`} disabled={index === list.length - 1} onClick={() => { const next = [...list]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(path, next) }}><ArrowDown size={14} /></button><button type="button" className="ats-icon-button danger" title="Remove" aria-label={`Remove ${name}`} onClick={() => { onChange(path, list.filter((_, itemIndex) => itemIndex !== index)); setExpanded(null) }}><Trash2 size={14} /></button></div></div>{open && <div className="ats-setting-row-editor"><ObjectFields value={item} path={`${path}.${index}`} onChange={(childPath, childValue) => patchItem(index, childPath, childValue)} omit={['id', 'createdAt', 'updatedAt']} />{Object.entries(item || {}).filter(([, child]) => Array.isArray(child) && child.length > 0 && child.some((value) => value && typeof value === 'object')).map(([key, values]) => <CollectionEditor key={key} title={humanize(key)} items={values} path={`${path}.${index}.${key}`} onChange={(childPath, childValue) => patchItem(index, childPath, childValue)} />)}</div>}</article>
    })}</div>}</section>
}

const SECTION_FIELDS = {
  organization: { company: 'company', structure: 'organization' }, access: { roles: 'roles', users: 'users' }, sensitiveData: { roles: 'roles', documents: 'documents', privacy: 'privacy' },
  hiring: { requests: 'requisitions' }, jobs: { employmentTypes: 'employmentTypes', templates: 'jobTemplates', customFields: 'customFields.jobs' },
  pipelines: { pipelines: 'pipelines' }, applications: { forms: 'applicationForms' }, candidates: { fields: 'customFields.candidates', taxonomy: 'taxonomies', documents: 'documents' },
  ownership: { users: 'users', organization: 'organization' }, interviews: { interviews: 'interviews', plans: 'interviewPlans' }, scorecards: { scorecards: 'scorecards', interviewPlans: 'interviewPlans' }, approvals: { workflows: 'approvalWorkflows', delegations: 'delegations' },
  onboarding: { templates: 'onboardingTemplates', documents: 'documents' }, communications: { templates: 'communicationTemplates' }, automation: { rules: 'automations' }, careers: { modules: 'modules', forms: 'applicationForms', sources: 'sources', privacy: 'privacy', branding: 'branding', presentation: 'careers' },
  talent: { views: 'savedViews', taxonomy: 'taxonomies', sources: 'sources' }, collaboration: { documents: 'documents', audit: 'audit' },
  reporting: { targets: 'workforceTargets', sla: 'sla' }, data: { settings: 'data', documents: 'documents' }, privacy: { privacy: 'privacy' }, agency: { workflows: 'agency', pipeline: 'pipelines', sources: 'sources' }, workforce: { targets: 'workforceTargets' },
}
function sectionContent(config, section) {
  if (section.id === 'organization') return { company: config.company || {}, structure: config.organization || {} }
  if (section.id === 'regional') return config.regional || {}
  if (section.id === 'terminology') return config.terminology || {}
  if (section.id === 'modules') return config.modules || {}
  // Legacy configs stored retentionDays under data. Keep that imported value
  // editable only when the canonical privacy field is not configured.
  if (section.id === 'data') {
    const { retentionDays, ...settings } = config.data || {}
    return { settings, documents: config.documents, ...(config.privacy?.retentionDays == null && retentionDays != null ? { retentionDays } : {}) }
  }
  if (section.id === 'privacy' && config.privacy?.retentionDays == null && config.data?.retentionDays != null) {
    return { privacy: config.privacy || {}, retentionDays: config.data.retentionDays }
  }
  const mapped = SECTION_FIELDS[section.id]
  if (mapped) return Object.fromEntries(Object.entries(mapped).map(([key, path]) => [key, getAt(config, path)]).filter(([, value]) => value !== undefined))
  return getAt(config, section.path) || {}
}
function canonicalPath(sectionId, localPath) {
  const sectionPath = SECTIONS.find((section) => section.id === sectionId)?.path
  return resolveConfigPath(sectionId, sectionPath, SECTION_FIELDS[sectionId], localPath)
}

function sectionCollections(section, value = {}) {
  const list = Object.entries(value).filter(([, child]) => Array.isArray(child) && (child.length === 0 || child.every((item) => item && typeof item === 'object')))
  const preferred = {
    organization: ['legalEntities', 'businessUnits', 'divisions', 'departments', 'teams', 'offices', 'locations', 'costCentres', 'reportingLines'],
    access: ['users', 'roles', 'permissionMatrix'], hiring: ['requestFields', 'approvers'], jobs: ['employmentTypes', 'fields', 'templates'],
    pipelines: ['items', 'pipelines', 'rules', 'defaultRules'], applications: ['forms', 'screeningQuestions'], candidates: ['profileSections', 'customFields', 'tags', 'statuses', 'sources', 'documentCategories'],
    ownership: ['rules', 'teams', 'backups'], interviews: ['types', 'rounds', 'reminders'], scorecards: ['templates', 'ratingScales', 'recommendations'],
    approvals: ['workflows', 'delegation', 'thresholds'], offers: ['templates', 'compensationComponents', 'approvalWorkflow'], onboarding: ['templates', 'checklist'],
    communications: ['templates', 'languages'], automation: ['rules'], tasks: ['types', 'slaRules'], notifications: ['events'], careers: ['filters', 'categories'],
    referrals: ['rewards', 'milestones'], talent: ['pools', 'savedSearches'], reporting: ['dashboard', 'hiringTargets', 'metrics'], data: ['importMappings', 'duplicateRules'], privacy: ['retentionRules'], audit: ['trackedEvents'],
    integrations: ['providers'], agency: ['clients', 'clientContacts', 'mandates', 'submissionStatuses', 'feeTypes', 'guarantees'], workforce: ['targets', 'periods'], collaboration: ['timelineEvents'],
  }[section.id] || []
  return [...new Set([...preferred.filter((key) => Array.isArray(value[key])), ...list.map(([key]) => key)])]
}

export default function Settings({ config: initialConfig, activeVersion: initialActiveVersion, onActivated, onDirtyChange }) {
  const [config, setConfig] = useState(() => normalizeConfig(initialConfig))
  const [activeConfig, setActiveConfig] = useState(() => normalizeConfig(initialConfig))
  const [baseline, setBaseline] = useState(() => normalizeConfig(initialConfig))
  const [activeSection, setActiveSection] = useState('organization')
  const [query, setQuery] = useState('')
  const [validation, setValidation] = useState({ errors: [], warnings: [] })
  const [history, setHistory] = useState([])
  const [activeVersion, setActiveVersion] = useState(Number(initialActiveVersion ?? initialConfig?.version) || 1)
  const [presets, setPresets] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [presetId, setPresetId] = useState('')
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [duplicateName, setDuplicateName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedInstance, setGeneratedInstance] = useState(null)
  const [retentionPreview, setRetentionPreview] = useState(null)
  const [retentionBusy, setRetentionBusy] = useState(false)
  const [retentionError, setRetentionError] = useState('')
  const [retentionAccessDenied, setRetentionAccessDenied] = useState(false)
  const [retentionSelectedIds, setRetentionSelectedIds] = useState([])
  const [retentionDryRun, setRetentionDryRun] = useState(true)
  const [retentionConfirm, setRetentionConfirm] = useState(false)
  const [retentionResult, setRetentionResult] = useState(null)
  const fileRef = useRef(null)
  const currentSection = SECTIONS.find((section) => section.id === activeSection) || SECTIONS[0]
  const currentValue = sectionContent(config, currentSection)
  const hasCanonicalRetention = config.privacy?.retentionDays != null
  const hasLegacyRetention = config.data?.retentionDays != null
  const modified = useMemo(() => JSON.stringify(config) !== JSON.stringify(baseline), [config, baseline])
  const activeDiff = useMemo(() => getConfigDiff(activeConfig, config), [activeConfig, config])
  const moduleWarnings = useMemo(() => getDisabledModuleWarnings(activeConfig, config), [activeConfig, config])
  const groupedSections = useMemo(() => {
    const queryValue = query.trim().toLowerCase()
    const filtered = SECTIONS.filter((section) => !queryValue || `${section.label} ${section.group} ${section.desc}`.toLowerCase().includes(queryValue))
    return [...new Set(filtered.map((section) => section.group))].map((group) => ({ group, items: filtered.filter((section) => section.group === group) }))
  }, [query])

  const refreshHistory = useCallback(async () => {
    try {
      const result = await platformRequest('/config/history')
      const rows = Array.isArray(result) ? result : result?.history || []
      setHistory(rows)
    } catch { /* the settings form remains usable when history is empty */ }
  }, [])
  useEffect(() => {
    let alive = true
    setBusy(true)
    Promise.allSettled([platformRequest('/config/draft'), platformRequest('/config/presets')]).then(([draftResult, presetResult]) => {
      if (!alive) return
      if (draftResult.status === 'fulfilled') {
        const draft = draftResult.value?.config || draftResult.value
        if (draft && typeof draft === 'object') { setConfig(normalizeConfig(draft)); setBaseline(normalizeConfig(draft)) }
      }
      if (presetResult.status === 'fulfilled') setPresets(Array.isArray(presetResult.value) ? presetResult.value : presetResult.value?.presets || [])
      setBusy(false)
    })
    refreshHistory()
    return () => { alive = false }
  }, [refreshHistory])

  useEffect(() => {
    onDirtyChange?.(modified)
  }, [modified, onDirtyChange])
  useEffect(() => {
    if (initialActiveVersion != null) setActiveVersion(Number(initialActiveVersion))
  }, [initialActiveVersion])
  useEffect(() => {
    if (!modified) return undefined
    const warnBeforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [modified])

  const updatePath = useCallback((path, value) => {
    setConfig((current) => setAt(current, path, value))
    setError('')
    setStatus('Unsaved changes')
  }, [])
  const updateSectionPath = useCallback((path, value) => {
    const target = canonicalPath(activeSection, path)
    setConfig((current) => setAt(current, target, value))
    setError('')
    setStatus('Unsaved changes')
  }, [activeSection])

  const saveDraft = async () => {
    setBusy(true); setError(''); setStatus('')
    try {
      const result = await platformRequest('/config/draft', { method: 'PUT', body: { data: config } })
      const payload = result?.config ? result : { config: result }
      const normalized = normalizeConfig(payload.config || config)
      setConfig(normalized); setBaseline(normalized); setSavedAt(new Date())
      setValidation(payload.validation || { errors: [], warnings: [] }); setStatus('Draft saved')
    } catch (requestError) {
      const details = requestError.details
      setValidation({ errors: Array.isArray(details) ? details : details?.errors || [], warnings: details?.warnings || [] })
      setError(requestError.message || 'Could not save this draft.')
    } finally { setBusy(false) }
  }
  const validateAndReview = async () => {
    setReviewAcknowledged(false)
    setError('')
    setBusy(true)
    try {
      const localValidation = await platformRequest('/config/validate', { method: 'POST', body: { data: config } })
      setValidation(localValidation)
      if (!localValidation?.valid) { setReviewOpen(true); return }
      const result = await platformRequest('/config/draft', { method: 'PUT', body: { data: config } })
      const payload = result?.config ? result : { config: result }
      if (payload.config) { const normalized = normalizeConfig(payload.config); setConfig(normalized); setBaseline(normalized); setSavedAt(new Date()) }
      setReviewOpen(true)
    } catch (requestError) {
      const details = requestError.details
      setValidation({ valid: false, errors: Array.isArray(details) ? details : details?.errors || [requestError.message], warnings: details?.warnings || [] })
      setReviewOpen(true)
    } finally { setBusy(false) }
  }
  const activateConfig = async () => {
    const warnings = getDisabledModuleWarnings(activeConfig, config)
    if (warnings.length && !window.confirm(`This change disables ${warnings.map((warning) => warning.name).join(', ')}. Existing records stay stored, but the related screens and new actions will be unavailable. Continue to activation?`)) return
    setBusy(true); setError('')
    try {
      const result = await platformRequest('/config/activate', { method: 'POST', body: { data: { note: `Activated from Settings on ${new Date().toLocaleDateString()}`, expectedDraft: config, expectedVersion: activeVersion } } })
      const activated = normalizeConfig(result?.config || config)
      if (result?.version != null) setActiveVersion(Number(result.version))
      setConfig(activated); setBaseline(activated); setActiveConfig(activated); setReviewOpen(false); setStatus(`Configuration v${result?.version || getSchemaVersion(activated)} activated`)
      await refreshHistory(); onActivated?.(activated)
    } catch (requestError) { setError(requestError.message || 'Could not activate this configuration.') } finally { setBusy(false) }
  }
  const loadPreset = async (id) => {
    if (!id) return
    if (!window.confirm('Loading a preset replaces the current draft configuration in this form, including any changes already saved to the draft. Continue?')) return
    setBusy(true); setError('')
    try {
      const listedPresets = presets.length ? presets : await platformRequest('/config/presets').then((result) => result?.presets || result || [])
      const selectedPreset = listedPresets.find((preset) => preset.id === id)
      if (!selectedPreset?.config) throw new Error('This preset is not available from the configuration service.')
      const presetConfig = normalizeConfig(selectedPreset.config)
      setConfig(presetConfig); setPresetId(id); setStatus('Preset loaded. Review it and save when ready.')
    } catch (requestError) { setError(requestError.message || 'Could not load preset.') } finally { setBusy(false) }
  }
  const resetSection = () => {
    const paths = currentSection.id === 'organization' ? ['company', 'organization'] : SECTION_FIELDS[currentSection.id] ? Object.values(SECTION_FIELDS[currentSection.id]) : [currentSection.path]
    setConfig((current) => paths.reduce((next, path) => setAt(next, path, clone(getAt(baseline, path) ?? {})), current))
    setStatus(`${currentSection.label} restored from the saved configuration`)
  }
  const resetAll = () => {
    if (!window.confirm('Reset all configuration changes to the last saved draft?')) return
    setConfig(clone(baseline)); setStatus('All changes reverted to the saved draft'); setValidation({ errors: [], warnings: [] })
  }
  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${config.slug || config.company?.slug || 'ats-company'}-config-v${getSchemaVersion(config)}.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  const importConfig = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try { const parsed = JSON.parse(await file.text()); const imported = normalizeConfig(parsed); setConfig(imported); setStatus('Configuration imported. Save and validate before activation.'); setError('') }
    catch { setError('This file is not valid configuration JSON. No changes were applied.') }
    event.target.value = ''
  }
  const duplicateConfig = () => {
    const name = duplicateName.trim()
    if (!name) return
    const next = clone(config)
    next.company ||= {}
    next.company.name = name
    next.company.legalName = next.company.legalName || name
    next.company.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    next.configurationName = `${name} configuration`
    setConfig(next); setDuplicateOpen(false); setDuplicateName(''); setStatus('Copied these settings into the current company draft. Save and validate before activation; this does not create a separate workspace.')
  }
  const rollback = async (version) => {
    if (!window.confirm(`Restore configuration version ${version}? This replaces company settings and the current draft, including unsaved edits, and creates a new active version. Operational records are kept.`)) return
    setBusy(true); setError('')
    try {
      const result = await platformRequest('/config/rollback', { method: 'POST', body: { data: { version, expectedVersion: activeVersion } } })
      const restored = normalizeConfig(result?.config || result)
      setConfig(restored); setBaseline(restored); setActiveConfig(restored); setHistoryOpen(false); setStatus(`Rolled back from v${version}`); await refreshHistory(); onActivated?.(restored)
    } catch (requestError) { setError(requestError.message || 'Could not restore that version.') } finally { setBusy(false) }
  }
  const generateInstance = async () => {
    setGenerating(true); setError(''); setGeneratedInstance(null)
    try {
      const validateResponse = await fetch('http://127.0.0.1:4177/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })
      const validationResult = await validateResponse.json()
      if (!validateResponse.ok) throw new Error(validationResult.error || 'Configuration validation failed.')
      setValidation(validationResult)
      if (!validationResult.valid) { setReviewOpen(true); throw new Error('Fix the configuration issues before generating an instance.') }
      const response = await fetch('http://127.0.0.1:4177/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Instance generation failed.')
      setGeneratedInstance(result)
      setStatus(`Generated ${result.slug} as an independent local ATS workspace.`)
    } catch (requestError) { setError(requestError.message || 'Could not generate the ATS instance.') } finally { setGenerating(false) }
  }

  const loadRetentionPreview = async () => {
    setRetentionBusy(true)
    setRetentionError('')
    setRetentionResult(null)
    try {
      const result = await platformRequest('/retention/preview')
      setRetentionPreview(result)
      setRetentionAccessDenied(false)
      const eligibleIds = (result.items || []).filter((item) => item.status === 'eligible').map((item) => item.candidateId)
      setRetentionSelectedIds((selected) => selected.filter((id) => eligibleIds.includes(id)))
    } catch (requestError) {
      setRetentionAccessDenied(requestError.status === 403)
      setRetentionError(requestError.status === 403
        ? 'Your current role does not have permission to review candidate retention.'
        : requestError.message || 'Retention preview is currently unavailable.')
    } finally {
      setRetentionBusy(false)
    }
  }

  const processRetention = async () => {
    if (!retentionPreview || retentionAccessDenied || retentionBusy || !retentionSelectedIds.length) return
    if (!retentionDryRun && !retentionConfirm) return
    setRetentionBusy(true)
    setRetentionError('')
    setRetentionResult(null)
    try {
      const result = await platformRequest('/retention/process', {
        method: 'POST',
        body: { data: { dryRun: retentionDryRun, candidateIds: retentionSelectedIds, batchSize: Math.min(retentionSelectedIds.length, 100) } },
      })
      setRetentionResult(result)
      setRetentionConfirm(false)
      if (!retentionDryRun) await loadRetentionPreview()
    } catch (requestError) {
      setRetentionAccessDenied(requestError.status === 403)
      setRetentionError(requestError.status === 403
        ? 'Your role does not have permission to process these retention actions.'
        : requestError.message || 'Retention processing failed.')
    } finally {
      setRetentionBusy(false)
    }
  }

  const sectionObject = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) ? currentValue : {}
  const scalarEntries = Object.entries(sectionObject).filter(([, value]) => !Array.isArray(value) && (!value || typeof value !== 'object'))
  const nestedEntries = Object.entries(sectionObject).filter(([key, value]) => value && typeof value === 'object' && !Array.isArray(value) && !['users', 'roles'].includes(key))
  const collections = sectionCollections(currentSection, sectionObject)
  const isDisabledModule = currentSection.module && config.modules?.[currentSection.module] === false
  const requiredSections = SECTIONS.filter((section) => section.required)
  const completion = requiredSections.reduce((total, section) => total + (sectionContent(config, section) && Object.keys(sectionContent(config, section)).length ? 1 : 0), 0)

  return <main className="ats-settings" aria-label="Company configuration settings">
    <div className="ats-settings-header"><div><div className="ats-settings-eyebrow"><Settings2 size={14} /> Workspace configuration</div><h1>Configure your ATS</h1><p>Set up hiring to fit your organization. Changes stay in draft until you validate and activate them.</p></div><div className="ats-settings-header-actions"><span className="ats-settings-version">Schema v{getSchemaVersion(config)}</span>{BUILDER_AVAILABLE && <button type="button" className="ats-button ats-button--secondary" onClick={generateInstance} disabled={generating}><PackagePlus size={15} /> {generating ? 'Generating…' : 'Generate instance'}</button>}<button type="button" className="ats-button ats-button--secondary" onClick={() => setHistoryOpen(true)}><History size={15} /> Version history</button><button type="button" className="ats-button ats-button--primary" onClick={validateAndReview} disabled={busy}><ShieldCheck size={15} /> Review & activate</button></div></div>
    {error && <div className="ats-settings-alert is-error" role="alert"><AlertTriangle size={17} />{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
    {status && <div className="ats-settings-alert is-success" role="status"><Check size={16} />{status}{savedAt && <small> · Saved {savedAt.toLocaleTimeString()}</small>}</div>}
    {generatedInstance && <div className="ats-settings-generated" role="status"><div><strong>{generatedInstance.slug} is ready</strong><span>{generatedInstance.outputDirectory || generatedInstance.slug} · includes its own configuration and SQLite store</span></div><a className="ats-button ats-button--secondary" href={`http://127.0.0.1:4177${generatedInstance.archiveUrl}`}><Download size={14} /> Download workspace</a><a className="ats-generated-open" href={`http://127.0.0.1:4177${generatedInstance.archiveUrl}`} aria-label="Open generated workspace download"><ExternalLink size={15} /></a></div>}
    <div className="ats-settings-workspace">
      <aside className="ats-settings-sidebar" aria-label="Configuration categories"><div className="ats-settings-search"><Search size={16} /><input aria-label="Search settings" placeholder="Search settings" value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="ats-settings-progress"><div className="ats-settings-progress-copy"><strong>Setup progress</strong><span>{completion} / {requiredSections.length} essentials</span></div><div className="ats-settings-progress-track"><span style={{ width: `${completion / requiredSections.length * 100}%` }} /></div></div><nav>{groupedSections.map(({ group, items }) => <div className="ats-settings-nav-group" key={group}><h2>{group}</h2>{items.map((section) => <button type="button" key={section.id} className={`ats-settings-nav-item ${section.id === activeSection ? 'is-active' : ''}`} onClick={() => setActiveSection(section.id)}><span>{section.label}</span>{section.required && <i title="Essential setup" />}</button>)}</div>)}</nav><div className="ats-settings-sidebar-footer"><button type="button" onClick={exportConfig}><Download size={15} /> Export configuration</button><button type="button" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import configuration</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importConfig} /><button type="button" onClick={() => setDuplicateOpen(true)}><FileOutput size={15} /> Copy settings to draft</button></div></aside>
      <section className="ats-settings-panel"><div className="ats-settings-panel-heading"><div><div className="ats-settings-breadcrumb">{currentSection.group}</div><h2>{currentSection.label}</h2><p>{currentSection.desc}</p></div><div className="ats-settings-section-actions"><button type="button" className="ats-button ats-button--subtle" onClick={resetSection}><RotateCcw size={14} /> Reset section</button><button type="button" className="ats-button ats-button--subtle" onClick={resetAll} disabled={!modified}><RotateCcw size={14} /> Reset all</button></div></div>
        {currentSection.id === 'organization' && <div className="ats-settings-callout"><WandSparkles size={17} /><div><strong>Choose a starting point</strong><span>Presets fill in sensible defaults. Every choice remains editable.</span></div><div className="ats-settings-preset-control"><select aria-label="Starting preset" value={presetId} onChange={(event) => loadPreset(event.target.value)}><option value="">Select a preset</option>{(presets.length ? presets : [{ id: 'startup', name: 'Startup' }, { id: 'corporate', name: 'Corporate' }, { id: 'agency', name: 'Recruitment Agency' }, { id: 'campus', name: 'Campus hiring' }, { id: 'basic', name: 'Basic' }]).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></div></div>}
        {isDisabledModule && <div className="ats-settings-callout is-warning"><AlertTriangle size={17} /><div><strong>This module is switched off</strong><span>Enable it in Modules to make its settings available to users.</span></div><button type="button" className="ats-button ats-button--secondary" onClick={() => { setActiveSection('modules'); setQuery('') }}>Open modules</button></div>}
        {currentSection.id === 'modules' && <div className="ats-settings-module-grid">{Object.entries(config.modules || {}).filter(([key]) => !(key === 'publicRoles' && Object.hasOwn(config.modules, 'careers'))).map(([key, enabled]) => <label className="ats-settings-module" key={key}><span className="ats-settings-module-icon"><Settings2 size={17} /></span><span><strong>{humanize(key)}</strong><small>{key === 'agency' ? 'Clients, mandates, placement fees and invoices.' : key === 'careers' || key === 'publicRoles' ? 'Public job listings and application forms.' : `Enable ${humanize(key).toLowerCase()} workflows for this workspace.`}</small></span><input type="checkbox" checked={Boolean(enabled)} onChange={(event) => {
          if (event.target.checked) { updatePath(`modules.${key}`, true); return }
          const next = { ...config, modules: { ...config.modules, [key]: false } }
          const warnings = getDisabledModuleWarnings(config, next)
          if (warnings.length && !window.confirm(`${warnings[0].message}\n\nContinue with this draft change?`)) return
          updatePath(`modules.${key}`, false)
        }} /></label>)}{!Object.keys(config.modules || {}).some((key) => !(key === 'publicRoles' && Object.hasOwn(config.modules, 'careers'))) && <div className="ats-setting-empty">Module defaults will appear here after selecting a preset.</div>}</div>}
        {currentSection.id === 'integrations' && <div className="ats-settings-callout is-warning"><AlertTriangle size={17} /><div><strong>External providers are unavailable in this local workspace</strong><span>Email delivery, calendar sync, job boards, HRIS, payments and e-signature are not connected. Configured providers are placeholders; this ATS uses local/mock adapters where available. No external account or hosted service is required.</span></div></div>}
        {currentSection.id === 'terminology' && <div className="ats-settings-terminology-note">Use singular and plural labels. For example, call a job a “Position” and candidates “Applicants.” The labels are shared across navigation, headings and actions.</div>}
        <div className="ats-settings-section-body">
          {currentSection.id === 'data' && hasCanonicalRetention && hasLegacyRetention && <div className="ats-settings-callout ats-settings-legacy-note"><ShieldCheck size={17} /><div><strong>Retention is managed in Privacy &amp; retention</strong><span>The legacy Data Administration value ({config.data.retentionDays} days) is preserved in this configuration but is not active. Update the canonical retention period in Privacy &amp; retention.</span></div><button type="button" className="ats-button ats-button--secondary" onClick={() => setActiveSection('privacy')}>Open Privacy</button></div>}
          {['privacy', 'data'].includes(currentSection.id) && <section className="ats-retention-preview" aria-labelledby="ats-retention-preview-title">
            <div className="ats-retention-preview-heading">
              <div><h3 id="ats-retention-preview-title">Retention review</h3><p>Preview candidate records against the configured retention period.</p></div>
              <button type="button" className="ats-button ats-button--secondary" onClick={loadRetentionPreview} disabled={retentionBusy}>
                <Clock3 size={15} /> {retentionBusy ? 'Loading preview…' : retentionPreview ? 'Refresh preview' : 'Load preview'}
              </button>
            </div>
            <div className="ats-retention-preview-notice" role="note"><ShieldCheck size={16} /><span><strong>Governed processing.</strong> Preview is read-only. Dry run is selected by default; actual processing requires permission and explicit confirmation.</span></div>
            {retentionError && <p className="ats-retention-preview-error" role="alert">{retentionError}</p>}
            {retentionAccessDenied && <p className="ats-retention-preview-error" role="status">Retention actions are disabled because your role lacks the required permission.</p>}
            {retentionPreview && <>
              <div className="ats-retention-preview-meta"><span>Retention period: <strong>{retentionPreview.retentionDays} days</strong></span><span>Cutoff: <strong>{formatRegionalDate(retentionPreview.cutoff, config.regional)}</strong></span><span>Generated: <strong>{formatRegionalDate(retentionPreview.generatedAt, config.regional)}</strong></span></div>
              <div className="ats-retention-preview-summary" aria-label="Retention preview summary">
                <span><strong>{retentionPreview.summary?.candidateCount ?? 0}</strong><small>Records reviewed</small></span>
                <span><strong>{retentionPreview.summary?.eligibleCount ?? 0}</strong><small>Eligible after checks</small></span>
                <span><strong>{retentionPreview.summary?.approvalRequiredCount ?? 0}</strong><small>Approval required</small></span>
                <span><strong>{retentionPreview.summary?.awaitingApprovalCount ?? 0}</strong><small>Awaiting approval</small></span>
                <span><strong>{retentionPreview.summary?.blockedActiveApplicationCount ?? 0}</strong><small>Active application</small></span>
                <span><strong>{retentionPreview.summary?.retainedCount ?? 0}</strong><small>Retained</small></span>
              </div>
              {retentionPreview.items?.length ? <div className="ats-retention-preview-table-wrap"><table className="ats-retention-preview-table"><thead><tr><th scope="col">Select</th><th scope="col">Record</th><th scope="col">Last activity</th><th scope="col">Status</th><th scope="col">Recommended next step</th><th scope="col">Review note</th></tr></thead><tbody>{retentionPreview.items.map((item) => { const eligible = item.status === 'eligible'; return <tr key={item.candidateId}><td>{eligible && <input type="checkbox" aria-label={`Select candidate ${item.candidateId}`} checked={retentionSelectedIds.includes(item.candidateId)} disabled={retentionBusy || retentionAccessDenied} onChange={(event) => setRetentionSelectedIds((ids) => event.target.checked ? [...ids, item.candidateId] : ids.filter((id) => id !== item.candidateId))} />}</td><td>{item.candidateId}</td><td>{formatRegionalDate(item.lastActivityAt, config.regional)}</td><td><span className={`ats-retention-status is-${String(item.status || 'unknown').replace(/[^a-z0-9]+/gi, '-')}`}>{humanize(item.status || 'unknown')}</span></td><td>{humanize(item.recommendedAction || 'review')}</td><td>{item.reason}</td></tr> })}</tbody></table></div> : <div className="ats-setting-empty">No candidate records currently need retention review.</div>}
              <div className="ats-retention-controls">
                <label><input type="checkbox" checked={retentionSelectedIds.length > 0 && retentionSelectedIds.length === (retentionPreview.items || []).filter((item) => item.status === 'eligible').length} disabled={retentionBusy || retentionAccessDenied || !(retentionPreview.items || []).some((item) => item.status === 'eligible')} onChange={(event) => setRetentionSelectedIds(event.target.checked ? (retentionPreview.items || []).filter((item) => item.status === 'eligible').map((item) => item.candidateId) : [])} /> Select all eligible records</label>
                <label><input type="checkbox" checked={retentionDryRun} disabled={retentionBusy || retentionAccessDenied} onChange={(event) => { setRetentionDryRun(event.target.checked); setRetentionConfirm(false); setRetentionResult(null) }} /> Dry run (no records changed)</label>
                {!retentionDryRun && <label className="ats-retention-confirm"><input type="checkbox" checked={retentionConfirm} disabled={retentionBusy || retentionAccessDenied} onChange={(event) => setRetentionConfirm(event.target.checked)} /> I confirm processing {retentionSelectedIds.length} selected candidate record(s).</label>}
                <button type="button" className={`ats-button ${retentionDryRun ? 'ats-button--secondary' : 'ats-button--primary'}`} onClick={processRetention} disabled={retentionBusy || retentionAccessDenied || !retentionSelectedIds.length || (!retentionDryRun && !retentionConfirm)}><ShieldCheck size={15} /> {retentionBusy ? 'Processing…' : retentionDryRun ? 'Run dry run' : 'Process selected records'}</button>
              </div>
              {retentionResult && <div className="ats-retention-result" role="status"><strong>{retentionResult.dryRun ? 'Dry run complete' : 'Retention processing complete'}</strong><span>{retentionResult.selectedCount ?? retentionResult.processed?.length ?? 0} selected · {(retentionResult.processed || []).length} processed</span>{(retentionResult.results?.length || retentionResult.plan?.items?.length) > 0 && <ul>{(retentionResult.results || retentionResult.plan?.items || []).map((item) => <li key={item.candidateId || item.id}>{item.candidateId || item.id}: {humanize(item.action || item.retentionAction || item.status || 'planned')}</li>)}</ul>}</div>}
            </>}
          </section>}
          {scalarEntries.length > 0 && currentSection.id !== 'modules' && <div className="ats-setting-fields">{scalarEntries.map(([key, value]) => {
            const localPath = currentSection.id === 'organization' ? `${['name', 'slug', 'legalName', 'website', 'supportEmail'].includes(key) ? 'company' : 'structure'}.${key}` : key
            const target = canonicalPath(currentSection.id, localPath)
            return <ScalarControl key={key} path={target} label={FIELD_META[key]?.label || humanize(key)} value={value} help={FIELD_META[key]?.help} required={FIELD_META[key]?.required} onChange={(next) => updateSectionPath(localPath, next)} />
          })}</div>}
          {nestedEntries.map(([key, child]) => <fieldset className="ats-setting-subgroup" key={key}><legend>{humanize(key)}</legend><ObjectFields value={child} path={canonicalPath(currentSection.id, key)} onChange={updateSectionPath} /></fieldset>)}
          {collections.filter((key) => Array.isArray(sectionObject[key])).map((key) => <CollectionEditor key={key} title={humanize(key)} items={sectionObject[key]} path={canonicalPath(currentSection.id, key)} onChange={updateSectionPath} hint={key === 'pipelines' ? 'Stages and allowed transitions are applied to candidate movement.' : undefined} />)}
          {currentSection.id === 'terminology' && Object.entries(sectionObject).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)).map(([key, value]) => <fieldset className="ats-setting-subgroup ats-terminology-group" key={key}><legend>{humanize(key)}</legend><div className="ats-setting-fields">{['singular', 'plural'].filter((label) => value[label] !== undefined).map((label) => <ScalarControl key={label} path={`terminology.${key}.${label}`} label={humanize(label)} value={value[label]} onChange={(next) => updateSectionPath(`terminology.${key}.${label}`, next)} />)}</div></fieldset>)}
          {scalarEntries.length === 0 && nestedEntries.length === 0 && collections.length === 0 && currentSection.id !== 'modules' && <div className="ats-settings-empty-state"><span><Settings2 size={21} /></span><h3>Start configuring {currentSection.label.toLowerCase()}</h3><p>Use a preset to add starter settings, or create your first item below.</p>{currentSection.id === 'agency' && <p>Agency controls appear only when the agency module is enabled.</p>}</div>}
        </div>
        <div className="ats-settings-panel-footer"><div className="ats-settings-draft-indicator"><span className={modified ? 'is-dirty' : 'is-clean'} />{modified ? 'Unsaved draft changes' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : 'No unsaved changes'}</div><button type="button" className="ats-button ats-button--secondary" onClick={saveDraft} disabled={busy || !modified}><Save size={15} /> Save draft</button></div>
      </section>
    </div>

    {reviewOpen && <div className="ats-settings-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReviewOpen(false)}><section className="ats-settings-modal" role="dialog" aria-modal="true" aria-labelledby="ats-review-title"><header><div><span className="ats-settings-modal-icon"><ShieldCheck size={19} /></span><div><h2 id="ats-review-title">Review configuration</h2><p>Validate the draft before making it active for this ATS.</p></div></div><button className="ats-icon-button" type="button" aria-label="Close review" onClick={() => setReviewOpen(false)}><X size={17} /></button></header><div className="ats-settings-modal-body"><div className="ats-review-summary"><span><strong>{config.company?.displayName || config.organization?.name || 'Your company'}</strong><small>Company workspace</small></span><span><strong>{Object.values(config.modules || {}).filter(Boolean).length}</strong><small>Enabled modules</small></span><span><strong>{getSchemaVersion(config)}</strong><small>Schema version</small></span></div>{validation.errors?.length > 0 && <div className="ats-review-messages is-error"><h3><AlertTriangle size={16} /> Fix these issues before activation</h3>{validation.errors.map((item, index) => <p key={index}>{typeof item === 'string' ? item : item.message || item.path && `${item.path}: ${item.message}` || JSON.stringify(item)}</p>)}</div>}{validation.warnings?.length > 0 && <div className="ats-review-messages is-warning"><h3><AlertTriangle size={16} /> Review these recommendations</h3>{validation.warnings.map((item, index) => <p key={index}>{typeof item === 'string' ? item : item.message || item.path && `${item.path}: ${item.message}` || JSON.stringify(item)}</p>)}</div>}{!validation.errors?.length && !validation.warnings?.length && <div className="ats-review-messages is-success"><Check size={16} /> Configuration is valid and ready to activate.</div>}
        <section className="ats-review-diff" aria-label="Active configuration changes"><h3>Active configuration → draft</h3>{activeDiff.length ? <ul>{activeDiff.map((change) => <li key={change.path}><strong>{change.label}</strong><span><del>{change.before}</del><b aria-hidden="true">→</b><ins>{change.after}</ins></span></li>)}</ul> : <p>The draft matches the active configuration.</p>}{activeDiff.length === 60 && <small>Showing the first 60 changes.</small>}</section>
        {moduleWarnings.length > 0 && <div className="ats-review-messages is-warning"><h3><AlertTriangle size={16} /> Module changes affect existing workflows</h3>{moduleWarnings.map((warning) => <p key={warning.module}>{warning.message}</p>)}</div>}
        <div className="ats-review-checklist"><h3>Before you activate</h3><p>Users will see enabled modules and configured terminology. Workflow rules and permissions will apply to new actions.</p><label><input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} /> I reviewed this company configuration</label></div></div><footer><button type="button" className="ats-button ats-button--subtle" onClick={() => setReviewOpen(false)}>Continue editing</button><button type="button" className="ats-button ats-button--primary" onClick={activateConfig} disabled={busy || validation.errors?.length > 0 || !reviewAcknowledged}><Check size={15} /> Activate configuration</button></footer></section></div>}

    {historyOpen && <div className="ats-settings-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setHistoryOpen(false)}><section className="ats-settings-modal ats-settings-history" role="dialog" aria-modal="true" aria-labelledby="ats-history-title"><header><div><span className="ats-settings-modal-icon"><History size={19} /></span><div><h2 id="ats-history-title">Configuration history</h2><p>Review active versions and restore an earlier configuration.</p></div></div><button className="ats-icon-button" type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)}><X size={17} /></button></header><div className="ats-settings-modal-body">{history.length ? history.map((entry) => <article className="ats-history-entry" key={entry.version}><span className="ats-history-marker"><Clock3 size={15} /></span><div><strong>Version {entry.version}{entry.active ? ' · Active' : ''}</strong><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Timestamp unavailable'} · {entry.actorId || 'Local administrator'}</small>{entry.note && <p>{entry.note}</p>}</div><button type="button" className="ats-button ats-button--subtle" disabled={busy || entry.active} onClick={() => rollback(entry.version)}><RotateCcw size={14} /> Restore</button></article>) : <div className="ats-setting-empty">No active configuration versions yet. Activate a validated draft to create the first version.</div>}</div><footer><button type="button" className="ats-button ats-button--secondary" onClick={() => setHistoryOpen(false)}>Close</button></footer></section></div>}

    {duplicateOpen && <div className="ats-settings-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDuplicateOpen(false)}><section className="ats-settings-modal ats-settings-duplicate" role="dialog" aria-modal="true" aria-labelledby="ats-duplicate-title"><header><div><span className="ats-settings-modal-icon"><FileInput size={19} /></span><div><h2 id="ats-duplicate-title">Copy settings into this draft</h2><p>Start the current company draft from these settings.</p></div></div><button className="ats-icon-button" type="button" aria-label="Close duplicate dialog" onClick={() => setDuplicateOpen(false)}><X size={17} /></button></header><div className="ats-settings-modal-body"><label className="ats-setting-control"><span>Company name for the draft</span><input autoFocus value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} placeholder="e.g. Northstar Labs" /></label><p className="ats-settings-help">This changes the current company draft; it does not create another workspace. Your active configuration changes only after you save and activate this draft.</p></div><footer><button type="button" className="ats-button ats-button--subtle" onClick={() => setDuplicateOpen(false)}>Cancel</button><button type="button" className="ats-button ats-button--primary" onClick={duplicateConfig} disabled={!duplicateName.trim()}><Plus size={15} /> Copy to current draft</button></footer></section></div>}
  </main>
}
