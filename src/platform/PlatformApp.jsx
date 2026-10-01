import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, Archive, ArrowDown, ArrowLeft, ArrowRight, Bell, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Download, FileText, Filter, Globe2, LayoutDashboard, LogOut, Menu, MoreHorizontal, Plus, Search, Settings2, Shield, Sparkles, Users, X } from 'lucide-react'
import { platformApi, platformRequest } from './api'
import { ConfiguredFields, FieldControl } from './fields'
import { humanize } from './utils'
import { formatRegionalDate, formatRegionalDateTime } from './regional-format'
import { fromInterviewISO, toInterviewISO } from './interview-datetime'
import Settings from './Settings'
import './PlatformApp.css'

const ENTITIES = {
  requisitions: { label: 'Hiring requests', singular: 'Hiring request', icon: ClipboardCheck, fields: [['title','shortText',true],['departmentId','singleSelect',true],['locationId','singleSelect',true],['headcount','number',true],['justification','longText',true],['employmentType','singleSelect',true],['urgency','singleSelect',true,['Normal','Urgent']],['budget','number'],['targetDate','date'],['salaryBand','shortText']], actions: ['approve','reject','create-job'] },
  jobs: { label: 'Jobs', singular: 'Job', icon: BriefcaseBusiness, fields: [['title','shortText',true],['department','shortText'],['team','shortText'],['location','shortText'],['employmentType','singleSelect',true],['openings','number'],['hiringManagerId','singleSelect'],['recruiterId','singleSelect'],['pipelineId','singleSelect'],['description','longText'],['requirements','longText'],['benefits','longText'],['salaryBand','shortText'],['currency','shortText'],['targetDate','date']], actions: ['publish'] },
  candidates: { label: 'Candidates', singular: 'Candidate', icon: Users, fields: [['firstName','shortText',true],['lastName','shortText',true],['email','email',true],['phone','phone'],['location','shortText'],['currentTitle','shortText'],['skills','longText'],['source','shortText'],['salaryExpectation','currency'],['noticePeriod','shortText'],['linkedin','url'],['portfolio','url'],['consentStatus','singleSelect',false,['Granted','Pending','Withdrawn']]], actions: ['add-note','archive','merge'] },
  applications: { label: 'Applications', singular: 'Application', icon: FileText, fields: [['candidateId','singleSelect',true],['jobId','singleSelect',true],['source','shortText']], actions: ['move-stage','reject','withdraw','hire'] },
  approvals: { label: 'Approvals', singular: 'Approval', icon: CheckCheck, fields: [['title','shortText',true],['workflow','shortText'],['requester','shortText'],['approver','shortText'],['amount','currency'],['status','singleSelect',false,['Pending','Approved','Rejected']]], actions: ['approve','reject','delegate'] },
  interviews: { label: 'Interviews', singular: 'Interview', icon: CalendarDays, fields: [['applicationId','singleSelect',true],['interviewPlanId','singleSelect'],['roundId','singleSelect'],['scorecardId','singleSelect'],['round','shortText'],['type','singleSelect',true],['panel','multiSelect'],['scheduledAt','datetimeLocal',true],['durationMinutes','number',true],['meetingType','singleSelect',false,['Video','In person','Phone']]], actions: ['submit-feedback','reschedule','cancel'] },
  feedback: { label: 'Scorecards', singular: 'Scorecard', icon: ClipboardCheck, fields: [], actions: ['submit'] },
  offers: { label: 'Offers', singular: 'Offer', icon: FileText, fields: [['candidateId','singleSelect',true],['jobId','singleSelect',true],['salary','number',true],['currency','shortText'],['bonus','number'],['joiningDate','date'],['expiresAt','date']], actions: ['approve','reject','accept','decline','withdraw'] },
  onboarding: { label: 'Onboarding', singular: 'Onboarding plan', icon: CheckCheck, fields: [['candidateId','singleSelect'],['jobId','singleSelect'],['joiningDate','date'],['tasks','longText']], actions: [] },
  tasks: { label: 'Tasks', singular: 'Task', icon: Check, fields: [['title','shortText',true],['relatedTo','shortText'],['ownerId','singleSelect'],['dueDate','date'],['priority','singleSelect'],['notes','longText']], actions: ['complete','reopen'] },
  notifications: { label: 'Notifications', singular: 'Notification', icon: Bell, fields: [['title','shortText',true],['message','longText'],['category','shortText'],['read','checkbox']], actions: ['mark-read'] },
  clients: { label: 'Clients', singular: 'Client', icon: Building2, fields: [['name','shortText',true],['industry','shortText'],['website','url'],['location','shortText'],['ownerId','singleSelect'],['status','shortText']], actions: ['archive'] },
  contacts: { label: 'Contacts', singular: 'Contact', icon: Users, fields: [['name','shortText',true],['clientId','singleSelect',true],['email','email'],['phone','phone'],['title','shortText']], actions: [] },
  submissions: { label: 'Candidate submissions', singular: 'Submission', icon: ArrowRight, fields: [['candidateId','singleSelect',true],['clientId','singleSelect',true],['jobId','singleSelect',true],['contactId','singleSelect'],['ownerId','singleSelect'],['fee','number'],['feeType','singleSelect'],['clientFeedback','longText']], actions: ['submit','withdraw','place'] },
  placements: { label: 'Placements', singular: 'Placement', icon: CheckCheck, fields: [['candidateId','singleSelect',true],['clientId','singleSelect',true],['jobId','singleSelect',true],['startDate','date'],['feeType','singleSelect'],['fee','number'],['guaranteeDays','number'],['guaranteeExpiry','date']], actions: ['invoice','complete'] },
  invoices: { label: 'Invoices', singular: 'Invoice', icon: FileText, fields: [['number','shortText'],['clientId','singleSelect',true],['placementId','singleSelect',true],['amount','number',true],['currency','shortText'],['dueAt','date']], actions: ['approve','reject','delegate','mark-paid'] },
  talentPools: { label: 'Talent pools', singular: 'Talent pool', icon: Users, fields: [['name','shortText',true],['description','longText'],['tags','longText'],['followUpDate','date']], actions: [] },
  referrals: { label: 'Referrals', singular: 'Referral', icon: Users, fields: [], actions: [] },
  notes: { label: 'Notes', singular: 'Note', icon: FileText, fields: [['relatedTo','shortText'],['visibility','singleSelect',false,['Team','Private']],['body','longText',true]], actions: [] },
  workforceTargets: { label: 'Workforce plan', singular: 'Hiring target', icon: Activity, fields: [['period','shortText',true],['department','shortText'],['location','shortText'],['role','shortText'],['target','number',true]], actions: [] },
  audit: { label: 'Audit log', singular: 'Audit event', icon: Shield, fields: [], actions: [] },
  outbox: { label: 'Communication outbox', singular: 'Message', icon: FileText, fields: [['recipient','shortText'],['subject','shortText'],['template','shortText'],['status','shortText']], actions: ['send'] },
  automations: { label: 'Automations', singular: 'Automation', icon: Sparkles, fields: [['name','shortText',true],['trigger','shortText',true],['action','shortText',true],['enabled','checkbox']], actions: [] },
}

const NAV_GROUPS = [
  { title: 'Workspace', items: [{ key: 'overview', label: 'Overview', icon: LayoutDashboard }] },
  { title: 'Hiring', items: ['requisitions','jobs','applications','candidates','interviews','feedback','approvals','offers','onboarding'].map((key) => ({ key, label: ENTITIES[key].label, icon: ENTITIES[key].icon })) },
  { title: 'People & operations', items: ['tasks','notifications','talentPools','referrals','workforceTargets'].map((key) => ({ key, label: ENTITIES[key].label, icon: ENTITIES[key].icon })) },
  { title: 'Agency', items: ['clients','contacts','submissions','placements','invoices'].map((key) => ({ key, label: ENTITIES[key].label, icon: ENTITIES[key].icon })) },
  { title: 'Administration', items: ['automations','outbox','audit'].map((key) => ({ key, label: ENTITIES[key].label, icon: ENTITIES[key].icon })).concat([{ key: 'settings', label: 'Settings', icon: Settings2 }]) },
  { title: 'Insights', items: [{ key: 'reports', label: 'Reports', icon: Activity }] },
]

const DEFAULT_LABELS = { jobs: 'Jobs', candidates: 'Candidates', clients: 'Clients', applications: 'Applications', requisitions: 'Hiring requests' }
const DEFAULT_TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent']
function workforcePeriodOptions(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const options = []
  // Keep the selector bounded to the current period and near-future planning horizon.
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = new Date(year, month + offset * 3, 1)
    const quarter = Math.floor(date.getMonth() / 3) + 1
    options.push({ value: `${date.getFullYear()}-Q${quarter}`, label: `Q${quarter} ${date.getFullYear()} · quarter` })
  }
  for (let offset = 0; offset <= 12; offset += 1) {
    const date = new Date(year, month + offset, 1)
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    options.push({ value, label: `${date.toLocaleString(undefined, { month: 'long' })} ${date.getFullYear()} · month` })
  }
  return options
}
function taskPriorities(config) {
  const configured = config?.tasks?.priorities
  const values = Array.isArray(configured) ? [...new Set(configured.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))] : []
  return values.length ? values : DEFAULT_TASK_PRIORITIES
}
function defaultTaskPriority(config) {
  const priorities = taskPriorities(config)
  return priorities.find((priority) => priority.toLowerCase() === 'normal') || priorities[0]
}
const DISPLAY_KEYS = ['title','name','fullName','candidateName','firstName','email','jobTitle','subject','number','id']
const SECONDARY_KEYS = ['email','department','location','stage','status','client','owner','createdAt','updatedAt']
const ownerFieldsForView = ['ownerId','recruiterId','hiringManagerId','assignedTo','assigneeId','userId','createdBy']
const SAVED_VIEW_KINDS = new Set(['jobs','candidates','applications','requisitions','approvals','interviews','feedback','offers','onboarding','tasks','notifications','clients','contacts','submissions','placements','invoices','talentPools','referrals','notes','workforceTargets'])
const SAFE_FONTS = {
  system: 'Inter, "DM Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
const DEFAULT_THEME_COLORS = { primary: '#2347c5', darkPrimary: '#8fa9ff', darkBackground: '#151e2b' }
function safeHexColor(value, fallback) {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim()) ? value.trim() : fallback
}
function platformTheme(branding = {}) {
  const familySetting = branding.typography?.fontFamily || branding.typography || branding.fontFamily || 'system'
  const family = String(familySetting).toLowerCase()
  const colorMode = ['dark', 'light'].includes(String(branding.colorMode).toLowerCase()) ? String(branding.colorMode).toLowerCase() : 'light'
  const primary = safeHexColor(branding.primaryColor, DEFAULT_THEME_COLORS.primary)
  const darkPrimary = safeHexColor(branding.darkPrimaryColor, DEFAULT_THEME_COLORS.darkPrimary)
  const darkBackground = safeHexColor(branding.darkBackgroundColor, DEFAULT_THEME_COLORS.darkBackground)
  return {
    '--platform-primary': colorMode === 'dark' ? darkPrimary : primary,
    '--platform-light-primary': primary,
    '--platform-dark-primary': darkPrimary,
    '--platform-secondary': branding.secondaryColor || branding.primaryColor || '#2347c5',
    '--platform-accent': branding.accentColor || '#13a88a',
    '--platform-font-family': SAFE_FONTS[family] || SAFE_FONTS.system,
    '--platform-ink': colorMode === 'dark' ? '#edf2fb' : '#172033',
    '--platform-muted': colorMode === 'dark' ? '#a7b2c5' : '#69758b',
    '--platform-line': colorMode === 'dark' ? '#344258' : '#e7ebf2',
    '--platform-surface': colorMode === 'dark' ? '#202b3b' : '#fff',
    '--platform-soft': colorMode === 'dark' ? '#29364a' : '#f6f8fc',
    '--platform-page': colorMode === 'dark' ? darkBackground : '#f5f7fb',
    colorScheme: colorMode,
  }
}
function savedViewAgeAnchor(record, kind) {
  if (kind !== 'applications') return record.updatedAt || null
  const history = Array.isArray(record.stageHistory) ? record.stageHistory : Array.isArray(record.stageChanges) ? record.stageChanges : []
  const entry = history.filter((item) => (typeof item === 'string' ? item : item?.stageId || item?.stage || item?.to) === record.stage).at(-1)
  return typeof entry === 'object' && entry ? entry.enteredAt || entry.at || entry.createdAt || null : null
}

function read(object, keys) {
  for (const key of keys) if (object?.[key] !== undefined && object?.[key] !== null && object[key] !== '') return object[key]
  return ''
}
function displayName(record, kind) {
  const first = record?.firstName || record?.first_name || ''
  const last = record?.lastName || record?.last_name || ''
  return `${first} ${last}`.trim() || read(record, DISPLAY_KEYS) || `${ENTITIES[kind]?.singular || humanize(kind)} record`
}
function badgeValue(value) { return String(value || 'Open').replace(/[_-]/g, ' ') }
function getTerm(config, key) {
  const value = config?.terminology?.[key] || config?.terminology?.entities?.[key]
  return typeof value === 'string' && value ? value : DEFAULT_LABELS[key] || ENTITIES[key]?.label || humanize(key)
}
function moduleOn(modules, key) {
  if (!modules) return true
  const entry = modules[key]
  return entry === undefined ? true : typeof entry === 'boolean' ? entry : entry.enabled !== false
}
const MODULE_FOR = { clients: 'agency', contacts: 'agency', submissions: 'agency', placements: 'agency', invoices: 'agency', talentPools: 'talentCrm', workforceTargets: 'workforcePlanning', audit: 'audit', outbox: 'integrations', automations: 'automation', referrals: 'referrals', careers: 'careers' }
const AGENCY_FEATURE_FOR = { clients: 'clients', contacts: 'clientContacts', submissions: 'submissions', placements: 'placements', invoices: 'invoices' }
function agencyFeatureOn(config, key) { return moduleOn(config?.modules, 'agency') && config?.agency?.[AGENCY_FEATURE_FOR[key]] !== false && (key !== 'invoices' || moduleOn(config?.modules, 'invoices')) }
const PERMISSION_FOR = { overview: 'dashboard', feedback: 'interviews', talentPools: 'talentCrm', workforceTargets: 'workforcePlanning', audit: 'audit', outbox: 'integrations', automations: 'automation' }
function hasPermission(user, key, action = 'view') {
  const permissions = user?.permissions
  if (!Array.isArray(permissions)) return false
  if (permissions.includes('*') || permissions.includes('platform:admin') || permissions.includes('*:administer') || permissions.includes(`*:${action}`)) return true
  const moduleKey = PERMISSION_FOR[key] || key
  return permissions.includes(`${key}:${action}`) || permissions.includes(`${key}:*`) || permissions.includes(`${moduleKey}:${action}`) || permissions.includes(`${moduleKey}:*`)
}
function canRunAction(user, kind, action) {
  if (['approve', 'reject', 'delegate'].includes(action) && ['approvals', 'requisitions', 'offers', 'invoices'].includes(kind)) return hasPermission(user, kind, 'approve')
  if (action === 'publish') return hasPermission(user, kind, 'publish')
  if (action === 'move-stage') return hasPermission(user, 'applications', 'edit')
  if (action === 'submit-feedback') return hasPermission(user, 'feedback', 'create') || hasPermission(user, 'interviews', 'edit')
  if (action === 'create-job') return hasPermission(user, kind, 'edit')
  return hasPermission(user, kind, 'edit')
}
function canPreviewOffer(user, config) {
  if (!hasPermission(user, 'offers', 'view')) return false
  const roleId = user?.roleId || user?.role
  const role = (config?.roles || []).find((item) => String(item.id) === String(roleId))
  const sensitive = Array.isArray(role?.sensitive) ? role.sensitive : []
  return sensitive.includes('*') || (sensitive.includes('salary') && sensitive.includes('offerDetails'))
}
function configCustomFields(config, kind) {
  const fields = config?.fields?.[kind] || config?.customFields?.[kind] || config?.candidates?.customFields || []
  return Array.isArray(fields) ? fields : []
}
function fieldKey(field) { return String(field?.field || field?.key || field?.id || field?.name || '') }
function isConditionMet(condition, values) {
  const path = condition?.field || condition?.key || condition?.dependsOn || condition?.when?.field
  if (!path) return true
  const actual = values[path]
  const expected = condition?.value ?? condition?.equals ?? condition?.when?.value
  const operator = condition?.operator || condition?.when?.operator || 'equals'
  if (operator === 'notEquals' || operator === 'not_equals') return actual !== expected
  if (operator === 'contains') return Array.isArray(actual) ? actual.includes(expected) : String(actual || '').includes(String(expected || ''))
  if (operator === 'truthy') return Boolean(actual)
  if (operator === 'falsy') return !actual
  if (operator === 'isEmpty') return actual == null || actual === '' || (Array.isArray(actual) && !actual.length)
  if (operator === 'isNotEmpty') return !(actual == null || actual === '' || (Array.isArray(actual) && !actual.length))
  return actual === expected
}
function applicationFormFor(config, job) {
  const forms = config?.applicationForms || []
  return forms.find((form) => form.id === job?.applicationFormId) || forms.find((form) => form.isDefault || form.default) || forms[0] || null
}
function applicationFields(form) {
  return (form?.sections || []).flatMap((section) => (section.fields || []).map((field) => ({ ...field, key: fieldKey(field), sectionTitle: section.title || section.name || '' }))).filter((field) => field.key)
}
function fieldVisible(field, form, values) {
  if (field.enabled === false || field.visible === false) return false
  const ownCondition = field.condition || field.when
  if (ownCondition && !isConditionMet(ownCondition, values)) return false
  const conditions = [...(form?.conditions || []), ...(field.conditions || [])]
  const matching = conditions.filter((condition) => String(condition.fieldId || condition.targetField || condition.target || condition.showField || condition.hideField || condition.field) === field.key)
  if (!matching.length) return true
  return matching.every((condition) => {
    const result = isConditionMet(condition.when || condition, values)
    return condition.action === 'hide' || condition.hideField ? !result : result
  })
}
function configuredEntityFields(kind, entity, config, related, currentSource = '') {
  const roles = related?.users || config?.users || []
  const units = config?.organization?.units || []
  const locations = config?.organization?.locations || []
  const employment = (config?.employmentTypes || []).filter((item) => item.enabled !== false).map((item) => ({ value: item.id, label: item.label }))
  const pipelines = (config?.pipelines || []).map((item) => ({ value: item.id, label: item.name }))
  const configuredSources = Array.isArray(config?.sources) ? config.sources : null
  const enabledSources = configuredSources?.filter((item) => item && item.enabled !== false).map((item) => ({ value: item.id, label: item.name || item.id })) || []
  // Keep a disabled/deleted source visible when editing a legacy record so a
  // no-op edit does not silently erase it.
  if (currentSource && configuredSources && !enabledSources.some((item) => String(item.value) === String(currentSource))) {
    enabledSources.push({ value: currentSource, label: `${currentSource} (current value)` })
  }
  const optionsByKey = {
    priority: kind === 'tasks' ? taskPriorities(config).map((value) => ({ value, label: humanize(value) })) : undefined,
    employmentType: employment,
    pipelineId: pipelines,
    departmentId: units.map((item) => ({ value: item.id, label: item.name })),
    locationId: locations.map((item) => ({ value: item.id, label: item.name })),
    department: units.map((item) => ({ value: item.name || item.id, label: item.name || item.id })),
    location: locations.map((item) => ({ value: item.name || item.id, label: item.name || item.id })),
    period: workforcePeriodOptions(),
    recruiterId: roles.map((item) => ({ value: item.id, label: item.name })),
    hiringManagerId: roles.map((item) => ({ value: item.id, label: item.name })),
    ownerId: roles.map((item) => ({ value: item.id, label: item.name })),
    candidateId: (related?.candidates || []).map((item) => ({ value: item.id, label: displayName(item, 'candidates') })),
    jobId: (related?.jobs || []).map((item) => ({ value: item.id, label: item.title || item.name || item.id })),
    clientId: (related?.clients || []).map((item) => ({ value: item.id, label: item.name || item.id })),
    contactId: (related?.contacts || []).map((item) => {
      const client = (related?.clients || []).find((row) => String(row.id) === String(item.clientId))
      return { value: item.id, label: `${item.name || item.email || item.id}${client?.name ? ` · ${client.name}` : ''}` }
    }),
    feeType: (config?.agency?.feeTypes || ['fixed','percentage','retainer']).map((value) => ({ value, label: humanize(value) })),
    applicationId: (related?.applications || []).map((item) => {
      const candidate = (related?.candidates || []).find((row) => String(row.id) === String(item.candidateId))
      const job = (related?.jobs || []).find((row) => String(row.id) === String(item.jobId))
      return { value: item.id, label: `${item.candidateName || (candidate ? displayName(candidate, 'candidates') : item.candidateId)} · ${item.jobTitle || job?.title || item.jobId}` }
    }),
    placementId: (related?.placements || []).map((item) => {
      const candidate = (related?.candidates || []).find((row) => String(row.id) === String(item.candidateId))
      const client = (related?.clients || []).find((row) => String(row.id) === String(item.clientId))
      return { value: item.id, label: `${item.candidateName || (candidate ? displayName(candidate, 'candidates') : 'Placement')} · ${item.clientName || client?.name || item.clientId || ''}` }
    }),
    panel: roles.map((item) => ({ value: item.id, label: item.name })),
    interviewPlanId: (config?.interviewPlans || []).map((item) => ({ value: item.id, label: item.name || item.label || item.id })),
    roundId: (config?.interviewPlans || []).flatMap((plan) => (plan.rounds || []).map((round) => ({ value: round.id, label: `${plan.name || plan.label || 'Interview plan'} · ${round.name || round.label || round.id}` }))),
    scorecardId: (config?.scorecards || []).map((item) => ({ value: item.id, label: item.name || item.label || item.id })),
    type: (config?.interviews?.types || []).map((item) => typeof item === 'string' ? ({ value: item, label: humanize(item) }) : ({ value: item.id || item.name, label: item.name || item.label || item.id })),
    source: enabledSources,
  }
  const controlled = { requisitions: ['status'], jobs: ['status'], applications: ['status','stage'], approvals: ['status'], interviews: ['status'], feedback: ['status'], offers: ['status'], onboarding: ['status'], submissions: ['status'], placements: ['status'], invoices: ['status'], tasks: ['status'], notifications: ['read'] }[kind] || []
  const agencyEnabled = moduleOn(config?.modules, 'agency') && config?.agency?.mandates !== false
  const fields = [...(entity?.fields || [])]
  if (kind === 'jobs' && agencyEnabled) fields.splice(1, 0, ['clientId','singleSelect',true], ['contactId','singleSelect'])
  return fields.filter(([key]) => !controlled.includes(key)).map(([key,type,required,options]) => {
    const isSource = key === 'source'
    const sourceConfigured = isSource && Array.isArray(config?.sources)
    const workforce = kind === 'workforceTargets'
    const workforceSelect = workforce && ['period','department','location'].includes(key)
    return {
      key,
      type: sourceConfigured || workforceSelect ? 'singleSelect' : type,
      label: workforce && key === 'period' ? 'Planning period' : workforce && key === 'department' ? 'Organization unit' : workforce && key === 'role' ? 'Role / hiring category (optional)' : workforce && key === 'target' ? 'Target headcount' : key === 'clientId' && kind === 'jobs' ? 'Client' : key === 'contactId' && kind === 'jobs' ? 'Client contact' : key === 'dueAt' ? 'Due date' : key === 'ownerId' ? 'Owner' : key === 'feeType' ? 'Fee type' : humanize(key),
      required: Boolean(required),
      min: workforce && key === 'target' ? 1 : undefined,
      step: workforce && key === 'target' ? 1 : undefined,
      helpText: workforce && key === 'period' ? 'Choose a month or quarter from now through the next two years.' : workforce && key === 'department' ? 'Optional. Options come from your configured organization units.' : workforce && key === 'location' ? 'Optional. Options come from your configured locations.' : workforce && key === 'target' ? 'Enter a positive whole number of planned hires.' : undefined,
      options: optionsByKey[key]?.length ? optionsByKey[key] : options?.map((value) => ({ value, label: value })) || [],
      fullWidth: ['longText','file'].includes(type),
    }
  })
}
function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return {}
  const payload = record.data && typeof record.data === 'object' ? record.data : record
  return { ...payload, id: payload.id ?? record.id }
}
function fileAsPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Please choose the file again.`))
    reader.onload = () => resolve({ filename: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: String(reader.result).split(',')[1] })
    reader.readAsDataURL(file)
  })
}

function Modal({ title, children, onClose, wide = false }) {
  return <div className="platform-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`platform-modal ${wide ? 'platform-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="platform-modal-title"><header><div><h2 id="platform-modal-title">{title}</h2></div><button className="platform-icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>{children}</section></div>
}

function EmptyState({ title, description, action }) {
  return <div className="platform-empty"><div className="platform-empty-mark"><BriefcaseBusiness size={21} /></div><h3>{title}</h3><p>{description}</p>{action}</div>
}

export default function PlatformApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const [bootstrap, setBootstrap] = useState(null)
  const routeKey = location.pathname.replace(/^\/platform\/?/, '').split('/')[0] || 'overview'
  const [activeKey, setActiveKey] = useState(routeKey)
  const [records, setRecords] = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [slaOverview, setSlaOverview] = useState(null)
  const [slaOverviewLoading, setSlaOverviewLoading] = useState(false)
  const [slaOverviewError, setSlaOverviewError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [globalQuery, setGlobalQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [modal, setModal] = useState(null)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [form, setForm] = useState({})
  const [userMenu, setUserMenu] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [careerJobs, setCareerJobs] = useState([])
  const [careerContext, setCareerContext] = useState({})
  const [referenceData, setReferenceData] = useState({ candidates: [], jobs: [] })
  const [careerJob, setCareerJob] = useState(null)
  const [applicationSent, setApplicationSent] = useState(false)
  const [reports, setReports] = useState([])
  const [workforceTargetReport, setWorkforceTargetReport] = useState(null)
  const [workforceTargetLoading, setWorkforceTargetLoading] = useState(false)
  const [workforceTargetError, setWorkforceTargetError] = useState('')
  const isCareers = typeof window !== 'undefined' && window.location.pathname.startsWith('/careers-platform')
  const config = bootstrap?.config || {}
  const rolePermissions = bootstrap?.role?.permissions || {}
  const permissions = Object.entries(rolePermissions).flatMap(([module, actions]) => Array.isArray(actions) ? actions.map((action) => `${module}:${action}`) : [])
  const user = bootstrap?.user ? { ...bootstrap.user, permissions } : null
  const canViewSlaOverview = hasPermission(user, 'reporting', 'view') && moduleOn(config?.modules, 'dashboard')
  const rootName = config.branding?.productName || config.branding?.displayName || config.company?.name || 'People & Hiring'
  const pathname = location.pathname

  const refreshBootstrap = useCallback(async () => {
    const data = await platformApi.bootstrap()
    setBootstrap(data)
    return data
  }, [])

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await platformApi.dashboard()
      setDashboard(data)
      return data
    } catch (requestError) {
      if (requestError.status === 403) { setDashboard(null); return null }
      throw requestError
    }
  }, [])

  const refreshSlaOverview = useCallback(async () => {
    setSlaOverviewLoading(true)
    setSlaOverviewError('')
    try {
      const data = await platformRequest('/sla/overview')
      setSlaOverview(data && typeof data === 'object' ? data : null)
      return data
    } catch (requestError) {
      setSlaOverview(null)
      setSlaOverviewError(requestError.message || 'Could not load aging overview.')
      return null
    } finally {
      setSlaOverviewLoading(false)
    }
  }, [])

  const loadReport = useCallback(async (name) => {
    const headers = new Headers({ Accept: 'application/json', 'X-Demo-User': localStorage.getItem('ats_demo_user') || '' })
    const response = await fetch(`/api/platform/reports/${encodeURIComponent(name)}`, { headers })
    const payload = response.status === 204 ? null : await response.json().catch(() => null)
    if (!response.ok) { const error = new Error(payload?.error?.message || payload?.message || `Request failed (${response.status})`); error.status = response.status; throw error }
    return payload?.data ?? payload
  }, [])

  const loadEntity = useCallback(async (key) => {
    if (!ENTITIES[key]) return
    setLoading(true)
    setError('')
    try {
      const data = await platformApi.list(key)
      setRecords(Array.isArray(data) ? data.map(normalizeRecord) : data?.records?.map(normalizeRecord) || [])
    } catch (requestError) {
      setRecords([])
      setError(requestError.message)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (isCareers) {
      platformApi.publicJobs().then((data) => { setCareerContext(Array.isArray(data) ? (data[0] || {}) : data?.config || data || {}); setCareerJobs(Array.isArray(data) ? data : data?.jobs || []) }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false))
      return
    }
    Promise.all([refreshBootstrap(), refreshDashboard()]).then(([data]) => {
      const branding = data?.config?.branding || {}
      if (branding.favicon) { let icon = document.querySelector('link[rel="icon"]'); if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.appendChild(icon) } icon.href = branding.favicon }
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false))
  }, [isCareers, refreshBootstrap, refreshDashboard])

  useEffect(() => {
    if (routeKey !== activeKey) setActiveKey(routeKey)
  }, [routeKey, activeKey])

  useEffect(() => {
    if (activeKey !== 'overview' || !canViewSlaOverview || isCareers) {
      setSlaOverview(null)
      setSlaOverviewError('')
      return
    }
    refreshSlaOverview()
  }, [activeKey, canViewSlaOverview, isCareers, refreshSlaOverview, user?.id])

  useEffect(() => {
    if (activeKey !== 'overview' && activeKey !== 'settings' && !isCareers) loadEntity(activeKey)
  }, [activeKey, loadEntity, isCareers])

  useEffect(() => {
    if (activeKey !== 'reports' || isCareers) return
    let live = true
    setLoading(true); setError('')
    Promise.all(['overview','pipeline','sources','workload','offers','interviews','agency','workforce'].map(async (name) => {
      try { return await loadReport(name) } catch (requestError) { if ([403,404].includes(requestError.status)) return null; throw requestError }
    })).then((items) => { if (live) setReports(items.filter(Boolean)) }).catch((requestError) => { if (live) { setReports([]); setError(requestError.message) } }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [activeKey, isCareers, loadReport])

  const canViewWorkforceTargetReport = activeKey === 'reports' && moduleOn(bootstrap?.modules, 'reporting') && moduleOn(bootstrap?.modules, 'workforcePlanning') && hasPermission(user, 'reporting') && hasPermission(user, 'workforceTargets')
  useEffect(() => {
    if (activeKey !== 'reports' || isCareers) return
    if (!canViewWorkforceTargetReport) {
      setWorkforceTargetReport(null)
      setWorkforceTargetError('')
      setWorkforceTargetLoading(false)
      return
    }
    let live = true
    setWorkforceTargetLoading(true)
    setWorkforceTargetReport(null)
    setWorkforceTargetError('')
    loadReport('workforce-targets').then((data) => { if (live) setWorkforceTargetReport(data) }).catch((requestError) => {
      if (!live) return
      setWorkforceTargetReport(null)
      if (requestError.status === 403) setWorkforceTargetError('Your role does not have access to the workforce outcomes used in this report.')
      else if (requestError.status !== 404) setWorkforceTargetError(requestError.message || 'Could not load the workforce targets report.')
    }).finally(() => { if (live) setWorkforceTargetLoading(false) })
    return () => { live = false }
  }, [activeKey, isCareers, canViewWorkforceTargetReport, user?.id, loadReport])

  useEffect(() => {
    if (globalQuery.trim().length < 2 || isCareers) { setSearchResults([]); return }
    const timer = window.setTimeout(() => platformApi.search(globalQuery.trim()).then((data) => setSearchResults(Array.isArray(data) ? data : [])).catch(() => setSearchResults([])), 220)
    return () => window.clearTimeout(timer)
  }, [globalQuery, isCareers])

  const canViewSection = useCallback((key) => {
    if (key === 'overview') return hasPermission(user, 'dashboard')
    if (key === 'reports') return hasPermission(user, 'reporting') && moduleOn(bootstrap?.modules, 'reporting')
    if (key === 'settings') return user?.roleId === 'admin' || user?.role === 'admin' || user?.permissions?.includes('platform:admin') || user?.permissions?.includes('*')
    const moduleKey = MODULE_FOR[key] || key
    return (!bootstrap?.modules || moduleOn(bootstrap.modules, moduleKey))
      && (!AGENCY_FEATURE_FOR[key] || agencyFeatureOn(bootstrap?.config || {}, key))
      && hasPermission(user, key)
  }, [bootstrap, user])
  const visibleGroups = useMemo(() => NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => {
    return canViewSection(item.key)
  }) })).filter((group) => group.items.length), [canViewSection])
  useEffect(() => {
    if (!bootstrap || !user) return
    const allowedItems = visibleGroups.flatMap((group) => group.items)
    if (allowedItems.some((item) => item.key === activeKey)) return
    const firstAllowed = allowedItems.find((item) => item.key !== 'overview') || allowedItems[0]
    if (firstAllowed) { setActiveKey(firstAllowed.key); navigate(`/platform/${firstAllowed.key === 'overview' ? '' : firstAllowed.key}`, { replace: true }) }
    else navigate('/careers-platform', { replace: true })
  }, [bootstrap, user, visibleGroups, activeKey, navigate])
  const activeItem = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.key === activeKey)
  const entity = ENTITIES[activeKey]
  const formConfig = { ...config, users: bootstrap?.users || config.users || [] }
  const customFields = entity ? configCustomFields(config, activeKey) : []
  const formFields = entity ? [
    ...configuredEntityFields(activeKey, entity, formConfig, referenceData, modal?.type === 'edit' ? selectedRecord?.source : ''),
    ...customFields.map((field) => ({ ...field, key: fieldKey(field) })),
  ] : []
  const filteredRecords = useMemo(() => records.filter((record) => !query || JSON.stringify(record).toLowerCase().includes(query.toLowerCase())), [records, query])

  const changeSection = (key) => {
    setActiveKey(key)
    setSelectedRecord(null)
    setError('')
    setNotice('')
    setQuery('')
    setMobileNav(false)
    if (!isCareers) navigate(`/platform/${key === 'overview' ? '' : key}`, { replace: true })
  }

  const loadReferenceData = async (kind) => {
    const fieldKeys = (ENTITIES[kind]?.fields || []).map(([key]) => key)
    if (kind === 'jobs' && moduleOn(config?.modules, 'agency') && config?.agency?.mandates !== false) fieldKeys.push('clientId', 'contactId')
    const references = { candidateId: 'candidates', jobId: 'jobs', applicationId: 'applications', clientId: 'clients', contactId: 'contacts', placementId: 'placements' }
    const kinds = [...new Set(fieldKeys.map((key) => references[key]).filter(Boolean))]
    if (kinds.length) {
      const rows = await Promise.all(kinds.map(async (referenceKind) => [referenceKind, await platformApi.list(referenceKind)]))
      setReferenceData((current) => ({ ...current, users: bootstrap?.users || config.users || [], ...Object.fromEntries(rows.map(([referenceKind, result]) => [referenceKind, Array.isArray(result) ? result.map(normalizeRecord) : result?.records?.map(normalizeRecord) || []])) }))
    } else {
      setReferenceData((current) => ({ ...current, users: bootstrap?.users || config.users || [] }))
    }
  }

  const openCreate = async () => {
    if (activeKey === 'referrals') { try { const result = await platformApi.publicJobs(); const rows = Array.isArray(result) ? result : result?.jobs || []; setReferenceData((current) => ({ ...current, jobs: rows.map(normalizeRecord) })); setModal({ type: 'referral' }) } catch (requestError) { setError(requestError.message) } return }
    try { await loadReferenceData(activeKey) }
    catch (requestError) { setError(requestError.message); return }
    const initial = {}
    formFields.forEach((field) => { const key = fieldKey(field); if (key) initial[key] = field.defaultValue ?? (field.type === 'multiSelect' ? [] : '') })
    if (activeKey === 'interviews') {
      initial.durationMinutes = initial.durationMinutes || config.interviews?.defaultDurationMinutes || 45
      const defaultPlan = config.interviewPlans?.find((item) => item.default || item.isDefault) || config.interviewPlans?.[0]
      if (defaultPlan) initial.interviewPlanId = defaultPlan.id
    }
    if (activeKey === 'tasks') initial.priority = defaultTaskPriority(formConfig)
    if (activeKey === 'workforceTargets') initial.period = workforcePeriodOptions()[0]?.value || ''
    setForm(initial)
    setModal({ type: 'create' })
  }

  const saveRecord = async (event) => {
    event.preventDefault()
    if (!entity || busy) return
    setBusy(true)
    setError('')
    try {
      const fileDefinitions = [...(entity.fields || []).map(([key, type]) => ({ key, type })), ...customFields.map((field) => ({ ...field, key: fieldKey(field) }))]
      const payload = { ...form }
      const files = []
      for (const field of fileDefinitions.filter((item) => item.type === 'file')) {
        const file = payload[field.key]
        delete payload[field.key]
        if (file instanceof File) files.push({ file, category: field.category || humanize(field.key), field: field.key, visibility: field.visibility || 'restricted' })
      }
      const customValues = { ...(payload.customFields || {}) }
      for (const field of customFields) {
        const key = fieldKey(field)
        if (!key || field.type === 'file') continue
        if (Object.prototype.hasOwnProperty.call(payload, key)) customValues[key] = payload[key]
        delete payload[key]
      }
      if (Object.keys(customValues).length) payload.customFields = customValues
      if (activeKey === 'interviews' && payload.scheduledAt) {
        const timezone = config.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        payload.scheduledAt = toInterviewISO(payload.scheduledAt, timezone)
        payload.timezone = timezone
      }
      if (activeKey === 'interviews' && payload.applicationId) {
        const application = referenceData.applications?.find((row) => String(row.id) === String(payload.applicationId))
        if (!application) throw new Error('Choose an application that is available in this workspace.')
        payload.candidateId = application.candidateId
        payload.jobId = application.jobId
      }
      if (activeKey === 'interviews' && payload.roundId) {
        const plan = (config.interviewPlans || []).find((item) => item.id === payload.interviewPlanId || item.rounds?.some((round) => String(round.id) === String(payload.roundId)))
        const round = plan?.rounds?.find((item) => String(item.id) === String(payload.roundId))
        if (plan) payload.interviewPlanId = plan.id
        if (round) {
          payload.round = round.name || round.label || round.id
          payload.type = round.type || payload.type
          payload.durationMinutes = round.durationMinutes || payload.durationMinutes
          if (!payload.scorecardId && round.scorecardId) payload.scorecardId = round.scorecardId
        }
      }
      if (activeKey === 'submissions' && modal.type !== 'edit' && !payload.status) payload.status = 'draft'
      const response = modal.type === 'edit' ? await platformApi.update(activeKey, selectedRecord.id, payload) : await platformApi.create(activeKey, payload)
      const normalized = normalizeRecord(response)
      for (const attachment of files) await platformApi.uploadDocument(activeKey, normalized.id, { ...(await fileAsPayload(attachment.file)), category: attachment.category, field: attachment.field, visibility: attachment.visibility })
      if (files.length) {
        const refreshed = await platformApi.get(activeKey, normalized.id)
        Object.assign(normalized, normalizeRecord(refreshed))
      }
      setRecords((current) => modal.type === 'edit' ? current.map((record) => String(record.id) === String(normalized.id) ? normalized : record) : [normalized, ...current])
      setModal(null)
      setNotice(modal.type === 'edit' ? `${entity.singular} updated` : `${entity.singular} created`)
      refreshDashboard().catch(() => {})
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }

  const runAction = async (record, action, values = {}) => {
    setBusy(true)
    setError('')
    try {
      const actionPayload = { ...values }
      if (activeKey === 'interviews' && action === 'reschedule' && actionPayload.scheduledAt) {
        const timezone = config.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
        actionPayload.scheduledAt = toInterviewISO(actionPayload.scheduledAt, timezone)
        actionPayload.timezone = timezone
        actionPayload.type = record.type
        actionPayload.durationMinutes = record.durationMinutes
      }
      const updated = await platformApi.action(activeKey, record.id, action, actionPayload)
      const normalized = updated && typeof updated === 'object' ? normalizeRecord(updated) : null
      const destination = ({ 'requisitions:create-job': 'jobs', 'submissions:place': 'placements', 'placements:invoice': 'invoices' })[`${activeKey}:${action}`]
      if (destination && normalized?.id) {
        await loadEntity(activeKey)
        setModal(null)
        changeSection(destination)
        setNotice(`${ENTITIES[destination].singular} created`)
        if (hasPermission(user, destination)) {
          try { setSelectedRecord(normalizeRecord(await platformApi.get(destination, normalized.id))) }
          catch { setNotice(`${humanize(action)} completed; the new ${ENTITIES[destination].singular.toLowerCase()} is available in ${ENTITIES[destination].label}.`) }
        }
      } else {
        if (normalized?.id && String(normalized.id) === String(record.id)) setRecords((current) => current.map((item) => String(item.id) === String(record.id) ? normalized : item))
        else await loadEntity(activeKey)
        setSelectedRecord(normalized?.id && String(normalized.id) === String(record.id) ? normalized : null)
      }
      setModal(null)
      if (!destination) setNotice(`${humanize(action)} completed`)
      refreshDashboard().catch(() => {})
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }

  const openSearchResult = async (result) => {
    const kind = result?.kind
    if (!ENTITIES[kind] || !canViewSection(kind)) return
    setGlobalQuery('')
    setSearchResults([])
    changeSection(kind)
    try {
      const record = await platformApi.get(kind, result.id)
      setSelectedRecord(normalizeRecord(record))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const deleteRecord = async (record) => {
    if (!window.confirm(`Archive this ${entity.singular.toLowerCase()}? You can restore archived data from Data settings.`)) return
    setBusy(true)
    try { await platformApi.remove(activeKey, record.id); setRecords((current) => current.filter((item) => String(item.id) !== String(record.id))); setSelectedRecord(null); setNotice(`${entity.singular} archived`) }
    catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }

  const openEdit = async (record) => {
    if (['onboarding','referrals','automations'].includes(activeKey)) return
    try { await loadReferenceData(activeKey) }
    catch (requestError) { setError(requestError.message); return }
    const timezone = config.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    setSelectedRecord(record); setForm({ ...record, ...(record.customFields || {}), ...(activeKey === 'interviews' ? { scheduledAt: fromInterviewISO(record.scheduledAt, timezone) } : {}) }); setModal({ type: 'edit' })
  }
  const openAction = (record, action, initialValues = {}) => { const timezone = config.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone; setSelectedRecord(record); setForm({ ...(action === 'reschedule' && activeKey === 'interviews' ? { scheduledAt: fromInterviewISO(record.scheduledAt, timezone) } : {}), ...initialValues }); setModal({ type: 'action', action }) }
  const exportRecords = async () => {
    try {
      const data = await platformApi.export(activeKey)
      const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: typeof data === 'string' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `${activeKey}-export.${typeof data === 'string' ? 'csv' : 'json'}`; link.click(); URL.revokeObjectURL(url)
    } catch (requestError) { setError(requestError.message) }
  }
  const previewInvoice = async (record) => {
    // Open the tab while handling the click, then navigate it after the authenticated fetch.
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setError('Allow pop-ups to open the invoice preview.'); return }
    tab.opener = null
    try {
      const blob = await platformApi.invoiceDocument(record.id)
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'text/html' }))
      tab.location.replace(objectUrl)
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (requestError) {
      tab.close()
      setError(requestError.message)
    }
  }
  const previewOffer = async (record) => {
    if (!canPreviewOffer(user, config)) return
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setError('Allow pop-ups to open the offer preview.'); return }
    tab.opener = null
    tab.document.body.textContent = 'Loading offer preview…'
    try {
      const response = await fetch(`/api/platform/offers/${encodeURIComponent(record.id)}/document`, { headers: { Accept: 'text/html', 'X-Demo-User': localStorage.getItem('ats_demo_user') || '' } })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message = payload?.error?.message || payload?.message || payload?.error || `Request failed (${response.status})`
        throw new Error(typeof message === 'string' ? message : 'The offer preview could not be opened.')
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'text/html' }))
      tab.location.replace(objectUrl)
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (requestError) {
      tab.document.body.textContent = `Could not open offer preview: ${requestError.message}`
      setError(requestError.message)
    }
  }

  if (isCareers) return <CareersExperience jobs={careerJobs} context={careerContext} loading={loading} error={error} job={careerJob} setJob={setCareerJob} sent={applicationSent} setSent={setApplicationSent} />

  if (loading && !bootstrap) return <div className="ats-platform"><div className="platform-loading"><div className="platform-spinner" /><span>Opening your hiring workspace…</span></div></div>
  if (!bootstrap) return <div className="ats-platform"><div className="platform-error-page"><h1>We couldn’t open this workspace</h1><p>{error || 'The local ATS API did not respond.'}</p><button className="platform-button platform-button--primary" disabled={loading} onClick={async () => { setLoading(true); setError(''); try { await Promise.all([refreshBootstrap(), refreshDashboard()]) } catch (requestError) { setError(requestError.message || 'Could not reopen this workspace. Please try again.') } finally { setLoading(false) } }}>{loading ? 'Trying…' : 'Try again'}</button></div></div>

  return <div className="ats-platform" data-color-mode={String(config.branding?.colorMode || 'light').toLowerCase()} style={platformTheme(config.branding)}>
    <aside className={`platform-sidebar ${mobileNav ? 'is-open' : ''}`}>
      <div className="platform-brand"><div className="platform-brand-mark">{config.branding?.logo || config.branding?.horizontalLogo ? <img src={config.branding.logo || config.branding.horizontalLogo} alt="" /> : <span>{String(rootName).slice(0,1).toUpperCase()}</span>}</div><div className="platform-brand-copy"><strong>{rootName}</strong><small>{config.company?.name || 'Hiring workspace'}</small></div><button className="platform-icon-button platform-mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button></div>
      <button className="platform-workspace-switch" onClick={() => setUserMenu((value) => !value)}><span className="platform-workspace-dot" /><span><strong>{config.company?.name || rootName}</strong><small>Local demo workspace</small></span><ChevronDown size={15} /></button>
      <nav className="platform-nav" aria-label="Workspace navigation">{visibleGroups.map((group) => <div className="platform-nav-group" key={group.title}><div className="platform-nav-heading">{group.title}</div>{group.items.map(({ key, label, icon: Icon }) => <button key={key} className={`platform-nav-link ${activeKey === key ? 'is-active' : ''}`} onClick={() => changeSection(key)}><Icon size={17} strokeWidth={1.8} /><span>{getTerm(config, key) || label}</span>{key === 'approvals' && Number(bootstrap.counts?.pendingApprovals) > 0 && <em>{bootstrap.counts.pendingApprovals}</em>}</button>)}</div>)}</nav>
      <div className="platform-sidebar-bottom"><div className="platform-demo-note"><span className="platform-live-dot" /> Local demo mode</div><a href="/careers-platform" className="platform-careers-link"><Globe2 size={16} /> View careers site <ArrowUpRight /></a></div>
    </aside>
    {mobileNav && <button className="platform-mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="platform-main">
      <header className="platform-topbar"><div className="platform-topbar-start"><button className="platform-icon-button platform-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><div className="platform-breadcrumb"><span>{rootName}</span><ChevronRight size={14} /><strong>{activeKey === 'overview' ? 'Overview' : activeKey === 'settings' ? 'Settings' : getTerm(config, activeKey)}</strong></div></div>
        <div className="platform-topbar-actions"><div className="platform-global-search"><Search size={16} /><input aria-label="Search workspace" placeholder="Search people, jobs, clients…" value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setGlobalQuery('')} />{globalQuery && <button onClick={() => setGlobalQuery('')} aria-label="Clear search"><X size={14} /></button>}{searchResults.some((result) => canViewSection(result.kind)) && <div className="platform-search-results">{searchResults.filter((result) => canViewSection(result.kind)).slice(0,7).map((result) => <button key={`${result.kind}-${result.id}`} onClick={() => openSearchResult(result)}><span>{result.label || displayName(result, result.kind)}</span><small>{ENTITIES[result.kind]?.label || humanize(result.kind)}{result.subtitle ? ` · ${result.subtitle}` : ''}</small></button>)}</div>}</div>
          {canViewSection('notifications') && <button className="platform-icon-button platform-notification-top" aria-label="Notifications" onClick={() => changeSection('notifications')}><Bell size={18} />{Number(bootstrap.counts?.unreadNotifications) > 0 && <i />}</button>}
          <div className="platform-user-switch"><button className="platform-user-button" onClick={() => setUserMenu((value) => !value)}><span className="platform-avatar">{user?.name?.split(' ').map((part) => part[0]).join('').slice(0,2) || 'U'}</span><span className="platform-user-copy"><strong>{user?.name || 'Demo user'}</strong><small>{humanize(user?.role || 'user')}</small></span><ChevronDown size={15} /></button>{userMenu && <div className="platform-user-menu"><p>Switch demo user</p>{(bootstrap.users || []).map((candidate) => <button key={candidate.id} className={candidate.id === user?.id ? 'is-selected' : ''} onClick={async () => { localStorage.setItem('ats_demo_user', candidate.id); setUserMenu(false); setLoading(true); try { await refreshBootstrap(); await refreshDashboard(); if (activeKey !== 'overview' && activeKey !== 'settings') await loadEntity(activeKey); setNotice(`Now viewing as ${candidate.name}`) } catch (requestError) { setError(requestError.message) } finally { setLoading(false) } }}><span className="platform-avatar platform-avatar--small">{candidate.name?.split(' ').map((part) => part[0]).join('').slice(0,2)}</span><span><strong>{candidate.name}</strong><small>{humanize(candidate.role)}</small></span>{candidate.id === user?.id && <Check size={15} />}</button>)}<div className="platform-menu-foot"><Shield size={13} /> Development authentication</div></div>}</div>
        </div>
      </header>
      <div className="platform-content">
        {error && <div className="platform-alert platform-alert--error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {notice && <div className="platform-alert platform-alert--success" role="status"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {activeKey === 'overview' ? <Overview config={config} dashboard={dashboard} counts={bootstrap.counts} user={user} onNavigate={changeSection} slaOverview={slaOverview} slaOverviewLoading={slaOverviewLoading} slaOverviewError={slaOverviewError} onRefreshSla={refreshSlaOverview} canViewSlaOverview={canViewSlaOverview} /> : activeKey === 'reports' ? <ReportsPage reports={reports} loading={loading} workforceTargetReport={workforceTargetReport} workforceTargetLoading={workforceTargetLoading} workforceTargetError={workforceTargetError} showWorkforceTargets={canViewWorkforceTargetReport} /> : activeKey === 'settings' ? <Settings config={config} onActivated={async () => { await refreshBootstrap(); await refreshDashboard(); setNotice('Configuration activated') }} /> : entity ? <EntityPage key={`${activeKey}:${user?.id || ''}`} kind={activeKey} meta={entity} label={getTerm(config, activeKey)} records={filteredRecords} allRecords={records} query={query} setQuery={setQuery} loading={loading} user={user} config={config} savedViewUsers={bootstrap.users || []} onCreate={openCreate} onEdit={openEdit} onSelect={setSelectedRecord} onAction={openAction} onExport={exportRecords} onPreviewInvoice={previewInvoice} onPreviewOffer={previewOffer} onRefresh={() => loadEntity(activeKey)} /> : <EmptyState title="This section is not available" description="Choose a section from the workspace menu." />}
      </div>
    </main>
    {userMenu && <button className="platform-dismiss-layer" onClick={() => setUserMenu(false)} aria-label="Close menu" />}
    {modal && (entity || activeKey === 'referrals') && <Modal title={modal.type === 'referral' ? 'Submit an employee referral' : modal.type === 'create' ? `Add ${entity.singular.toLowerCase()}` : modal.type === 'edit' ? `Edit ${entity.singular.toLowerCase()}` : `${humanize(modal.action)} · ${displayName(selectedRecord, activeKey)}`} onClose={() => setModal(null)} wide={modal.type !== 'action'}>
      {modal.type === 'referral' ? <ReferralForm jobs={referenceData.jobs || []} busy={busy} onCancel={() => setModal(null)} onSubmit={async (payload) => { setBusy(true); setError(''); try { const response = await fetch('/api/platform/referrals/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Demo-User': localStorage.getItem('ats_demo_user') || '' }, body: JSON.stringify({ data: payload }) }); const result = await response.json().catch(() => null); if (!response.ok) throw new Error(result?.error?.message || result?.message || `Request failed (${response.status})`); const submitted = result?.data ?? result; if (submitted?.id) setRecords((current) => [normalizeRecord(submitted), ...current]); setModal(null); setNotice('Referral submitted') } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } }} /> : modal.type === 'action' ? <ActionForm action={modal.action} kind={activeKey} record={selectedRecord} values={form} setValues={setForm} onSubmit={(values) => runAction(selectedRecord, modal.action, values || form)} onCancel={() => setModal(null)} busy={busy} config={formConfig} /> : <form className="platform-form" onSubmit={saveRecord}><p className="platform-form-intro">Fields marked with <span className="platform-required">*</span> are required. Your changes are saved in this company workspace.</p>{activeKey === 'interviews' && <p className="platform-form-intro">Times use {config.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}, the workspace IANA timezone.</p>}<div className="platform-form-grid">{formFields.map((field) => <FieldControl key={fieldKey(field)} field={activeKey === 'interviews' && fieldKey(field) === 'scheduledAt' ? { ...field, type: 'datetimeLocal' } : field} value={form[fieldKey(field)]} onChange={(value) => setForm((current) => ({ ...current, [fieldKey(field)]: value }))} />)}</div><footer><button type="button" className="platform-button" onClick={() => setModal(null)}>Cancel</button><button className="platform-button platform-button--primary" disabled={busy}>{busy ? 'Saving…' : modal.type === 'edit' ? 'Save changes' : `Create ${entity.singular.toLowerCase()}`}</button></footer></form>}
    </Modal>}
    {selectedRecord && !modal && entity && <RecordDrawer kind={activeKey} meta={entity} record={selectedRecord} config={config} onClose={() => setSelectedRecord(null)} onEdit={() => openEdit(selectedRecord)} onAction={(action, initialValues) => openAction(selectedRecord, action, initialValues)} onDelete={() => deleteRecord(selectedRecord)} onPreviewInvoice={() => previewInvoice(selectedRecord)} onPreviewOffer={() => previewOffer(selectedRecord)} loading={busy} user={user} onRecordChange={(next) => { setSelectedRecord(next); setRecords((current) => current.map((row) => String(row.id) === String(next.id) ? next : row)) }} onChecklistChange={async (itemId, status) => { const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json', 'X-Demo-User': localStorage.getItem('ats_demo_user') || '' }); const response = await fetch(`/api/platform/actions/onboarding/${encodeURIComponent(selectedRecord.id)}/checklist-item`, { method: 'POST', headers, body: JSON.stringify({ itemId, status }) }); const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${response.status})`); const next = normalizeRecord(payload?.data ?? payload); if (next.id) { setSelectedRecord(next); setRecords((current) => current.map((row) => String(row.id) === String(next.id) ? next : row)) } else { const fresh = normalizeRecord(await platformApi.get('onboarding', selectedRecord.id)); setSelectedRecord(fresh); setRecords((current) => current.map((row) => String(row.id) === String(fresh.id) ? fresh : row)) } }} />}
  </div>
}

function ArrowUpRight() { return <ArrowRight size={14} className="platform-link-arrow" /> }

function Overview({ config, dashboard, counts = {}, user, onNavigate, slaOverview, slaOverviewLoading, slaOverviewError, onRefreshSla, canViewSlaOverview }) {
  const metrics = dashboard?.metrics || dashboard?.summary || dashboard || {}
  const tiles = [
    ['Open positions', metrics.openJobs ?? metrics.openPositions ?? counts.openJobs ?? 0, BriefcaseBusiness, 'jobs'],
    ['Active candidates', metrics.activeCandidates ?? metrics.candidates ?? counts.candidates ?? 0, Users, 'candidates'],
    ['In process', metrics.inProcess ?? metrics.activeApplications ?? counts.applications ?? 0, Activity, 'applications'],
    ['Needs your attention', metrics.pendingApprovals ?? counts.pendingApprovals ?? 0, ClipboardCheck, 'approvals'],
  ]
  const activity = dashboard?.recentActivity || dashboard?.activity || dashboard?.recent || []
  const hiring = dashboard?.hiringByDepartment || dashboard?.departmentProgress || []
  const greeting = user?.name ? `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}` : 'Your hiring at a glance'
  return <div className="platform-page platform-overview"><div className="platform-page-heading platform-overview-heading"><div><div className="platform-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>{greeting}</h1><p>Here is the latest across {config.company?.name || 'your hiring workspace'}.</p></div><button className="platform-button" onClick={() => onNavigate('requisitions')}><Plus size={16} /> Request a hire</button></div>
    <div className="platform-metric-grid">{tiles.map(([label,value,Icon,route], index) => <button className="platform-metric-card" key={label} onClick={() => onNavigate(route)}><div className={`platform-metric-icon metric-${index}`}><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{index === 3 ? 'Pending decisions' : 'Current workspace'}</small><ArrowRight size={15} className="platform-metric-arrow" /></button>)}</div>
    {canViewSlaOverview && <SlaAgingPanel overview={slaOverview} loading={slaOverviewLoading} error={slaOverviewError} onRefresh={onRefreshSla} onNavigate={onNavigate} canViewApplications={hasPermission(user, 'applications', 'view')} />}
    <div className="platform-overview-grid"><section className="platform-panel platform-shortcuts"><div className="platform-panel-heading"><div><h2>Continue where you left off</h2><p>Common actions for your hiring team</p></div></div><div className="platform-shortcut-list">{[['Review applications','Move candidates through your hiring process','applications',FileText],['Manage open jobs','Create, publish and track roles','jobs',BriefcaseBusiness],['Plan interviews','Coordinate rounds and collect feedback','interviews',CalendarDays],['Review approvals','Keep hiring decisions moving','approvals',CheckCheck]].map(([title,description,key,Icon]) => <button className="platform-shortcut" key={key} onClick={() => onNavigate(key)}><span className="platform-shortcut-icon"><Icon size={18} /></span><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}</div></section>
      <section className="platform-panel platform-attention"><div className="platform-panel-heading"><div><h2>Hiring pulse</h2><p>Progress across teams</p></div><button className="platform-text-button" onClick={() => onNavigate('workforceTargets')}>View plan <ArrowRight size={14} /></button></div>{hiring.length ? <div className="platform-hiring-list">{hiring.slice(0,5).map((item,index) => { const target = Number(item.target || item.goal || 0); const actual = Number(item.hired || item.actual || 0); return <div className="platform-hiring-item" key={item.department || index}><div><strong>{item.department || item.name || 'Team'}</strong><span>{actual} of {target || '—'} hires</span></div><div className="platform-progress"><span style={{ width: `${target ? Math.min(100, actual / target * 100) : 0}%` }} /></div></div>})}</div> : <EmptyState title="Set your hiring targets" description="Add goals by department and period to track hiring progress here." action={<button className="platform-button platform-button--small" onClick={() => onNavigate('workforceTargets')}>Set targets</button>} />}</section></div>
    <section className="platform-panel platform-activity-panel"><div className="platform-panel-heading"><div><h2>Recent activity</h2><p>Work happening across your organization</p></div><button className="platform-text-button" onClick={() => onNavigate('audit')}>View audit log <ArrowRight size={14} /></button></div>{activity.length ? <div className="platform-activity-list">{activity.slice(0,6).map((item,index) => <div className="platform-activity-row" key={item.id || index}><span className="platform-activity-dot"><Activity size={13} /></span><span><strong>{item.title || item.action || humanize(item.kind || 'Update')}</strong><small>{item.description || item.actor || item.user || 'Workspace activity'}</small></span><time>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : item.time || ''}</time></div>)}</div> : <EmptyState title="No recent activity yet" description="As your team reviews candidates and updates jobs, activity will appear here." />}</section>
  </div>
}

function SlaAgingPanel({ overview, loading, error, onRefresh, onNavigate, canViewApplications }) {
  const items = Array.isArray(overview?.items) ? overview.items : []
  const summary = overview?.summary || {}
  const total = Number(summary.total) || 0
  const overdue = Number(summary.overdue) || 0
  const onTrack = Number(summary.onTrack) || 0
  const recent = [...items].sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || String(a.dueAt || '').localeCompare(String(b.dueAt || ''))).slice(0, 5)
  const asOf = overview?.asOf ? new Date(overview.asOf) : null
  return <section className="platform-panel platform-sla-panel" aria-labelledby="platform-sla-heading">
    <div className="platform-panel-heading"><div><h2 id="platform-sla-heading">Aging and SLA</h2><p>{asOf && !Number.isNaN(asOf.getTime()) ? `As of ${asOf.toLocaleString()}` : 'Current records against their configured service targets'}</p></div><button className="platform-text-button" onClick={onRefresh} disabled={loading} aria-label="Refresh aging and SLA data"><Activity size={14} /> Refresh</button></div>
    {loading ? <div className="platform-table-loading" role="status"><div className="platform-spinner" /> Loading aging indicators…</div> : error ? <div className="platform-sla-state"><div className="platform-inline-error" role="alert">Could not load aging indicators: {error}</div><button className="platform-button platform-button--small" onClick={onRefresh}>Try again</button></div> : <>
      <div className="platform-sla-stats" aria-label="SLA summary"><div><strong>{total.toLocaleString()}</strong><span>Tracked</span></div><div className={overdue ? 'is-overdue' : ''}><strong>{overdue.toLocaleString()}</strong><span>Overdue</span></div><div><strong>{onTrack.toLocaleString()}</strong><span>On track</span></div></div>
      {recent.length ? <ul className="platform-sla-list">{recent.map((item, index) => {
        const overdueItem = Boolean(item.overdue)
        const label = `${humanize(item.type || 'Tracked item')}${item.stage ? ` · ${humanize(item.stage)}` : ''}${item.recordId ? ` · ${item.recordId}` : ''}`
        const due = item.dueAt ? new Date(item.dueAt) : null
        const dueLabel = due && !Number.isNaN(due.getTime()) ? `${overdueItem ? 'Due' : 'Target'} ${due.toLocaleDateString()}` : `${item.threshold?.amount ?? '—'} ${item.threshold?.unit || 'days'} target`
        return <li key={`${item.type || 'sla'}-${item.recordId || item.applicationId || index}`}><span className={`platform-sla-indicator${overdueItem ? ' is-overdue' : ''}`} aria-hidden="true" /><span className="platform-sla-item-copy"><strong>{label}</strong><small>{item.status ? `${badgeValue(item.status)} · ` : ''}{dueLabel}</small></span><span className={`platform-sla-badge${overdueItem ? ' is-overdue' : ''}`}>{overdueItem ? 'Overdue' : 'On track'}</span></li>
      })}</ul> : <div className="platform-sla-empty">No records are currently being tracked against an SLA.</div>}
      {canViewApplications && <button className="platform-text-button platform-sla-view" onClick={() => onNavigate('applications')}>View applications <ArrowRight size={14} /></button>}
    </>}
  </section>
}

function ReportsPage({ reports, loading, workforceTargetReport, workforceTargetLoading, workforceTargetError, showWorkforceTargets }) {
  const titleFor = (name) => humanize(name || 'Report')
  const hasAny = reports.length > 0 || showWorkforceTargets
  return <div className="platform-page"><div className="platform-page-heading"><div><div className="platform-eyebrow">Workspace / Insights</div><h1>Reports</h1><p>Live metrics from the reporting catalog.</p></div></div>{loading ? <div className="platform-table-loading"><div className="platform-spinner" /> Loading reports…</div> : hasAny ? <div className="platform-report-grid">{reports.map((report) => <section className="platform-panel platform-report-card" key={report.name || report.id}><div className="platform-panel-heading"><div><h2>{titleFor(report.name || report.id)}</h2><p>{report.description || 'Current workspace metrics'}</p></div></div><dl>{Object.entries(report.metrics || {}).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{typeof value === 'number' ? value.toLocaleString() : Array.isArray(value) ? value.length : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</dd></div>)}</dl></section>)}{showWorkforceTargets && <WorkforceTargetsReport report={workforceTargetReport} loading={workforceTargetLoading} error={workforceTargetError} />}</div> : <EmptyState title="No reports available" description="Reports appear when reporting is enabled and your role has access." />}</div>
}

function WorkforceTargetsReport({ report, loading, error }) {
  const periods = Array.isArray(report?.periods) ? report.periods : []
  const rows = Array.isArray(report?.series) ? report.series : Array.isArray(report?.series?.rows) ? report.series.rows : Array.isArray(report?.series?.data) ? report.series.data : []
  const periodName = (period) => typeof period === 'string' || typeof period === 'number' ? String(period) : period?.label || period?.period || period?.name || period?.id || ''
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const selectedRows = selectedPeriod ? rows.filter((row) => String(row.period ?? row.periodId ?? '') === selectedPeriod || String(row.periodLabel ?? '') === selectedPeriod) : rows
  const summaryEntries = Object.entries(report?.summary || {}).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  return <section className="platform-panel platform-report-card platform-workforce-report">
    <div className="platform-panel-heading"><div><h2>Workforce targets</h2><p>Hiring targets compared with actual hires by period, department, location, and role.</p></div></div>
    {loading ? <div className="platform-table-loading"><div className="platform-spinner" /> Loading workforce targets…</div> : error ? <div className="platform-inline-error" role="alert">{error}</div> : !report ? <EmptyState title="No workforce target data" description="The workforce targets report is not available yet." /> : <>
      {summaryEntries.length > 0 && <dl className="platform-workforce-summary">{summaryEntries.map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{typeof value === 'number' ? value.toLocaleString() : String(value ?? '—')}</dd></div>)}</dl>}
      {periods.length > 0 && <label className="platform-workforce-period"><span>Period</span><select aria-label="Filter workforce targets by period" value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}><option value="">All periods</option>{periods.map((period, index) => <option key={`${periodName(period)}-${index}`} value={periodName(period)}>{periodName(period)}</option>)}</select></label>}
      {selectedRows.length ? <div className="platform-workforce-table-wrap"><table className="platform-workforce-table"><thead><tr><th>Period</th><th>Department</th><th>Location</th><th>Role</th><th>Target</th><th>Actual</th></tr></thead><tbody>{selectedRows.map((row, index) => <tr key={row.id || `${row.period}-${row.department}-${row.location}-${row.role}-${index}`}><td>{row.periodLabel || row.period || row.periodId || '—'}</td><td>{row.department || row.departmentName || '—'}</td><td>{row.location || row.locationName || '—'}</td><td>{row.role || row.roleName || '—'}</td><td>{Number(row.target ?? row.targetCount ?? 0).toLocaleString()}</td><td>{Number(row.actualHires ?? row.actual ?? row.actualCount ?? row.hired ?? 0).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title="No workforce targets yet" description="Add targets by period, department, location, and role to compare planned hires with actuals." />}
    </>}
  </section>
}

function ReferralForm({ jobs, busy, onCancel, onSubmit }) {
  const [candidate, setCandidate] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [jobId, setJobId] = useState('')
  const [consent, setConsent] = useState(false)
  return <form className="platform-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ candidate, jobId, consent }) }}><p className="platform-form-intro">Share candidate details and confirm you have permission to submit this referral.</p><div className="platform-form-grid"><FieldControl field={{ key: 'firstName', label: 'First name', type: 'shortText', required: true }} value={candidate.firstName} onChange={(value) => setCandidate((row) => ({ ...row, firstName: value }))} /><FieldControl field={{ key: 'lastName', label: 'Last name', type: 'shortText', required: true }} value={candidate.lastName} onChange={(value) => setCandidate((row) => ({ ...row, lastName: value }))} /><FieldControl field={{ key: 'email', label: 'Email', type: 'email', required: true }} value={candidate.email} onChange={(value) => setCandidate((row) => ({ ...row, email: value }))} /><FieldControl field={{ key: 'phone', label: 'Phone', type: 'phone' }} value={candidate.phone} onChange={(value) => setCandidate((row) => ({ ...row, phone: value }))} /><FieldControl field={{ key: 'jobId', label: 'Job', type: 'singleSelect', required: true, options: jobs.filter((job) => !['closed','filled','archived'].includes(String(job.status || '').toLowerCase())).map((job) => ({ value: job.id, label: job.title || job.name || job.id })) }} value={jobId} onChange={setJobId} /><label className="platform-checkbox platform-field--full"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>I confirm the candidate has agreed to this referral and the use of their information.</span></label></div><footer><button type="button" className="platform-button" onClick={onCancel}>Cancel</button><button className="platform-button platform-button--primary" disabled={busy || !consent}>{busy ? 'Submitting…' : 'Submit referral'}</button></footer></form>
}

function EntityPage({ kind, meta, label, records, allRecords, query, setQuery, loading, user, config, savedViewUsers = [], onCreate, onEdit, onSelect, onAction, onExport, onPreviewInvoice, onPreviewOffer, onRefresh }) {
  const canCreate = hasPermission(user, kind, 'create') && !['audit','notifications','onboarding','automations'].includes(kind)
  const supportsExport = hasPermission(user, kind, 'export')
  const statuses = [...new Set(allRecords.map((record) => String(record.status || '').trim()).filter(Boolean))]
  const stages = [...new Set(allRecords.map((record) => String(record.stage || '').trim()).filter(Boolean))]
  const [statusFilter, setStatusFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [agingMin, setAgingMin] = useState('')
  const [ageNow, setAgeNow] = useState(0)
  const [savedViews, setSavedViews] = useState([])
  const [savedRunRows, setSavedRunRows] = useState(null)
  const [activeSavedViewId, setActiveSavedViewId] = useState('')
  const [savedViewError, setSavedViewError] = useState('')
  const [viewEditor, setViewEditor] = useState(null)
  const [viewName, setViewName] = useState('')
  const [viewVisibility, setViewVisibility] = useState('private')
  const [viewBusy, setViewBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkAction, setBulkAction] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [bulkNotice, setBulkNotice] = useState('')
  const savedViewsEnabled = config?.savedViews?.enabled !== false && config?.modules?.savedViews !== false
  const canUseSavedViews = savedViewsEnabled && SAVED_VIEW_KINDS.has(kind) && hasPermission(user, kind, 'view')
  const bulkKinds = ['candidates','jobs','applications','tasks']
  const bulkActions = bulkKinds.includes(kind) ? [
    ...(kind === 'candidates' && hasPermission(user, kind, 'edit') ? ['addTags'] : []),
    ...(hasPermission(user, kind, 'edit') ? ['assignOwner'] : []),
    ...(['candidates','jobs'].includes(kind) && hasPermission(user, kind, 'edit') ? ['archive'] : []),
    ...(kind === 'applications' && hasPermission(user, kind, 'edit') ? ['moveStage'] : []),
  ] : []
  const bulkOwners = savedViewUsers.filter((person) => person?.id)
  const bulkValueRequired = ['assignOwner','moveStage'].includes(bulkAction)
  useEffect(() => { setSelectedIds([]); setBulkAction(''); setBulkValue(''); setBulkError(''); setBulkNotice('') }, [kind])
  useEffect(() => { setSelectedIds((current) => { const next = current.filter((id) => visible.some((row) => String(row.id) === String(id))); return next.length === current.length ? current : next }) }, [visible])
  const runBulkAction = async () => {
    if (!bulkAllowed || bulkBusy || !selectedIds.length || (bulkValueRequired && !bulkValue)) return
    if (['archive','moveStage'].includes(bulkAction)) {
      const message = bulkAction === 'archive' ? `Archive ${selectedIds.length} selected ${meta.singular.toLowerCase()}${selectedIds.length === 1 ? '' : 's'}?` : `Move ${selectedIds.length} selected applications to ${bulkStages.find((stage) => String(stage.value) === String(bulkValue))?.label || 'the selected stage'}?`
      if (!window.confirm(message)) return
    }
    setBulkBusy(true); setBulkError(''); setBulkNotice('')
    try {
      const payload = bulkAction === 'addTags' ? { tags: bulkValue.split(',').map((tag) => tag.trim()).filter(Boolean) } : bulkAction === 'assignOwner' ? { ownerId: bulkValue } : bulkAction === 'moveStage' ? { stage: bulkValue } : {}
      await platformRequest(`/bulk/${encodeURIComponent(kind)}`, { method: 'POST', body: { data: { ids: selectedIds, action: bulkAction, payload } } })
      setSelectedIds([]); setBulkValue(''); setBulkAction('')
      setBulkNotice(`${humanize(bulkAction)} completed for ${selectedIds.length} ${selectedIds.length === 1 ? 'record' : 'records'}.`)
      await onRefresh?.()
    } catch (requestError) { setBulkError(requestError.message || 'Bulk action failed.') }
    finally { setBulkBusy(false) }
  }
  useEffect(() => { setAgeNow(Date.now()) }, [])
  useEffect(() => {
    let current = true
    if (canUseSavedViews) platformApi.savedViews().then((rows) => { if (current) setSavedViews((Array.isArray(rows) ? rows : []).filter((view) => view.kind === kind)) }).catch((error) => { if (current && error.status !== 403) setSavedViewError(error.message) })
    else { setSavedViews([]); setSavedRunRows(null); setActiveSavedViewId('') }
    return () => { current = false }
  }, [canUseSavedViews, kind])
  const visible = (savedRunRows || records).filter((record) => {
    if (query && !JSON.stringify(record).toLowerCase().includes(query.toLowerCase())) return false
    if (statusFilter && String(record.status || '') !== statusFilter) return false
    if (stageFilter && String(record.stage || '') !== stageFilter) return false
    if (ownerFilter && !ownerFieldsForView.some((field) => record[field] === (ownerFilter === 'me' ? user?.id : ownerFilter))) return false
    if (agingMin !== '' && ageNow > 0) {
      const stamp = Date.parse(savedViewAgeAnchor(record, kind))
      if (!Number.isFinite(stamp) || Math.max(0, Math.floor((ageNow - stamp) / 86400000)) < Number(agingMin)) return false
    }
    return true
  })
  const activeFilters = () => ({
    ...(query.trim() ? { query: query.trim() } : {}),
    ...(ownerFilter ? { owner: ownerFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(stageFilter ? { stage: stageFilter } : {}),
    ...(agingMin !== '' ? { aging: { minDays: Number(agingMin), basis: kind === 'applications' ? 'stageEnteredAt' : 'updatedAt' } } : {}),
  })
  const clearAppliedRows = () => { setSavedRunRows(null); setActiveSavedViewId('') }
  const openViewEditor = (view = null) => {
    setViewEditor(view || {})
    setViewName(view?.name || '')
    setViewVisibility(view?.visibility || 'private')
    setSavedViewError('')
  }
  const saveView = async (event) => {
    event.preventDefault()
    if (!viewName.trim() || viewBusy) return
    setViewBusy(true); setSavedViewError('')
    try {
      const payload = { name: viewName.trim(), kind, visibility: viewVisibility, filters: activeFilters() }
      const saved = viewEditor?.id ? await platformApi.updateSavedView(viewEditor.id, payload) : await platformApi.createSavedView(payload)
      setSavedViews((current) => [saved, ...current.filter((item) => String(item.id) !== String(saved.id))])
      setActiveSavedViewId(saved.id)
      setViewEditor(null)
    } catch (error) { setSavedViewError(error.message) } finally { setViewBusy(false) }
  }
  const runView = async (view) => {
    setSavedViewError(''); setViewBusy(true)
    try {
      const result = await platformApi.runSavedView(view.id)
      setSavedRunRows(Array.isArray(result?.rows) ? result.rows.map(normalizeRecord) : [])
      setActiveSavedViewId(view.id)
      setQuery(view.filters?.query || '')
      setStatusFilter(view.filters?.status || '')
      setStageFilter(view.filters?.stage || '')
      setOwnerFilter(view.filters?.owner || '')
      setAgingMin(view.filters?.aging?.minDays == null ? '' : String(view.filters.aging.minDays))
    } catch (error) { setSavedRunRows(null); setSavedViewError(error.message) } finally { setViewBusy(false) }
  }
  const removeView = async (view) => {
    if (!window.confirm(`Delete saved view “${view.name}”?`)) return
    setSavedViewError(''); setViewBusy(true)
    try { await platformApi.deleteSavedView(view.id); setSavedViews((current) => current.filter((item) => String(item.id) !== String(view.id))) }
    catch (error) { setSavedViewError(error.message) } finally { setViewBusy(false) }
  }
  const headerKeys = kind === 'audit' ? ['action','actor','kind','createdAt'] : kind === 'applications' ? ['candidateName','jobTitle','stage','owner','source'] : kind === 'jobs' ? ['title','department','location','employmentType','status'] : kind === 'candidates' ? ['fullName','email','currentTitle','location','source'] : kind === 'approvals' ? ['title','workflow','requester','status'] : kind === 'interviews' ? ['candidateName','jobTitle','round','scheduledAt','status'] : kind === 'offers' ? ['candidateName','jobTitle','salary','status','expiresAt'] : kind === 'tasks' ? ['title','owner','dueDate','priority','status'] : kind === 'notifications' ? ['title','message','category','read'] : (meta.fields || []).slice(0,5).map(([key]) => key)
  const title = kind === 'audit' ? 'Activity & audit' : label
  const description = kind === 'candidates' ? 'Build relationships with talent and keep candidate information organized.' : kind === 'jobs' ? 'Create openings, manage approvals and publish roles to your careers site.' : kind === 'applications' ? 'Review applicants and guide them through your configured hiring pipelines.' : kind === 'requisitions' ? 'Request new headcount and track approvals through to job creation.' : `Manage ${label.toLowerCase()} across your hiring workspace.`
  const configuredPipelines = Array.isArray(config?.pipelines) ? config.pipelines : Object.values(config?.pipelines || {})
  const applicationPipeline = configuredPipelines.find((item) => item.id === records[0]?.pipelineId) || configuredPipelines.find((item) => item.default || item.isDefault) || configuredPipelines[0]
  const bulkStages = (applicationPipeline?.stages || applicationPipeline?.steps || []).map((stage) => ({ value: stage.id || stage.key || stage.name || stage.label, label: stage.name || stage.label || stage.id }))
  const bulkAllowed = bulkActions.includes(bulkAction) && (bulkAction !== 'assignOwner' || bulkOwners.length > 0) && (bulkAction !== 'moveStage' || bulkStages.length > 0)
  const counts = kind === 'applications' ? (applicationPipeline?.stages || applicationPipeline?.steps || []) : []
  return <div className="platform-page"><div className="platform-page-heading"><div><div className="platform-eyebrow">Workspace / {label}</div><h1>{title}</h1><p>{description}</p></div><div className="platform-heading-actions">{supportsExport && <button className="platform-button" onClick={onExport}><Download size={15} /> Export</button>}{canCreate && <button className="platform-button platform-button--primary" onClick={onCreate}><Plus size={16} /> {kind === 'referrals' ? 'Submit a referral' : `Add ${meta.singular.toLowerCase()}`}</button>}</div></div>
    {kind === 'applications' && Array.isArray(counts) && counts.length > 0 && <div className="platform-stage-strip">{counts.map((stage,index) => { const stageKey = stage.id || stage.key || stage.name || stage.label; const count = allRecords.filter((record) => record.pipelineId === applicationPipeline?.id && [stageKey, stage.name, stage.label].includes(record.stage)).length; return <span key={stageKey || index}>{stage.name || stage.label}<small>{count}</small><b>{index < counts.length - 1 && <ArrowRight size={12} />}</b></span> })}</div>}
    <div className="platform-list-toolbar"><label className="platform-list-search"><Search size={16} /><input placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(event) => { clearAppliedRows(); setQuery(event.target.value) }} /></label><div className="platform-toolbar-right">
      {statuses.length > 0 && <label className="platform-filter-select"><Filter size={14} /><select aria-label="Filter by status" value={statusFilter} onChange={(event) => { clearAppliedRows(); setStatusFilter(event.target.value) }}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>}
      {kind === 'applications' && stages.length > 0 && <label className="platform-filter-select"><select aria-label="Filter by pipeline stage" value={stageFilter} onChange={(event) => { clearAppliedRows(); setStageFilter(event.target.value) }}><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>}
      {canUseSavedViews && <button className="platform-button platform-button--small" onClick={() => openViewEditor()}><Filter size={13} /> Save view</button>}
      <span className="platform-record-count">{visible.length} {visible.length === 1 ? 'record' : 'records'}</span></div></div>
    {bulkActions.length > 0 && <section className="platform-bulk-toolbar" aria-label="Bulk actions">
      <label><input type="checkbox" aria-label="Select all visible records" checked={visible.length > 0 && visible.every((record) => selectedIds.includes(String(record.id)))} onChange={(event) => setSelectedIds(event.target.checked ? visible.map((record) => String(record.id)) : [])} /> Select visible</label>
      <span className="platform-bulk-count">{selectedIds.length} selected</span>
      <select aria-label="Bulk action" value={bulkAction} onChange={(event) => { setBulkAction(event.target.value); setBulkValue(''); setBulkError(''); setBulkNotice('') }}><option value="">Choose action</option>{bulkActions.map((action) => <option key={action} value={action}>{humanize(action)}</option>)}</select>
      {bulkAction === 'addTags' && <input aria-label="Tags to add" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder="Tags, separated by commas" maxLength={500} />}
      {bulkAction === 'assignOwner' && <select aria-label="Owner" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Choose owner</option>{bulkOwners.map((person) => <option key={person.id} value={person.id}>{person.name || person.email || person.id}</option>)}</select>}
      {bulkAction === 'moveStage' && <select aria-label="Destination stage" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Choose stage</option>{bulkStages.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select>}
      <button className="platform-button platform-button--small platform-button--primary" disabled={!selectedIds.length || !bulkAllowed || bulkBusy || (bulkValueRequired && !bulkValue) || (bulkAction === 'addTags' && !bulkValue.trim())} onClick={runBulkAction}>{bulkBusy ? 'Working…' : 'Apply'}</button>
      {bulkError && <span className="platform-inline-error" role="alert">{bulkError}</span>}{bulkNotice && <span className="platform-special-success" role="status">{bulkNotice}</span>}
    </section>}
    {canUseSavedViews && <section className="platform-saved-views" aria-label="Saved views">
      {savedViewError && <p className="platform-inline-error" role="alert">{savedViewError}</p>}
      <div className="platform-saved-view-filters">
        <label className="platform-filter-select"><span>Owner</span><select aria-label="Filter by owner" value={ownerFilter} onChange={(event) => { clearAppliedRows(); setOwnerFilter(event.target.value) }}><option value="">Anyone</option><option value="me">Assigned to me</option>{savedViewUsers.filter((person) => person.id !== user?.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="platform-filter-select"><span>Aged at least</span><select aria-label="Filter by record age" value={agingMin} onChange={(event) => { clearAppliedRows(); setAgingMin(event.target.value) }}><option value="">Any age</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
      </div>
      {savedViews.length > 0 && <div className="platform-saved-view-list"><span>Saved views</span>{savedViews.map((view) => <div className={`platform-saved-view-chip ${savedRunRows && view.id === activeSavedViewId ? 'is-active' : ''}`} key={view.id}><button className="platform-saved-view-run" disabled={viewBusy} onClick={() => runView(view)}>{view.name}<small>{view.visibility === 'shared' ? 'Shared' : 'Private'}</small></button>{view.ownerId === user?.id && <><button className="platform-saved-view-tool" disabled={viewBusy} onClick={() => openViewEditor(view)} aria-label={`Edit ${view.name}`} title="Edit view"><Settings2 size={13} /></button><button className="platform-saved-view-tool" disabled={viewBusy} onClick={() => removeView(view)} aria-label={`Delete ${view.name}`} title="Delete view"><X size={13} /></button></>}</div>)}</div>}
      {query && <small className="platform-saved-view-help">Text search is included when you save this view.</small>}
      {viewEditor && <form className="platform-saved-view-editor" onSubmit={saveView}><div><strong>{viewEditor.id ? 'Update saved view' : 'Save current filters'}</strong><button type="button" className="platform-icon-button" onClick={() => setViewEditor(null)} aria-label="Close saved view editor"><X size={15} /></button></div><label>View name<input value={viewName} onChange={(event) => setViewName(event.target.value)} maxLength={80} required placeholder="e.g. My open candidates" /></label><label>Visibility<select value={viewVisibility} onChange={(event) => setViewVisibility(event.target.value)}><option value="private">Only me</option>{config?.savedViews?.allowShared !== false && <option value="shared">Share with team</option>}</select></label><p>Includes text search, owner, status, stage and aging filters selected on this list.</p><footer><button type="button" className="platform-button platform-button--small" onClick={() => setViewEditor(null)}>Cancel</button><button className="platform-button platform-button--primary platform-button--small" disabled={viewBusy || !viewName.trim()}>{viewBusy ? 'Saving…' : viewEditor.id ? 'Update view' : 'Save view'}</button></footer></form>}
    </section>}
    <div className="platform-table-wrap">{loading ? <div className="platform-table-loading"><div className="platform-spinner" /> Loading {label.toLowerCase()}…</div> : visible.length ? <table className="platform-table"><thead><tr>{bulkActions.length > 0 && <th><span className="platform-sr-only">Select</span></th>}{headerKeys.map((key) => <th key={key}>{humanize(key)}</th>)}<th><span className="platform-sr-only">Actions</span></th></tr></thead><tbody>{visible.map((record) => <tr key={record.id} onClick={() => onSelect(record)}>{bulkActions.length > 0 && <td className="platform-bulk-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${displayName(record,kind)}`} checked={selectedIds.includes(String(record.id))} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, String(record.id)])] : current.filter((id) => id !== String(record.id)))} /></td>}<td className="platform-primary-cell"><button onClick={(event) => { event.stopPropagation(); onSelect(record) }}>{kind === 'candidates' ? displayName(record, kind) : read(record,[headerKeys[0],'name','title','id']) || displayName(record,kind)}</button>{(record.email || record.subtitle) && <small>{record.email || record.subtitle}</small>}</td>{headerKeys.slice(1).map((key) => <td key={key}>{renderCell(record,key,config)}</td>)}<td className="platform-row-actions" onClick={(event) => event.stopPropagation()}><div className="platform-row-action-buttons">{kind === 'invoices' && hasPermission(user, kind, 'view') && <button className="platform-row-action" onClick={() => onPreviewInvoice(record)}>Preview</button>}{kind === 'offers' && canPreviewOffer(user, config) && <button className="platform-row-action" onClick={() => onPreviewOffer(record)}>Preview document</button>}{(meta.actions || []).filter((action) => canRunAction(user, kind, action)).map((action) => <button className="platform-row-action" key={action} onClick={() => onAction(record, action)}>{humanize(action)}</button>)}<button className="platform-icon-button" aria-label={`More actions for ${displayName(record,kind)}`} onClick={() => onSelect(record)}><MoreHorizontal size={17} /></button></div></td></tr>)}</tbody></table> : <EmptyState title={query || statusFilter || stageFilter || ownerFilter || agingMin ? 'No matching records' : `No ${label.toLowerCase()} yet`} description={query || statusFilter || stageFilter || ownerFilter || agingMin ? 'Try a different search or clear your filters.' : `${description} Your changes will be saved in the local workspace.`} action={canCreate && !query ? <button className="platform-button platform-button--primary" onClick={onCreate}><Plus size={15} /> Add {meta.singular.toLowerCase()}</button> : null} />}</div>
  </div>
}

function renderCell(record,key,config) {
  let value = record[key]
  if (key === 'fullName') value = displayName(record,'candidates')
  if (key === 'scheduledAt' || (key === 'expiresAt' && record.expiresAt && String(record.expiresAt).includes('T')) || (key === 'dueDate' && record.dueDate && String(record.dueDate).includes('T'))) value = value ? formatRegionalDateTime(value, config?.regional) : ''
  else if (key === 'createdAt' || key === 'updatedAt' || key.toLowerCase().includes('date')) value = value ? formatRegionalDate(value, config?.regional) : ''
  if (key === 'salary' || key === 'amount' || key === 'budget' || key === 'fee') value = value === undefined ? '' : new Intl.NumberFormat(config?.regional?.numberLocale || config?.regional?.language || undefined,{style:'currency',currency:record.currency || config?.regional?.currency || 'USD',maximumFractionDigits:0}).format(Number(value))
  if (['status','stage','priority','read'].includes(key) && value !== undefined) return <span className={`platform-status platform-status--${String(value).toLowerCase().replace(/[^a-z]+/g,'-')}`}>{badgeValue(value === true ? 'Read' : value === false ? 'Unread' : value)}</span>
  if (Array.isArray(value)) value = value.join(', ')
  if (typeof value === 'object' && value) value = value.label || value.name || JSON.stringify(value)
  return <span className="platform-cell-text">{value ?? '—'}</span>
}

function ActionForm({ action, kind, record, values, setValues, onSubmit, onCancel, busy, config }) {
  const [mergeCandidates, setMergeCandidates] = useState([])
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState('')
  const [mergeQuery, setMergeQuery] = useState('')
  useEffect(() => {
    if (action !== 'merge' || kind !== 'candidates') return
    let active = true
    setMergeLoading(true)
    setMergeError('')
    platformApi.list('candidates').then((rows) => {
      if (active) setMergeCandidates((Array.isArray(rows) ? rows : rows?.records || []).map(normalizeRecord).filter((candidate) => String(candidate.id) !== String(record?.id)))
    }).catch((error) => { if (active) setMergeError(error.status === 403 ? 'You do not have permission to view candidates to merge into.' : error.message || 'Candidates could not be loaded.') })
      .finally(() => { if (active) setMergeLoading(false) })
    return () => { active = false }
  }, [action, kind, record?.id])
  const pipelineConfig = config?.pipelines || []
  const pipelines = Array.isArray(pipelineConfig) ? pipelineConfig : Object.values(pipelineConfig)
  const pipeline = pipelines.find((item) => item.id === (record?.pipelineId || record?.job?.pipelineId)) || pipelines.find((item) => item.default || item.isDefault) || pipelines[0]
  const stages = pipeline?.stages || pipeline?.steps || []
  const currentStage = stages.find((stage) => [stage.id, stage.key, stage.name, stage.label].includes(record?.stage))
  const transitions = pipeline?.transitions || []
  const permittedStages = currentStage && transitions.length ? transitions.filter((transition) => transition.from === (currentStage.id || currentStage.key || currentStage.name)).map((transition) => transition.to) : []
  const choices = (permittedStages.length ? stages.filter((stage) => permittedStages.includes(stage.id || stage.key || stage.name) || permittedStages.includes(stage.name || stage.label)) : stages).filter((stage) => (stage.id || stage.key || stage.name) !== record?.stage)
  const fields = {
    'move-stage': [{ key: 'stage', label: 'Move to stage', type: 'singleSelect', required: true, options: choices.map((stage) => ({ value: stage.id || stage.key || stage.name, label: stage.name || stage.label || stage.id })) }, { key:'reason',label:'Note',type:'longText' }],
    reject: [{ key:'reason',label:'Reason',type:'longText',required:true }],
    'submit-feedback': [
      ...(config?.scorecards?.find((item) => item.id === record?.scorecardId)?.competencies || config?.scorecards?.find((item) => item.id === record?.scorecardId)?.criteria || config?.scorecards?.[0]?.competencies || config?.scorecards?.[0]?.criteria || []).map((item) => ({ key: `rating_${item.id || item.key || item.name}`, label: item.name || item.label || item.id, type: 'number', min: config?.scorecards?.[0]?.ratingScale?.min || 1, max: config?.scorecards?.[0]?.ratingScale?.max || 5, required: item.required !== false })),
      { key:'recommendation',label:'Recommendation',type:'singleSelect',required:true,options:(config?.scorecards?.[0]?.recommendations || ['strong-yes','yes','lean-yes','lean-no','no','strong-no']).map((value)=>({value,label:humanize(value)})) },
      { key:'comments',label:'Written feedback',type:'longText',required:true },
    ],
    reschedule: [{key:'scheduledAt',label:'New date and time',type:'datetimeLocal',required:true}],
    hire: [{ key:'joiningDate',label:'Joining date',type:'date',required:true }],
    invoice: [{ key:'dueDate',label:'Due date',type:'date',required:true }],
    place: [{ key:'startDate',label:'Placement start date',type:'date',required:true },{ key:'fee',label:'Placement fee',type:'number',required:true,min:0 },{ key:'feeType',label:'Fee type',type:'singleSelect',required:true,options:(config?.agency?.feeTypes || ['fixed','percentage','retainer']).map((value)=>({value,label:humanize(value)})) }],
    delegate: [{key:'userId',label:'Delegate to',type:'singleSelect',required:true,options:(config?.users || []).filter((user) => user.id !== record?.createdBy).map((user) => ({value:user.id,label:user.name}))},{key:'comment',label:'Comment',type:'longText'}],
    'add-note': [{key:'body',label:'Note',type:'longText',required:true},{key:'visibility',label:'Visibility',type:'singleSelect',options:[{value:'team',label:'Team'},{value:'private',label:'Private'}]}],
    default: [{key:'comment',label:'Comment',type:'longText'}],
  }[action] || [{key:'comment',label:'Comment',type:'longText'}]
  const needsConfirm = ['approve','reject','hire','accept','decline','withdraw','archive','publish','pause','close','complete','start','run','submit','mark-read','invoice','merge'].includes(action)
  const isCandidateMerge = action === 'merge' && kind === 'candidates'
  const matchingMergeCandidates = mergeCandidates.filter((candidate) => !mergeQuery.trim() || `${displayName(candidate, kind)} ${candidate.email || ''} ${candidate.currentTitle || ''} ${candidate.id || ''}`.toLowerCase().includes(mergeQuery.trim().toLowerCase()))
  return <form className="platform-form platform-action-form" onSubmit={(event) => { event.preventDefault(); const payload = { ...values }; if (action === 'submit-feedback') { payload.answers = Object.fromEntries(fields.filter((field) => field.key.startsWith('rating_')).map((field) => [field.key.slice(7), Number(values[field.key])]).filter(([, value]) => Number.isFinite(value))); payload.completeInterview = true } if (isCandidateMerge && !payload.targetId) return; onSubmit(payload) }}><p className="platform-form-intro">{isCandidateMerge ? <>Select the <strong>primary candidate</strong> to keep. <strong>{displayName(record, kind)}</strong> will be treated as the duplicate: their applications will be reassigned, some profile details combined, and the duplicate archived.</> : action === 'move-stage' ? 'Choose the next stage. Your configured pipeline rules will be checked before the move.' : action === 'approve' ? 'This decision will be recorded in the approval history.' : `This will ${humanize(action).toLowerCase()} ${displayName(record,kind)}.`}</p>{kind === 'interviews' && action === 'reschedule' && <p className="platform-form-intro">Times use {config?.regional?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}, the workspace IANA timezone.</p>}{isCandidateMerge ? <><label className="platform-field"><span>Search readable candidates</span><input type="search" value={mergeQuery} onChange={(event) => setMergeQuery(event.target.value)} placeholder="Name, email, title, or ID" /></label><label className="platform-field"><span>Primary candidate to keep <b className="platform-required">*</b></span><select required value={values.targetId || ''} disabled={mergeLoading || !!mergeError} onChange={(event) => setValues((current) => ({ ...current, targetId: event.target.value }))}><option value="">{mergeLoading ? 'Loading candidates…' : 'Choose primary candidate'}</option>{matchingMergeCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate, kind)}{candidate.email ? ` · ${candidate.email}` : ''}</option>)}</select></label>{mergeError && <p className="platform-inline-error" role="alert">{mergeError}</p>}{!mergeLoading && !mergeError && !matchingMergeCandidates.length && <p className="platform-form-intro">No other readable candidates match this search.</p>}<p className="platform-form-intro">The primary candidate stays active. The selected record ({displayName(record, kind)}) is archived after related applications are moved. This cannot be undone from this screen.</p></> : fields.map((field) => <FieldControl key={field.key} field={field} value={values[field.key]} onChange={(value) => setValues((current) => ({...current,[field.key]:value}))} />)}<footer><button type="button" className="platform-button" onClick={onCancel}>Cancel</button><button className={`platform-button ${['reject','decline','withdraw','archive','merge'].includes(action) ? 'platform-button--danger' : 'platform-button--primary'}`} disabled={busy || (isCandidateMerge && (mergeLoading || !!mergeError || !matchingMergeCandidates.length || !values.targetId || String(values.targetId) === String(record?.id)))}>{busy ? 'Working…' : isCandidateMerge ? 'Merge into primary candidate' : `${needsConfirm ? humanize(action) : 'Save'}${['approve','reject'].includes(action) ? ' request' : ''}`}</button></footer></form>
}

function RecordDrawer({ kind, meta, record, config, onClose, onEdit, onAction, onDelete, onPreviewInvoice, onPreviewOffer, onChecklistChange, onRecordChange, loading, user }) {
  const data = record || {}
  const configuredReferralMilestones = Array.isArray(config?.referrals?.milestones) ? config.referrals.milestones.filter((value) => typeof value === 'string' && value.trim()) : []
  const configuredPayoutStatuses = Array.isArray(config?.referrals?.payoutStatuses) ? config.referrals.payoutStatuses.filter((value) => typeof value === 'string' && value.trim()) : []
  const completedReferralMilestones = Array.isArray(data.milestonesCompleted) ? data.milestonesCompleted.map((item) => String(typeof item === 'string' ? item : item?.key || '').toLowerCase()) : []
  const availableReferralMilestones = configuredReferralMilestones.filter((milestone) => !completedReferralMilestones.includes(milestone.toLowerCase()))
  const onboardingChecklist = data.checklist || data.checklistItems || data.items || []
  const incompleteRequiredItems = onboardingChecklist.filter((item) => item.required !== false && !(Boolean(item.completed) || ['done','complete','completed'].includes(String(item.status || '').toLowerCase())))
  const onboardingRequiredIncomplete = Number.isFinite(Number(data.checklistSummary?.requiredIncomplete)) ? Number(data.checklistSummary.requiredIncomplete) : incompleteRequiredItems.length
  const onboardingComplete = String(data.status || '').toLowerCase() === 'completed'
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')
  const [notes, setNotes] = useState([])
  const [documents, setDocuments] = useState([])
  const [documentVersions, setDocumentVersions] = useState({})
  const [versionExpanded, setVersionExpanded] = useState({})
  const [versionLoading, setVersionLoading] = useState({})
  const [documentBusy, setDocumentBusy] = useState(false)
  const [documentError, setDocumentError] = useState('')
  const [documentNotice, setDocumentNotice] = useState('')
  const [replacementFiles, setReplacementFiles] = useState({})
  const [newDocument, setNewDocument] = useState({ file: null, category: '', visibility: '' })
  const [tasks, setTasks] = useState([])
  const [sideLoading, setSideLoading] = useState(false)
  const [sideError, setSideError] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [noteVisibility, setNoteVisibility] = useState('team')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const [checklistBusy, setChecklistBusy] = useState('')
  const [specialBusy, setSpecialBusy] = useState(false)
  const [specialError, setSpecialError] = useState('')
  const [specialNotice, setSpecialNotice] = useState('')
  const [payoutStatusChoice, setPayoutStatusChoice] = useState(data.payoutStatus || '')
  const [feedbackValues, setFeedbackValues] = useState({})
  const [guaranteeReason, setGuaranteeReason] = useState('')
  const [guaranteeComment, setGuaranteeComment] = useState('')
  const [replacement, setReplacement] = useState({ candidateId: '', jobId: '', notes: '' })
  const [poolCandidateId, setPoolCandidateId] = useState('')
  const [poolNote, setPoolNote] = useState('')
  const [poolFollowUpAt, setPoolFollowUpAt] = useState('')
  const [poolCandidates, setPoolCandidates] = useState([])
  const [poolMemberEdits, setPoolMemberEdits] = useState({})
  const [replacementJobs, setReplacementJobs] = useState([])
  const [submittedFeedback, setSubmittedFeedback] = useState(null)
  const [rediscoveredCandidates, setRediscoveredCandidates] = useState([])
  const [duplicateMatches, setDuplicateMatches] = useState([])
  const [duplicateScanned, setDuplicateScanned] = useState(false)
  const [duplicateLoading, setDuplicateLoading] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')
  const [clientContracts, setClientContracts] = useState([])
  const [contractLoading, setContractLoading] = useState(false)
  const [contractError, setContractError] = useState('')
  const [contractForm, setContractForm] = useState(null)
  const relatedField = kind === 'candidates' ? 'candidateId' : kind === 'jobs' ? 'jobId' : null
  const canReadAudit = hasPermission(user, 'audit', 'view')
  const canReadNotes = Boolean(relatedField && hasPermission(user, 'notes', 'view'))
  const canCreateNotes = Boolean(relatedField && hasPermission(user, 'notes', 'create'))
  const supportsDocuments = ['candidates', 'jobs', 'applications', 'offers', 'onboarding', 'clients'].includes(kind)
  const canReadDocuments = Boolean(supportsDocuments && hasPermission(user, 'documents', 'view'))
  const canReplaceDocuments = canReadDocuments && hasPermission(user, 'documents', 'create') && config?.documents?.allowReplacement === true
  const canUploadDocuments = canReadDocuments && hasPermission(user, 'documents', 'create')
  const documentConfig = config?.documents || {}
  const configuredDocumentCategories = documentConfig.categories || config?.taxonomies?.documentCategories || []
  const documentCategories = Array.isArray(configuredDocumentCategories) && configuredDocumentCategories.length ? configuredDocumentCategories : ['Other']
  const configuredVisibilities = documentConfig.allowedVisibilities || documentConfig.visibilityOptions || documentConfig.visibilities
  const documentVisibilities = Array.isArray(configuredVisibilities) && configuredVisibilities.length ? configuredVisibilities : ['public', 'restricted', 'private', 'internal', 'team']
  const defaultDocumentVisibility = documentVisibilities.includes(documentConfig.defaultVisibility) ? documentConfig.defaultVisibility : (documentVisibilities.includes('restricted') ? 'restricted' : documentVisibilities[0])
  const documentMaxBytes = Number(documentConfig.maxFileSizeBytes) > 0 ? Number(documentConfig.maxFileSizeBytes) : (Number(documentConfig.maxFileSizeMb ?? documentConfig.maxFileSizeMB ?? documentConfig.maxFileSize) > 0 ? Number(documentConfig.maxFileSizeMb ?? documentConfig.maxFileSizeMB ?? documentConfig.maxFileSize) * 1024 * 1024 : 20 * 1024 * 1024)
  const canReadTasks = Boolean(relatedField && hasPermission(user, 'tasks', 'view'))
  const canCreateTasks = Boolean(relatedField && hasPermission(user, 'tasks', 'create'))
  const canEditTasks = hasPermission(user, 'tasks', 'edit')
  const safeEntries = Object.entries(data).filter(([key,value]) => !['id','createdAt','updatedAt','organizationId','tenantId'].includes(key) && value !== undefined && value !== null && typeof value !== 'object')
  const privateKeys = ['salary','compensation','salaryExpectation','currentCompensation','privateNotes','financialInfo','agencyFee']
  const canSeeSensitive = !Array.isArray(config?.permissions?.sensitiveFields) || config.permissions.sensitiveFields.includes('*') || config.permissions.sensitiveFields.includes(kind)
  const actions = (meta.actions || []).filter((action) => action !== 'submit-feedback' && canRunAction(user, kind, action))
  const canScanDuplicates = kind === 'candidates' && hasPermission(user, kind, 'edit')
  const scanDuplicates = async () => {
    setDuplicateLoading(true); setDuplicateError(''); setDuplicateMatches([]); setDuplicateScanned(false)
    try {
      const matches = await platformApi.findDuplicates('candidates', data)
      setDuplicateMatches(Array.isArray(matches) ? matches : matches?.matches || [])
      setDuplicateScanned(true)
    } catch (error) { setDuplicateError(error.status === 403 ? 'You do not have permission to scan candidate records.' : error.message || 'Duplicate scan failed.') }
    finally { setDuplicateLoading(false) }
  }
  const scorecard = (config?.scorecards || []).find((item) => String(item.id) === String(data.scorecardId)) || (config?.scorecards || []).find((item) => item.isDefault || item.default)
  const scoreCriteria = scorecard?.competencies || scorecard?.criteria || scorecard?.dimensions || []
  const feedbackRecord = submittedFeedback || data.feedback || null
  const feedbackLocked = Boolean(data.feedbackSubmitted || data.feedbackStatus === 'submitted' || feedbackRecord?.submittedAt || feedbackRecord?.status === 'submitted')
  const scoreMin = Number(scorecard?.ratingScale?.min ?? scorecard?.scale?.min ?? 1)
  const scoreMax = Number(scorecard?.ratingScale?.max ?? scorecard?.scale?.max ?? 5)
  const scoreRecommendations = scorecard?.recommendations || ['strong-yes','yes','lean-yes','lean-no','no','strong-no']
  const poolMembersValue = data.members || data.candidates || data.poolMembers || []
  const poolMembers = Array.isArray(poolMembersValue) ? poolMembersValue : []
  const relatedCandidatesValue = poolCandidates.length ? poolCandidates : (config?.candidateDirectory || config?.candidates || [])
  const relatedCandidates = Array.isArray(relatedCandidatesValue) ? relatedCandidatesValue : []
  const clientContractList = Array.isArray(data.contracts) ? data.contracts : clientContracts
  const canViewClientContracts = kind === 'clients' && moduleOn(config?.modules, 'agency') && config?.agency?.clients !== false && hasPermission(user, 'clients', 'view')
  const canEditClientContracts = canViewClientContracts && hasPermission(user, 'clients', 'edit')
  const findCandidate = (id) => relatedCandidates.find((candidate) => String(candidate.id) === String(id))
  const refreshSpecialRecord = async (kindOverride = kind) => {
    const fresh = normalizeRecord(await platformApi.get(kindOverride, data.id))
    if (fresh.id) onRecordChange?.(fresh)
    return fresh
  }
  useEffect(() => {
    if (!canViewClientContracts) return
    let current = true
    setContractLoading(true); setContractError('')
    platformApi.get('clients', data.id).then((fresh) => {
      if (!current) return
      const normalized = normalizeRecord(fresh)
      setClientContracts(Array.isArray(normalized.contracts) ? normalized.contracts : [])
      if (normalized.id) onRecordChange?.(normalized)
    }).catch((error) => { if (current) setContractError(error.message) }).finally(() => { if (current) setContractLoading(false) })
    return () => { current = false }
  }, [canViewClientContracts, data.id])
  useEffect(() => { setDuplicateMatches([]); setDuplicateError(''); setDuplicateScanned(false) }, [data.id])
  useEffect(() => { setPayoutStatusChoice(data.payoutStatus || '') }, [data.id, data.payoutStatus])
  const saveClientContract = async (event) => {
    event.preventDefault()
    if (!canEditClientContracts || !contractForm) return
    setSpecialBusy(true); setContractError(''); setSpecialNotice('')
    try {
      const body = { version: contractForm.version.trim(), feeType: contractForm.feeType, fee: Number(contractForm.fee), effectiveAt: contractForm.effectiveAt || null, expiresAt: contractForm.expiresAt || null, terms: contractForm.terms.trim() }
      const path = `/clients/${encodeURIComponent(data.id)}/contracts${contractForm.id ? `/${encodeURIComponent(contractForm.id)}` : ''}`
      await platformRequest(path, { method: contractForm.id ? 'PATCH' : 'POST', body: { data: body } })
      const fresh = normalizeRecord(await platformApi.get('clients', data.id))
      setClientContracts(Array.isArray(fresh.contracts) ? fresh.contracts : [])
      if (fresh.id) onRecordChange?.(fresh)
      setContractForm(null); setSpecialNotice('Contract terms saved.')
    } catch (error) { setContractError(error.message) } finally { setSpecialBusy(false) }
  }
  const changeClientContractStatus = async (contract, status) => {
    const verb = status === 'active' ? 'activate' : 'terminate'
    if (!canEditClientContracts || !window.confirm(`Are you sure you want to ${verb} contract ${contract.version || contract.id}?`)) return
    setSpecialBusy(true); setContractError(''); setSpecialNotice('')
    try {
      await platformRequest(`/clients/${encodeURIComponent(data.id)}/contracts/${encodeURIComponent(contract.id)}/status`, { method: 'POST', body: { data: { status } } })
      const fresh = normalizeRecord(await platformApi.get('clients', data.id))
      setClientContracts(Array.isArray(fresh.contracts) ? fresh.contracts : [])
      if (fresh.id) onRecordChange?.(fresh)
      setSpecialNotice(`Contract ${status === 'active' ? 'activated' : 'terminated'}.`)
    } catch (error) { setContractError(error.message) } finally { setSpecialBusy(false) }
  }
  const submitScorecard = async (event) => {
    event.preventDefault(); setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try {
      const criterionKey = (criterion) => typeof criterion === 'string' ? criterion : criterion.id || criterion.key || criterion.name
      const ratings = Object.fromEntries(scoreCriteria.map((criterion) => [criterionKey(criterion), Number(feedbackValues[criterionKey(criterion)])]))
      const missing = scoreCriteria.find((criterion) => (typeof criterion === 'string' || criterion.required !== false) && !Number.isFinite(ratings[criterionKey(criterion)]))
      if (missing || !feedbackValues.recommendation || !String(feedbackValues.comments || '').trim()) throw new Error('Complete each required rating, recommendation, and written feedback before submitting.')
      await platformApi.action('interviews', data.id, 'submit-feedback', { ratings, comments: String(feedbackValues.comments).trim(), recommendation: feedbackValues.recommendation })
      const feedbackRows = await platformApi.list('feedback')
      setSubmittedFeedback((feedbackRows || []).find((item) => String(item.interviewId) === String(data.id) && String(item.interviewerId) === String(user?.id)) || null)
      await refreshSpecialRecord('interviews')
      setSpecialNotice('Feedback submitted and locked.')
    } catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }
  const runPlacementAction = async (action, values) => {
    setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try { await platformApi.action('placements', data.id, action, values); await refreshSpecialRecord('placements'); setSpecialNotice('Placement guarantee updated.') }
    catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }
  const runPoolAction = async (action, values) => {
    setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try { const result = await platformApi.action('talentPools', data.id, action, values); if (action === 'rediscover') setRediscoveredCandidates(Array.isArray(result) ? result : result?.candidates || []); else await refreshSpecialRecord('talentPools'); setSpecialNotice(action === 'rediscover' ? 'Rediscovery completed.' : 'Talent pool updated.') }
    catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }
  const runReferralAction = async (action, values, notice) => {
    setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try { await platformApi.action('referrals', data.id, action, values); await refreshSpecialRecord('referrals'); setSpecialNotice(notice) }
    catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }
  const completeOnboarding = async () => {
    if (!hasPermission(user, 'onboarding', 'edit') || onboardingComplete || specialBusy) return
    setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try { await platformApi.action('onboarding', data.id, 'complete'); await refreshSpecialRecord('onboarding'); setSpecialNotice('Onboarding plan completed.') }
    catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }
  const updatePoolMember = async (candidateId, method, values) => {
    setSpecialBusy(true); setSpecialError(''); setSpecialNotice('')
    try { await platformRequest(`/actions/talentPools/${encodeURIComponent(data.id)}/members/${encodeURIComponent(candidateId)}`, { method, body: method === 'DELETE' ? undefined : { data: values } }); await refreshSpecialRecord('talentPools'); setSpecialNotice(method === 'DELETE' ? 'Member removed.' : 'Member follow-up updated.') }
    catch (error) { setSpecialError(error.message) } finally { setSpecialBusy(false) }
  }

  const reloadSideData = useCallback(async () => {
    if (!data.id || (!canReadAudit && !canReadNotes && !canReadDocuments && !canReadTasks)) return
    setSideLoading(true)
    setSideError('')
    const requests = []
    if (canReadAudit || canReadNotes) {
      setActivityLoading(true)
      setActivityError('')
      requests.push(platformRequest(`/timeline/${encodeURIComponent(kind)}/${encodeURIComponent(data.id)}`)
        .then((result) => ['activity', Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : []])
        .catch((error) => {
          setActivityError(error.status === 403 ? 'You do not have permission to view this activity.' : error.message || 'Activity could not be loaded.')
          return ['activity', []]
        }))
    }
    if (canReadNotes) requests.push(platformApi.list('notes').then((rows) => ['notes', rows.filter((row) => String(row[relatedField] || row.relatedId && row.relatedKind === kind && row.relatedId) === String(data.id))]).catch((error) => { if (error.status !== 403) setSideError(error.message); return ['notes', []] }))
    if (canReadDocuments) requests.push(platformApi.list('documents').then((rows) => ['documents', rows.filter((row) => row.relatedKind === kind && String(row.relatedId) === String(data.id))]).catch((error) => { if (error.status !== 403) setSideError(error.message); return ['documents', []] }))
    if (canReadTasks) requests.push(platformApi.list('tasks').then((rows) => ['tasks', rows.filter((row) => String(row[relatedField] || row.relatedKind === kind && row.relatedId || '') === String(data.id))]).catch((error) => { if (error.status !== 403) setSideError(error.message); return ['tasks', []] }))
    try {
      const results = await Promise.all(requests)
      const values = Object.fromEntries(results)
      setActivity(values.activity || [])
      setNotes(values.notes || [])
      setDocuments(values.documents || [])
      setTasks(values.tasks || [])
      setActivity(values.activity || [])
    } finally { setSideLoading(false); setActivityLoading(false) }
  }, [data.id, kind, relatedField, canReadAudit, canReadNotes, canReadDocuments, canReadTasks])
  useEffect(() => { reloadSideData() }, [reloadSideData])
  useEffect(() => {
    if (kind === 'interviews' && (hasPermission(user, 'feedback', 'view') || hasPermission(user, 'feedback', 'create') || hasPermission(user, 'interviews', 'edit'))) platformApi.list('feedback').then((rows) => setSubmittedFeedback((rows || []).find((item) => String(item.interviewId) === String(data.id) && String(item.interviewerId) === String(user?.id)) || null)).catch((error) => { if (error.status !== 403) setSpecialError(error.message) })
  }, [kind, data.id, user?.id])
  useEffect(() => {
    if (!['talentPools','placements'].includes(kind)) return
    if (hasPermission(user, 'candidates', 'view')) platformApi.list('candidates').then((rows) => setPoolCandidates(Array.isArray(rows) ? rows : [])).catch((error) => { if (error.status !== 403) setSpecialError(error.message) })
    if (kind === 'placements' && hasPermission(user, 'jobs', 'view')) platformApi.list('jobs').then((rows) => setReplacementJobs(Array.isArray(rows) ? rows : [])).catch((error) => { if (error.status !== 403) setSpecialError(error.message) })
  }, [kind, user?.id])

  const addNote = async (event) => {
    event.preventDefault()
    const body = noteBody.trim()
    if (!body || !relatedField) return
    setTaskBusy(true); setSideError('')
    try {
      await platformApi.create('notes', { relatedKind: kind, relatedId: data.id, body, visibility: noteVisibility })
      setNoteBody('')
      await reloadSideData()
    } catch (error) { setSideError(error.message) } finally { setTaskBusy(false) }
  }
  const addTask = async (event) => {
    event.preventDefault()
    const title = taskTitle.trim()
    if (!title || !relatedField) return
    setTaskBusy(true); setSideError('')
    try {
      await platformApi.create('tasks', { [relatedField]: data.id, title, ...(taskDueDate ? { dueDate: taskDueDate } : {}), status: 'open', priority: defaultTaskPriority(config) })
      setTaskTitle(''); setTaskDueDate('')
      await reloadSideData()
    } catch (error) { setSideError(error.message) } finally { setTaskBusy(false) }
  }
  const toggleTask = async (task) => {
    if (!canEditTasks || taskBusy) return
    setTaskBusy(true); setSideError('')
    try { await platformApi.action('tasks', task.id, ['done','completed'].includes(String(task.status).toLowerCase()) ? 'reopen' : 'complete'); await reloadSideData() }
    catch (error) { setSideError(error.message) } finally { setTaskBusy(false) }
  }
  const toggleChecklistItem = async (item) => {
    if (!hasPermission(user, 'onboarding', 'edit') || checklistBusy) return
    const itemId = item.id || item.itemId || item.key
    if (!itemId) return
    setChecklistBusy(String(itemId)); setSideError('')
    try { await onChecklistChange(itemId, ['done','complete','completed'].includes(String(item.status || '').toLowerCase()) || item.completed ? 'pending' : 'completed') }
    catch (error) { setSideError(error.message) }
    finally { setChecklistBusy('') }
  }
  const downloadDocument = async (document) => {
    setDocumentError('')
    try {
      const response = await fetch(`/api/platform/documents/${encodeURIComponent(document.id)}/download`, { headers: { 'X-Demo-User': localStorage.getItem('ats_demo_user') || '' } })
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error?.message || payload?.message || `Download failed (${response.status})`) }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = documentNodeLink(objectUrl, document.filename || document.name || 'document')
      link.click(); link.remove(); URL.revokeObjectURL(objectUrl)
    } catch (error) { setDocumentError(error.message) }
  }
  const loadDocumentVersions = async (document) => {
    const id = String(document.rootDocumentId || document.documentRootId || document.id)
    if (versionLoading[id]) return
    setVersionLoading((current) => ({ ...current, [id]: true }))
    setDocumentError('')
    try {
      const result = await platformApi.documentVersions(document.id)
      const rows = Array.isArray(result) ? result : Array.isArray(result?.versions) ? result.versions : Array.isArray(result?.items) ? result.items : []
      setDocumentVersions((current) => ({ ...current, [id]: rows }))
      setVersionExpanded((current) => ({ ...current, [id]: true }))
    } catch (error) { setDocumentError(error.message || 'Version history could not be loaded.') }
    finally { setVersionLoading((current) => ({ ...current, [id]: false })) }
  }
  const replaceDocument = async (event, document) => {
    event.preventDefault()
    const replacementFile = replacementFiles[String(document.id)]
    if (!replacementFile) { setDocumentError('Choose a file before replacing this document.'); return }
    setDocumentBusy(true); setDocumentError(''); setDocumentNotice('')
    try {
      const payload = await fileAsPayload(replacementFile)
      const response = await platformApi.uploadDocument(kind, data.id, { ...payload, category: document.category, visibility: document.visibility, replacesDocumentId: document.id })
      setReplacementFiles((current) => { const next = { ...current }; delete next[String(document.id)]; return next })
      event.currentTarget.reset()
      setDocumentNotice('A new document version was uploaded.')
      await reloadSideData()
      const rootId = String(document.rootDocumentId || document.documentRootId || document.id)
      const newId = response?.document?.id || response?.id || response?.data?.id
      const refreshedRows = documents.filter((row) => String(row.rootDocumentId || row.documentRootId || row.id) === rootId)
      const targetId = newId || refreshedRows.reduce((latest, row) => Number(row.version || row.versionNumber || 1) > Number(latest.version || latest.versionNumber || 1) ? row : latest, document).id
      setVersionExpanded((current) => ({ ...current, [rootId]: true }))
      setVersionLoading((current) => ({ ...current, [rootId]: true }))
      try {
        const result = await platformApi.documentVersions(targetId)
        const rows = Array.isArray(result) ? result : Array.isArray(result?.versions) ? result.versions : Array.isArray(result?.items) ? result.items : []
        setDocumentVersions((current) => ({ ...current, [rootId]: rows }))
      } finally { setVersionLoading((current) => ({ ...current, [rootId]: false })) }
    } catch (error) { setDocumentError(error.message || 'The replacement could not be uploaded.') }
    finally { setDocumentBusy(false) }
  }
  const uploadDocument = async (event) => {
    event.preventDefault()
    if (!canUploadDocuments) return
    const file = newDocument.file
    if (!file) { setDocumentError('Choose a file before uploading.'); return }
    if (file.size > documentMaxBytes) { setDocumentError(`This file is larger than the ${formatBytes(documentMaxBytes)} upload limit.`); return }
    setDocumentBusy(true); setDocumentError(''); setDocumentNotice('')
    try {
      const payload = await fileAsPayload(file)
      await platformApi.uploadDocument(kind, data.id, { ...payload, category: newDocument.category || documentCategories[0], visibility: newDocument.visibility || defaultDocumentVisibility })
      setNewDocument({ file: null, category: '', visibility: '' })
      event.currentTarget.reset()
      await reloadSideData()
      setDocumentNotice('Document uploaded successfully.')
    } catch (error) { setDocumentError(error.message || 'The document could not be uploaded.') }
    finally { setDocumentBusy(false) }
  }
  const latestDocuments = documents.reduce((groups, document) => {
    const key = String(document.rootDocumentId || document.documentRootId || document.id)
    const version = Number(document.version || document.versionNumber || 1)
    if (!groups.has(key) || version > Number(groups.get(key).version || groups.get(key).versionNumber || 1)) groups.set(key, document)
    return groups
  }, new Map())
  const timeline = activity
  const timelineLabel = (item) => {
    const labels = {
      'record.created': 'Record created', 'record.updated': 'Record updated', 'record.archived': 'Record archived',
      'note.created': 'Note added', 'note.added': 'Note added', 'task.created': 'Task added',
      'application.stage_changed': 'Application stage changed', 'status.changed': 'Status changed',
      'document.uploaded': 'Document uploaded',
    }
    return labels[String(item?.type || '').toLowerCase()] || 'Record updated'
  }
  const timelineActorName = (item) => {
    const actorId = item?.actorId || item?.userId || item?.createdBy
    return config?.users?.find((person) => String(person.id) === String(actorId))?.name || (String(user?.id) === String(actorId) ? user?.name : 'Team member')
  }
  const userName = (id) => config?.users?.find((person) => String(person.id) === String(id))?.name || (String(user?.id) === String(id) ? user.name : 'Team member')

  return <div className="platform-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="platform-record-drawer" role="dialog" aria-modal="true" aria-label={`${meta.singular} details`}><header className="platform-drawer-header"><span className="platform-drawer-icon"><meta.icon size={18} /></span><button className="platform-icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button></header><div className="platform-drawer-content"><div className="platform-eyebrow">{meta.singular}</div><h2>{displayName(data,kind)}</h2><p className="platform-record-subtitle">{data.email || data.department || data.location || data.stage || data.status || 'Record details'}</p><div className="platform-drawer-actions">{kind === 'invoices' && hasPermission(user, 'invoices', 'view') && <button className="platform-button" onClick={onPreviewInvoice}><FileText size={14} /> Preview invoice</button>}{kind === 'offers' && canPreviewOffer(user, config) && <button className="platform-button" onClick={onPreviewOffer}><FileText size={14} /> Preview offer document</button>}{hasPermission(user, kind, 'edit') && !['onboarding','referrals','automations'].includes(kind) && <button className="platform-button platform-button--primary" onClick={onEdit}>Edit details</button>}{actions.map((action) => <button className="platform-button" key={action} disabled={loading} onClick={() => onAction(action)}>{humanize(action)}</button>)}</div>{canScanDuplicates && <section className="platform-detail-section"><h3>Possible duplicates</h3><p className="platform-section-empty">Scan readable candidate records for configured identity matches. Only returned, permission-filtered match details are shown.</p><button className="platform-button platform-button--small" disabled={duplicateLoading || loading} onClick={scanDuplicates}>{duplicateLoading ? 'Scanning…' : 'Scan for duplicates'}</button>{duplicateError && <p className="platform-inline-error" role="alert">{duplicateError}</p>}{!duplicateLoading && !duplicateError && duplicateScanned && duplicateMatches.length === 0 && <p className="platform-section-empty">No possible duplicates found.</p>}{!duplicateLoading && !duplicateError && !duplicateScanned && <p className="platform-section-empty">Run a scan to see possible matches.</p>}{duplicateMatches.map((match) => { const candidate = match?.record || {}; return <article className="platform-duplicate-card" key={candidate.id}><strong>{displayName(candidate, 'candidates')}</strong><span>{candidate.email || candidate.currentTitle || candidate.location || 'Candidate match'}</span><small>Matched by: {(Array.isArray(match.matchedBy) ? match.matchedBy : []).map(humanize).join(', ') || 'Configured identity fields'}</small><button type="button" className="platform-button platform-button--small platform-button--primary" disabled={!candidate.id || String(candidate.id) === String(data.id)} onClick={() => onAction('merge', { targetId: String(candidate.id) })}>Keep this candidate as primary</button></article>})}</section>}<section className="platform-detail-section"><h3>Information</h3><dl className="platform-detail-grid">{safeEntries.map(([key,value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{privateKeys.includes(key) && !canSeeSensitive ? <span className="platform-masked">Restricted information</span> : String(value)}</dd></div>)}</dl></section>
    {kind === 'interviews' && data.calendarEvent && <section className="platform-detail-section"><h3>Local mock calendar event</h3><dl className="platform-detail-grid">{[['Status', data.calendarEvent.status], ['Start time', data.calendarEvent.startAt ? formatRegionalDateTime(data.calendarEvent.startAt, config?.regional) : null], ['Timezone', data.timeZone], ['Provider', data.calendarEvent.provider], ['Meeting type', data.meetingType], ['Room', data.room]].filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
    {specialError && <p className="platform-inline-error" role="alert">{specialError}</p>}{specialNotice && <p className="platform-special-success" role="status">{specialNotice}</p>}
    {canViewClientContracts && <section className="platform-detail-section"><div className="platform-detail-heading"><h3>Client contracts <span className="platform-section-count">{clientContractList.length}</span></h3>{canEditClientContracts && <button className="platform-button platform-button--small" disabled={specialBusy} onClick={() => setContractForm({ version: '', feeType: 'percentage', fee: '', effectiveAt: '', expiresAt: '', terms: '' })}><Plus size={13} /> Add contract</button>}</div>{contractError && <p className="platform-inline-error" role="alert">{contractError}</p>}{contractLoading ? <p className="platform-section-empty">Loading contracts…</p> : clientContractList.length ? clientContractList.map((contract) => <article className="platform-contract-card" key={contract.id}><div className="platform-contract-heading"><strong>{contract.version || `Contract ${contract.id}`}</strong><span className={`platform-status ${String(contract.status).toLowerCase() === 'active' ? 'platform-status--done' : ''}`}>{humanize(contract.status || 'draft')}</span></div><dl className="platform-detail-grid"><div><dt>Fee terms</dt><dd>{contract.feeType ? humanize(contract.feeType) : '—'}{contract.fee !== undefined && contract.fee !== null && contract.fee !== '' ? ` · ${contract.fee}${String(contract.feeType).toLowerCase().includes('percent') ? '%' : ''}` : ''}</dd></div><div><dt>Effective</dt><dd>{contract.effectiveAt ? formatRegionalDate(contract.effectiveAt, config?.regional) : '—'}</dd></div><div><dt>Expiry</dt><dd>{contract.expiresAt ? formatRegionalDate(contract.expiresAt, config?.regional) : 'No expiry'}</dd></div></dl>{contract.terms && <p className="platform-contract-terms">{contract.terms}</p>}{canEditClientContracts && <div className="platform-inline-buttons">{!['terminated','expired'].includes(String(contract.status || '').toLowerCase()) && <button className="platform-button platform-button--small" disabled={specialBusy} onClick={() => setContractForm({ id: contract.id, version: contract.version || '', feeType: contract.feeType || 'percentage', fee: contract.fee ?? '', effectiveAt: String(contract.effectiveAt || '').slice(0, 10), expiresAt: String(contract.expiresAt || '').slice(0, 10), terms: contract.terms || '' })}>Edit terms</button>}{String(contract.status || '').toLowerCase() !== 'active' && !['terminated','expired'].includes(String(contract.status || '').toLowerCase()) && <button className="platform-button platform-button--small platform-button--primary" disabled={specialBusy} onClick={() => changeClientContractStatus(contract, 'active')}>Activate</button>}{String(contract.status || '').toLowerCase() === 'active' && <button className="platform-button platform-button--small platform-button--danger" disabled={specialBusy} onClick={() => changeClientContractStatus(contract, 'terminated')}>Terminate</button>}</div>}</article>) : <p className="platform-section-empty">No contracts are recorded for this client.</p>}{contractForm && canEditClientContracts && <form className="platform-special-form platform-contract-form" onSubmit={saveClientContract}><strong>{contractForm.id ? 'Edit contract terms' : 'New contract'}</strong><label className="platform-field"><span>Version</span><input required maxLength={80} value={contractForm.version} onChange={(event) => setContractForm((current) => ({ ...current, version: event.target.value }))} /></label><div className="platform-contract-fields"><label className="platform-field"><span>Fee type</span><select value={contractForm.feeType} onChange={(event) => setContractForm((current) => ({ ...current, feeType: event.target.value }))}><option value="percentage">Percentage</option><option value="fixed">Fixed</option><option value="retainer">Retainer</option></select></label><label className="platform-field"><span>Fee</span><input type="number" min="0" step="0.01" required value={contractForm.fee} onChange={(event) => setContractForm((current) => ({ ...current, fee: event.target.value }))} /></label></div><div className="platform-contract-fields"><label className="platform-field"><span>Effective date</span><input type="date" value={contractForm.effectiveAt} onChange={(event) => setContractForm((current) => ({ ...current, effectiveAt: event.target.value }))} /></label><label className="platform-field"><span>Expiry date</span><input type="date" min={contractForm.effectiveAt || undefined} value={contractForm.expiresAt} onChange={(event) => setContractForm((current) => ({ ...current, expiresAt: event.target.value }))} /></label></div><label className="platform-field"><span>Terms</span><textarea maxLength={10000} value={contractForm.terms} onChange={(event) => setContractForm((current) => ({ ...current, terms: event.target.value }))} /></label><div className="platform-inline-buttons"><button type="button" className="platform-button" disabled={specialBusy} onClick={() => setContractForm(null)}>Cancel</button><button className="platform-button platform-button--primary" disabled={specialBusy}>{specialBusy ? 'Saving…' : 'Save contract'}</button></div></form>}</section>}
    {kind === 'interviews' && (hasPermission(user, 'feedback', 'create') || hasPermission(user, 'interviews', 'edit')) && <section className="platform-detail-section"><h3>Interview scorecard{feedbackLocked && <span className="platform-section-count">Locked</span>}</h3>{feedbackLocked ? <div className="platform-scorecard-result"><p>Feedback has been submitted and is locked.</p><dl>{Object.entries(feedbackRecord?.ratings || feedbackRecord?.answers || data.ratings || {}).map(([key,value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{value}</dd></div>)}</dl>{(feedbackRecord?.recommendation || data.recommendation) && <p><strong>Recommendation:</strong> {humanize(feedbackRecord?.recommendation || data.recommendation)}</p>}{(feedbackRecord?.comments || data.comments) && <p className="platform-scorecard-comments">{feedbackRecord?.comments || data.comments}</p>}</div> : scoreCriteria.length ? <form className="platform-scorecard-form" onSubmit={submitScorecard}><p className="platform-form-intro">Rate each configured criterion and include written feedback before submitting. Submitted feedback cannot be changed.</p>{scoreCriteria.map((criterion) => { const key = typeof criterion === 'string' ? criterion : criterion.id || criterion.key || criterion.name; const criterionLabel = typeof criterion === 'string' ? humanize(criterion) : criterion.name || criterion.label || key; const required = typeof criterion === 'string' || criterion.required !== false; return <label className="platform-score-criterion" key={key}><span>{criterionLabel}{required && <b className="platform-required"> *</b>}{criterion.description && <small>{criterion.description}</small>}</span><select required={required} value={feedbackValues[key] ?? ''} onChange={(event) => setFeedbackValues((current) => ({ ...current, [key]: event.target.value }))}><option value="">Choose rating</option>{Array.from({ length: Math.max(1, scoreMax - scoreMin + 1) }, (_, index) => scoreMin + index).map((rating) => <option key={rating} value={rating}>{rating}{scorecard?.ratingScale?.labels?.[rating] ? ` · ${scorecard.ratingScale.labels[rating]}` : ''}</option>)}</select></label> })}<label className="platform-score-criterion"><span>Recommendation <b className="platform-required">*</b></span><select required value={feedbackValues.recommendation || ''} onChange={(event) => setFeedbackValues((current) => ({ ...current, recommendation: event.target.value }))}><option value="">Choose recommendation</option>{scoreRecommendations.map((value) => <option key={typeof value === 'string' ? value : value.id} value={typeof value === 'string' ? value : value.id}>{humanize(typeof value === 'string' ? value : value.label || value.name || value.id)}</option>)}</select></label><label className="platform-field platform-field--full"><span>Written feedback <b className="platform-required">*</b></span><textarea required value={feedbackValues.comments || ''} onChange={(event) => setFeedbackValues((current) => ({ ...current, comments: event.target.value }))} maxLength={10000} /></label><button className="platform-button platform-button--primary" disabled={specialBusy}>{specialBusy ? 'Submitting…' : 'Submit feedback'}</button></form> : <p className="platform-section-empty">No scorecard is configured for this interview.</p>}</section>}
    {kind === 'placements' && moduleOn(config?.modules, 'agency') && config?.agency?.guarantees !== false && config?.agency?.guarantees?.enabled !== false && <section className="platform-detail-section"><h3>Guarantee & replacement</h3><p className="platform-special-meta">{data.guaranteeExpiry ? `Guarantee expires ${formatRegionalDate(data.guaranteeExpiry, config?.regional)}` : `${data.guaranteeDays || 0} day guarantee`}{data.guaranteeStatus ? ` · ${humanize(data.guaranteeStatus)}` : ''}{data.guaranteeRequest?.reason ? ` · ${data.guaranteeRequest.reason}` : ''}</p>{hasPermission(user, 'placements', 'edit') && !data.guaranteeStatus && <form className="platform-special-form" onSubmit={(event) => { event.preventDefault(); runPlacementAction('guarantee-request', { reason: guaranteeReason.trim() }) }}><label className="platform-field"><span>Request guarantee claim</span><textarea required maxLength={4000} value={guaranteeReason} onChange={(event) => setGuaranteeReason(event.target.value)} placeholder="Describe the issue and requested outcome" /></label><button className="platform-button platform-button--primary" disabled={specialBusy || !guaranteeReason.trim()}>Request review</button></form>}{['requested','under_review'].includes(String(data.guaranteeStatus || '').toLowerCase()) && hasPermission(user, 'placements', 'approve') && <form className="platform-special-form" onSubmit={(event) => { event.preventDefault(); runPlacementAction('guarantee-review', { comment: guaranteeComment.trim() }) }}><label className="platform-field"><span>Review note</span><textarea maxLength={4000} value={guaranteeComment} onChange={(event) => setGuaranteeComment(event.target.value)} /></label><div className="platform-inline-buttons"><button type="button" className="platform-button" disabled={specialBusy || !guaranteeComment.trim()} onClick={() => runPlacementAction('guarantee-deny', { reason: guaranteeComment.trim() })}>Deny claim</button><button className="platform-button platform-button--primary" disabled={specialBusy}>Save review</button><button type="button" className="platform-button platform-button--primary" disabled={specialBusy} onClick={() => runPlacementAction('guarantee-approve', { reason: guaranteeComment.trim() })}>Approve claim</button></div></form>}{String(data.guaranteeStatus || '').toLowerCase() === 'approved' && hasPermission(user, 'placements', 'edit') && <form className="platform-special-form" onSubmit={(event) => { event.preventDefault(); runPlacementAction('guarantee-replacement', replacement) }}><label className="platform-field"><span>Replacement candidate</span><select required value={replacement.candidateId} onChange={(event) => setReplacement((current) => ({ ...current, candidateId: event.target.value }))}><option value="">Choose candidate</option>{relatedCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate, 'candidates')}</option>)}</select></label><label className="platform-field"><span>Replacement job</span><select required value={replacement.jobId} onChange={(event) => setReplacement((current) => ({ ...current, jobId: event.target.value }))}><option value="">Choose job</option>{replacementJobs.filter((job) => String(job.clientId || job.agencyClientId) === String(data.clientId)).map((job) => <option key={job.id} value={job.id}>{job.title || job.name}</option>)}</select></label><label className="platform-field"><span>Notes</span><textarea value={replacement.notes} onChange={(event) => setReplacement((current) => ({ ...current, notes: event.target.value }))} /></label><button className="platform-button platform-button--primary" disabled={specialBusy}>Create replacement</button></form>}</section>}
    {kind === 'talentPools' && moduleOn(config?.modules, 'talentCrm') && <section className="platform-detail-section"><div className="platform-detail-heading"><h3>Pool members <span className="platform-section-count">{poolMembers.length}</span></h3>{hasPermission(user, 'talentPools', 'view') && <button className="platform-button platform-button--small" disabled={specialBusy} onClick={() => runPoolAction('rediscover', {})}>Rediscover</button>}</div>{rediscoveredCandidates.length > 0 && <div className="platform-rediscovery-results"><strong>Rediscovered candidates</strong>{rediscoveredCandidates.map((candidate) => <span key={candidate.id}>{displayName(candidate, 'candidates')} · {candidate.email || candidate.currentTitle || 'Eligible'}</span>)}</div>}{poolMembers.length ? poolMembers.map((member) => { const candidateId = member.candidateId || member.id; const candidate = findCandidate(candidateId) || member.candidate || member; return <article className="platform-pool-member" key={candidateId}><div><strong>{displayName(candidate, 'candidates')}</strong><small>{candidate.email || member.note || 'Pool member'}</small></div>{hasPermission(user, 'talentPools', 'edit') && <><input aria-label={`Follow-up date for ${displayName(candidate, 'candidates')}`} type="date" value={poolMemberEdits[candidateId]?.followUpAt ?? member.followUpAt ?? ''} onChange={(event) => setPoolMemberEdits((current) => ({ ...current, [candidateId]: { ...current[candidateId], followUpAt: event.target.value } }))} /><button className="platform-button platform-button--small" disabled={specialBusy} onClick={() => updatePoolMember(candidateId, 'PATCH', { followUpAt: poolMemberEdits[candidateId]?.followUpAt ?? member.followUpAt ?? null, note: poolMemberEdits[candidateId]?.note ?? member.note ?? '' })}>Save</button><button className="platform-button platform-button--small platform-button--danger" disabled={specialBusy} onClick={() => updatePoolMember(candidateId, 'DELETE', {})}>Remove</button></>}</article> }) : <p className="platform-section-empty">No candidates are in this pool yet.</p>}{hasPermission(user, 'talentPools', 'edit') && <form className="platform-special-form" onSubmit={(event) => { event.preventDefault(); runPoolAction('members', { candidateId: poolCandidateId, ...(poolFollowUpAt ? { followUpAt: poolFollowUpAt } : {}), ...(poolNote.trim() ? { note: poolNote.trim() } : {}) }); setPoolCandidateId(''); setPoolNote('') }}><label className="platform-field"><span>Add candidate</span><select required value={poolCandidateId} onChange={(event) => setPoolCandidateId(event.target.value)}><option value="">Choose candidate</option>{relatedCandidates.filter((candidate) => !poolMembers.some((member) => String(member.candidateId || member.id) === String(candidate.id))).map((candidate) => <option key={candidate.id} value={candidate.id}>{displayName(candidate, 'candidates')}</option>)}</select></label><label className="platform-field"><span>Follow-up date</span><input type="date" value={poolFollowUpAt} onChange={(event) => setPoolFollowUpAt(event.target.value)} /></label><label className="platform-field"><span>Note</span><textarea value={poolNote} onChange={(event) => setPoolNote(event.target.value)} /></label><button className="platform-button platform-button--primary" disabled={specialBusy || !poolCandidateId}>Add to pool</button></form>}</section>}
    {kind === 'referrals' && <section className="platform-detail-section"><h3>Milestones & payout</h3>{specialError && <p className="platform-inline-error" role="alert">{specialError}</p>}{specialNotice && <p className="platform-special-success" role="status">{specialNotice}</p>}<p className="platform-special-meta">{data.reward ? `${data.reward.name || 'Reward earned'} · ${data.reward.currency || config?.regional?.currency || ''} ${Number(data.reward.amount || 0).toLocaleString()}` : 'No reward has been earned yet.'}{data.payoutStatus ? ` · Payout ${humanize(data.payoutStatus)}` : ''}</p>{hasPermission(user, 'referrals', 'edit') && <>{availableReferralMilestones.length > 0 && <form className="platform-special-form platform-referral-action" onSubmit={(event) => { event.preventDefault(); const milestone = event.currentTarget.elements.milestone.value; if (milestone) runReferralAction('complete-milestone', { milestone }, `${humanize(milestone)} milestone recorded.`) }}><label className="platform-field"><span>Record configured milestone</span><select name="milestone" defaultValue=""><option value="">Choose milestone</option>{availableReferralMilestones.map((milestone) => <option key={milestone} value={milestone}>{humanize(milestone)}</option>)}</select></label><button className="platform-button platform-button--primary" disabled={specialBusy}>Record milestone</button></form>}{data.reward && configuredPayoutStatuses.length > 0 && <form className="platform-special-form platform-referral-action" onSubmit={(event) => { event.preventDefault(); if (payoutStatusChoice) runReferralAction('set-payout-status', { status: payoutStatusChoice }, `Payout status set to ${humanize(payoutStatusChoice)}.`) }}><label className="platform-field"><span>Update payout status</span><select name="payoutStatus" value={payoutStatusChoice} onChange={(event) => setPayoutStatusChoice(event.target.value)}><option value="" disabled>Choose status</option>{configuredPayoutStatuses.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}</select></label><button className="platform-button" disabled={specialBusy || !configuredPayoutStatuses.includes(payoutStatusChoice)}>Update payout</button></form>}</>}{!hasPermission(user, 'referrals', 'edit') && <p className="platform-section-empty">You need referral edit permission to update milestones or payout status.</p>}{availableReferralMilestones.length === 0 && configuredReferralMilestones.length > 0 && <p className="platform-section-empty">All configured milestones are already recorded.</p>}{configuredReferralMilestones.length === 0 && <p className="platform-section-empty">No referral milestones are configured.</p>}</section>}
    {kind === 'onboarding' && <section className="platform-detail-section"><div className="platform-detail-heading"><h3>Onboarding checklist <span className="platform-section-count">{onboardingChecklist.length}</span></h3>{onboardingComplete && <span className="platform-status platform-status--done">Complete</span>}</div>{sideError && <p className="platform-inline-error" role="alert">{sideError}</p>}{specialError && <p className="platform-inline-error" role="alert">{specialError}</p>}{specialNotice && <p className="platform-special-success" role="status">{specialNotice}</p>}{onboardingChecklist.length ? onboardingChecklist.map((item, index) => { const done = Boolean(item.completed) || ['done','complete','completed'].includes(String(item.status || '').toLowerCase()); return <div className={`platform-related-task ${done ? 'is-done' : ''}`} key={item.id || item.itemId || index}><button className="platform-task-check" disabled={!hasPermission(user, 'onboarding', 'edit') || Boolean(checklistBusy) || onboardingComplete} onClick={() => toggleChecklistItem(item)} aria-label={done ? `Mark ${item.title || item.name} pending` : `Complete ${item.title || item.name}`}>{done && <Check size={13} />}</button><span><strong>{item.title || item.name || item.label || `Checklist item ${index + 1}`}{item.required !== false && <small>Required</small>}</strong>{item.description && <small>{item.description}</small>}</span><span className={`platform-status ${done ? 'platform-status--done' : ''}`}>{done ? 'Done' : humanize(item.status || 'pending')}</span></div> }) : <p className="platform-section-empty">No checklist items are configured for this plan.</p>}{onboardingComplete ? <p className="platform-inline-success" role="status">This onboarding plan is already complete.</p> : hasPermission(user, 'onboarding', 'edit') && String(data.status || '').toLowerCase() === 'in_progress' && <div className="platform-onboarding-completion">{onboardingRequiredIncomplete > 0 && <p className="platform-special-meta">Complete {onboardingRequiredIncomplete} required checklist {onboardingRequiredIncomplete === 1 ? 'item' : 'items'} before finishing.{incompleteRequiredItems.length > 0 && <span> Remaining: {incompleteRequiredItems.map((item) => item.title || item.name || item.label || 'Untitled item').join(', ')}.</span>}</p>}<button type="button" className="platform-button platform-button--primary" disabled={specialBusy || onboardingRequiredIncomplete > 0} onClick={completeOnboarding}>{specialBusy ? 'Completing…' : 'Complete onboarding'}</button></div>}</section>}
    {relatedField && <section className="platform-detail-section"><div className="platform-detail-heading"><h3>Activity</h3>{activityLoading && <small>Loading…</small>}</div>{!canReadAudit && !canReadNotes ? <p className="platform-section-empty">You do not have permission to view activity.</p> : activityError ? <p className="platform-inline-error" role="alert">{activityError}</p> : timeline.length ? timeline.map((item, index) => { const occurredAt = item.occurredAt || item.createdAt; const parsedAt = occurredAt ? new Date(occurredAt) : null; const when = parsedAt && Number.isFinite(parsedAt.getTime()) ? formatRegionalDateTime(parsedAt, config?.regional) : ''; const noteBody = item.body || item.note?.body; return <div className="platform-timeline" key={item.id || `${item.type || 'activity'}-${occurredAt || index}`}><span className="platform-timeline-point" /><div><strong>{timelineLabel(item)}</strong><small>{[timelineActorName(item), when].filter(Boolean).join(' · ')}</small>{typeof noteBody === 'string' && noteBody && <p className="platform-timeline-note">{noteBody}</p>}</div></div> }) : !activityLoading && <p className="platform-section-empty">No recorded activity for this record yet.</p>}</section>}
    {canReadNotes && <section className="platform-detail-section"><h3>Notes <span className="platform-section-count">{notes.length}</span></h3>{notes.length ? notes.slice().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).map((note) => <article className="platform-note-card" key={note.id}><div><strong>{userName(note.authorId || note.createdBy)}</strong><small>{note.visibility === 'private' ? 'Private' : 'Team'}{note.createdAt ? ` · ${formatRegionalDateTime(note.createdAt, config?.regional)}` : ''}</small></div><p>{note.body}</p></article>) : !sideLoading && <p className="platform-section-empty">No notes have been added.</p>}{canCreateNotes && <form className="platform-inline-composer" onSubmit={addNote}><label htmlFor="record-note">Add a note</label><textarea id="record-note" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Share context with your team…" required maxLength={10000} /><div><select aria-label="Note visibility" value={noteVisibility} onChange={(event) => setNoteVisibility(event.target.value)}><option value="team">Team note</option><option value="private">Private note</option></select><button className="platform-button platform-button--primary platform-button--small" disabled={taskBusy || !noteBody.trim()}><Plus size={13} /> Add note</button></div></form>}</section>}
    {canReadTasks && <section className="platform-detail-section"><h3>Tasks <span className="platform-section-count">{tasks.length}</span></h3>{tasks.length ? tasks.slice().sort((a,b) => new Date(a.dueDate || '9999') - new Date(b.dueDate || '9999')).map((task) => { const done = ['done','completed'].includes(String(task.status).toLowerCase()); return <div className={`platform-related-task ${done ? 'is-done' : ''}`} key={task.id}><button className="platform-task-check" disabled={!canEditTasks || taskBusy} onClick={() => toggleTask(task)} aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}>{done && <Check size={13} />}</button><span><strong>{task.title || 'Untitled task'}</strong><small>{task.dueDate ? `Due ${formatRegionalDate(task.dueDate, config?.regional)}` : 'No due date'}{task.priority ? ` · ${humanize(task.priority)} priority` : ''}</small></span><span className={`platform-status ${done ? 'platform-status--done' : ''}`}>{done ? 'Done' : humanize(task.status || 'open')}</span></div> }) : !sideLoading && <p className="platform-section-empty">No tasks are linked to this record.</p>}{canCreateTasks && <form className="platform-task-composer" onSubmit={addTask}><input aria-label="Task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add a follow-up task…" required maxLength={180} /><input aria-label="Task due date" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /><button className="platform-button platform-button--primary platform-button--small" disabled={taskBusy || !taskTitle.trim()}><Plus size={13} /> Add task</button></form>}</section>}
    {canReadDocuments && <section className="platform-detail-section"><h3>Documents <span className="platform-section-count">{latestDocuments.size}</span></h3>{documentError && <p className="platform-inline-error" role="alert">{documentError}</p>}{documentNotice && <p className="platform-inline-success" role="status">{documentNotice}</p>}{latestDocuments.size ? [...latestDocuments.entries()].map(([rootId, doc]) => { const canDownload = doc.visibility === 'public' || doc.ownerId === user?.id || hasPermission(user, 'documents', 'administer'); const docId = String(doc.id); const versions = documentVersions[rootId] || []; return <div className="platform-document-card" key={rootId}><div className="platform-document-row"><FileText size={16} /><span>{doc.filename || doc.name || 'Attachment'}<small>{doc.size ? ` · ${formatBytes(doc.size)}` : ''}{doc.uploadedAt ? ` · ${new Date(doc.uploadedAt).toLocaleDateString()}` : ''}</small></span><small>{doc.category || 'Attachment'} · {humanize(doc.visibility || 'team')}{Number(doc.version || doc.versionNumber) ? ` · v${doc.version || doc.versionNumber}` : ''}</small>{canDownload && <button className="platform-icon-button" onClick={() => downloadDocument(doc)} aria-label={`Download ${doc.filename || 'document'}`} title="Download"><Download size={15} /></button>}</div>{(Number(doc.version || doc.versionNumber) > 1 || doc.versionCount > 1 || doc.previousVersionId || doc.rootDocumentId || doc.hasVersions || canReplaceDocuments) && <button type="button" className="platform-version-toggle" onClick={() => versionExpanded[rootId] ? setVersionExpanded((current) => ({ ...current, [rootId]: false })) : loadDocumentVersions(doc)} aria-expanded={Boolean(versionExpanded[rootId])}>{versionLoading[rootId] ? 'Loading versions…' : versionExpanded[rootId] ? 'Hide version history' : 'Show version history'}</button>}{versionExpanded[rootId] && <div className="platform-version-list">{versions.length ? versions.map((version) => { const allowed = version.visibility === 'public' || version.ownerId === user?.id || hasPermission(user, 'documents', 'administer'); return <div className="platform-version-row" key={version.id}><span><strong>v{version.version || version.versionNumber || '—'} · {version.filename || version.name || 'Document version'}</strong><small>{version.uploadedAt ? new Date(version.uploadedAt).toLocaleString() : ''}{version.size ? ` · ${formatBytes(version.size)}` : ''}</small></span>{allowed && <button className="platform-icon-button" onClick={() => downloadDocument(version)} aria-label={`Download version ${version.version || version.versionNumber || ''}`} title="Download version"><Download size={14} /></button>}</div> }) : <p className="platform-section-empty">No prior versions are available.</p>}</div>}{canReplaceDocuments && <form className="platform-document-replace" onSubmit={(event) => replaceDocument(event, doc)}><label><span>Replace with a new version</span><input type="file" onChange={(event) => { setReplacementFiles((current) => ({ ...current, [docId]: event.target.files?.[0] || null })); setDocumentError(''); setDocumentNotice('') }} /></label><button type="submit" className="platform-button platform-button--small" disabled={documentBusy}>{documentBusy ? 'Uploading…' : 'Upload replacement'}</button></form>}</div> }) : !sideLoading && <p className="platform-section-empty">No documents have been uploaded.</p>}{canUploadDocuments && <form className="platform-document-upload" onSubmit={uploadDocument}><strong>Upload a document</strong><label><span>File</span><input type="file" required onChange={(event) => { setNewDocument((current) => ({ ...current, file: event.target.files?.[0] || null })); setDocumentError(''); setDocumentNotice('') }} /></label><div className="platform-document-upload-fields"><label><span>Category</span><select value={newDocument.category || documentCategories[0]} onChange={(event) => setNewDocument((current) => ({ ...current, category: event.target.value }))}>{documentCategories.map((category) => <option key={category} value={category}>{humanize(category)}</option>)}</select></label><label><span>Visibility</span><select value={newDocument.visibility || defaultDocumentVisibility} onChange={(event) => setNewDocument((current) => ({ ...current, visibility: event.target.value }))}>{documentVisibilities.map((visibility) => <option key={visibility} value={visibility}>{humanize(visibility)}</option>)}</select></label></div><small>Maximum file size: {formatBytes(documentMaxBytes)}.</small><button type="submit" className="platform-button platform-button--primary platform-button--small" disabled={documentBusy || !newDocument.file}>{documentBusy ? 'Uploading…' : 'Upload document'}</button></form>}</section>}
    <section className="platform-detail-section"><h3>Privacy & consent</h3><div className="platform-privacy-state"><Shield size={15} /><span>{data.consentStatus || 'Consent status not recorded'}</span></div></section>{hasPermission(user, kind, 'delete') && <button className="platform-danger-link" onClick={onDelete}><Archive size={15} /> Archive record</button>}</div></aside></div>
}

function documentNodeLink(href, filename) { const link = window.document.createElement('a'); link.href = href; link.download = filename; return link }
function formatBytes(bytes) { const value = Number(bytes); if (!Number.isFinite(value) || value < 0) return ''; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB` }

function CareersExperience({ jobs, context, loading, error, job, setJob, sent, setSent }) {
  const [query, setQuery] = useState('')
  const [application, setApplication] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const company = job?.company?.name || context?.company?.name || context?.companyName || context?.branding?.productName || 'Careers'
  const privacyNotice = job?.privacyNotice || context?.privacyNotice || context?.privacy?.notice || ''
  const form = job?.applicationForm || applicationFormFor(context, job)
  const fields = applicationFields(form)
  const configuredForm = Boolean(form && fields.length)
  const visibleFields = fields.filter((field) => fieldVisible(field, form, application))
  const list = jobs.filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))
  useEffect(() => { setApplication({}); setSubmitError('') }, [job?.id])
  const submit = async (event) => {
    event.preventDefault()
    if (!job || submitting) return
    setSubmitting(true); setSubmitError('')
    try {
      const values = { ...application }
      const resumeField = fields.find((field) => field.type === 'file' && /resume|cv/i.test(field.key)) || fields.find((field) => field.type === 'file')
      const consentField = fields.find((field) => field.type === 'checkbox' && /consent|privacy|agree/i.test(`${field.key} ${field.label}`))
      const fullNameField = fields.find((field) => /^(fullName|name)$/i.test(field.key))
      if (!fullNameField && (values.firstName || values.lastName)) values.fullName = `${values.firstName || ''} ${values.lastName || ''}`.trim()
      if (consentField) values.consent = Boolean(values[consentField.key])
      else if (context?.privacy?.consentRequired !== false && !values.consent) throw new Error('Please provide your consent before submitting.')
      const resumeFile = resumeField && values[resumeField.key] instanceof File ? values[resumeField.key] : null
      if (resumeField) delete values[resumeField.key]
      if (resumeFile) values.resume = await fileAsPayload(resumeFile)
      const response = await platformApi.apply(job.id, values)
      if (response?.success === false) throw new Error(response.message || 'Your application could not be submitted.')
      setSent(true)
    } catch (requestError) { setSubmitError(requestError.message) } finally { setSubmitting(false) }
  }
  const applyFields = visibleFields.length ? visibleFields : [
    { key: 'fullName', label: 'Full name', type: 'shortText', required: true },
    { key: 'email', label: 'Email address', type: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'resume', label: 'Resume', type: 'file', required: true },
    { key: 'consent', label: privacyNotice || 'I agree to the privacy notice and candidate data processing.', type: 'checkbox', required: true },
  ]
  return <div className="ats-platform platform-careers" style={{ '--platform-primary': job?.branding?.primaryColor || context?.branding?.primaryColor || '#2347C5', '--platform-accent': job?.branding?.accentColor || context?.branding?.accentColor || '#13A88A' }}>
    <header className="platform-career-header"><a href="/careers-platform" className="platform-career-brand"><span className="platform-brand-mark">{company.slice(0,1).toUpperCase()}</span><strong>{company}</strong></a><span>{context?.branding?.loginSubheading || 'Explore opportunities to do meaningful work.'}</span></header>
    <main className="platform-career-main">
      <div className="platform-career-intro"><div className="platform-eyebrow">Careers</div><h1>{context?.careers?.headline || 'Find work that moves you forward.'}</h1><p>{context?.careers?.intro || 'Explore open positions and find a place where your work matters.'}</p></div>
      {error && <div className="platform-alert platform-alert--error" role="alert">{error}</div>}
      {job ? <section className="platform-career-detail">
        <button className="platform-text-button" onClick={() => { setJob(null); setSent(false); setSubmitError('') }}><ArrowLeft size={15} /> All openings</button>
        {sent ? <EmptyState title="Application received" description="Thanks for applying. Your information has been added to the hiring workspace." action={<button className="platform-button" onClick={() => { setJob(null); setSent(false) }}>View other openings</button>} /> : <>
          <div className="platform-career-detail-heading"><span className="platform-status">{job.department || job.team || 'Open position'}</span><h2>{job.title || job.name}</h2><p>{[job.location, job.employmentType || job.type, job.remote ? 'Remote' : ''].filter(Boolean).join(' · ')}</p></div>
          <div className="platform-career-description">{job.description && <><h3>About this role</h3><p>{job.description}</p></>}{job.requirements && <><h3>What we’re looking for</h3><p>{job.requirements}</p></>}{job.benefits && <><h3>What we offer</h3><p>{job.benefits}</p></>}</div>
          <form className="platform-career-application" onSubmit={submit}><h3>{form?.name || 'Apply for this role'}</h3><p>{form?.description || 'Share a few details to get started.'}</p>{submitError && <div className="platform-alert platform-alert--error" role="alert">{submitError}</div>}
            {(configuredForm ? (form?.sections || []) : []).map((section) => <div key={section.id || section.title}><h4>{section.title}</h4><div className="platform-form-grid">{(section.fields || []).filter((field) => fieldVisible({ ...field, key: fieldKey(field) }, form, application)).map((rawField) => { const field = { ...rawField, key: fieldKey(rawField), fullWidth: rawField.fullWidth || ['longText', 'file'].includes(rawField.type) }; return <FieldControl key={field.key} field={field} value={application[field.key]} onChange={(value) => setApplication((current) => ({ ...current, [field.key]: value }))} idPrefix="career" /> })}</div></div>)}
            {!configuredForm && <div className="platform-form-grid">{applyFields.map((field) => <FieldControl key={field.key} field={{ ...field, fullWidth: field.fullWidth || ['longText', 'file', 'checkbox'].includes(field.type) }} value={application[field.key]} onChange={(value) => setApplication((current) => ({ ...current, [field.key]: value }))} idPrefix="career" />)}</div>}
            {(form?.knockoutQuestions || []).map((question, index) => { const key = fieldKey(question) || `knockout-${index}`; return <FieldControl key={key} field={{ ...question, key, label: question.label || question.question, required: question.required !== false }} value={application[key]} onChange={(value) => setApplication((current) => ({ ...current, [key]: value }))} idPrefix="career-knockout" /> })}
            {configuredForm && context?.privacy?.consentRequired !== false && !fields.some((field) => field.type === 'checkbox' && /consent|privacy|agree/i.test(`${field.key} ${field.label}`)) && <FieldControl field={{ key: 'consent', label: privacyNotice || 'I agree to the privacy notice and candidate data processing.', type: 'checkbox', required: true, fullWidth: true }} value={application.consent} onChange={(value) => setApplication((current) => ({ ...current, consent: value }))} idPrefix="career" />}
            {privacyNotice && !fields.some((field) => field.type === 'checkbox' && /consent|privacy|agree/i.test(`${field.key} ${field.label}`)) && <p className="platform-privacy-notice">{privacyNotice}</p>}
            <button className="platform-button platform-button--primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit application'} <ArrowRight size={15} /></button>
          </form></>}
      </section> : <>
        <div className="platform-career-toolbar"><label className="platform-list-search"><Search size={16} /><input aria-label="Search open roles" placeholder="Search jobs by title, team or location" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{list.length} open {list.length === 1 ? 'role' : 'roles'}</span></div>
        {loading ? <div className="platform-table-loading"><div className="platform-spinner" /> Loading open positions…</div> : list.length ? <div className="platform-career-jobs">{list.map((item) => <button key={item.id} className="platform-career-job" onClick={async () => { try { const detail = await platformApi.publicJob(item.id); setJob(detail?.job || detail) } catch (requestError) { setSubmitError(requestError.message); setJob(item) } }}><span><strong>{item.title || item.name}</strong><small>{[item.department, item.location, item.employmentType || item.type].filter(Boolean).join(' · ')}</small></span><ArrowRight size={17} /></button>)}</div> : <EmptyState title="No open roles match" description="Try another title or check back later for new opportunities." />}
      </>}
    </main><footer className="platform-career-footer">Powered by {company} · Candidate privacy is managed by the company</footer>
  </div>
}
