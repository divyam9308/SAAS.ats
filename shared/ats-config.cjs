'use strict'

const SCHEMA_VERSION = 2
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'publish', 'assign', 'administer']
const FIELD_TYPES = ['text', 'shortText', 'longText', 'number', 'currency', 'date', 'checkbox', 'singleSelect', 'multiSelect', 'url', 'email', 'phone', 'file']

const clone = value => value == null ? value : structuredClone(value)
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const slugify = value => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-company'
const unique = values => new Set(values).size === values.length

const baseConfig = {
  schemaVersion: SCHEMA_VERSION,
  mode: 'corporate',
  company: { name: 'Acme Company', slug: 'acme-company', legalName: '', website: '', supportEmail: '' },
  branding: {
    productName: 'Acme Talent', primaryColor: '#2347C5', secondaryColor: '#172554', accentColor: '#13A88A',
    logo: '', horizontalLogo: '', favicon: '', typography: 'system', loginHeadline: 'Build your next great team',
    loginSubheading: 'Your hiring workspace', emailLogo: '', careersLogo: '', documentLogo: '',
    customDomain: '', colorMode: 'light', darkPrimaryColor: '#93A8FF', darkBackgroundColor: '#101522'
  },
  terminology: { jobs: 'Jobs', candidates: 'Candidates', recruiters: 'Recruiters', clients: 'Clients', hires: 'Hires' },
  careers: { headline: '', intro: '', footer: '', copy: { eyebrow: '', brandSubheading: '', searchPlaceholder: '', noMatchesTitle: '', noMatchesDescription: '', apply: '', applicationIntro: '', submit: '', submitting: '', receivedTitle: '', receivedDescription: '', poweredBy: '', privacyFooter: '' } },
  regional: { currency: 'USD', timezone: 'America/New_York', dateFormat: 'MM/DD/YYYY', timeFormat: '12h', language: 'en', workingDays: [1, 2, 3, 4, 5], workingHours: { start: '09:00', end: '17:00' }, salaryUnit: 'year', noticePeriodUnit: 'days', numberLocale: 'en-US' },
  modules: { dashboard: true, candidates: true, jobs: true, requisitions: true, applications: true, interviews: true, offers: true, onboarding: true, careers: true, referrals: false, talentCrm: true, reporting: true, automation: false, agency: false, invoices: false, workforcePlanning: false, audit: true, tasks: true, notifications: true, integrations: true },
  organization: {
    legalEntities: [{ id: 'entity-main', name: 'Acme Company', country: 'United States', currency: 'USD' }],
    units: [{ id: 'unit-company', name: 'Acme Company', type: 'company', parentId: null, defaultHiringOwnerId: '' }, { id: 'unit-engineering', name: 'Engineering', type: 'department', parentId: 'unit-company', defaultHiringOwnerId: '' }, { id: 'unit-sales', name: 'Sales', type: 'department', parentId: 'unit-company', defaultHiringOwnerId: '' }],
    locations: [{ id: 'location-hq', name: 'Headquarters', city: '', region: '', country: 'United States', timezone: 'America/New_York' }],
    costCentres: [], reportingRelationships: []
  },
  roles: [
    { id: 'admin', name: 'Company Admin', permissions: { '*': ['view', 'create', 'edit', 'delete', 'approve', 'export', 'publish', 'assign', 'administer'] }, scope: 'all', sensitive: ['*'] },
    { id: 'ceo', name: 'CEO', permissions: { dashboard: ['view'], requisitions: ['view', 'approve'], jobs: ['view'], applications: ['view'], offers: ['view', 'approve'], reporting: ['view', 'export'], audit: ['view'] }, scope: 'all', sensitive: ['salary', 'offerDetails', 'financialInformation'] },
    { id: 'hr-head', name: 'HR Head', permissions: { dashboard: ['view'], candidates: ['view', 'create', 'edit', 'assign', 'approve', 'export'], applications: ['view', 'create', 'edit', 'assign'], jobs: ['view', 'create', 'edit', 'publish', 'assign'], requisitions: ['view', 'approve'], interviews: ['view', 'create', 'edit'], offers: ['view', 'create', 'approve'], reporting: ['view', 'export'], notes: ['view', 'create', 'edit', 'delete'], documents: ['view', 'create', 'edit', 'delete'] }, scope: 'all', sensitive: ['salary', 'contact', 'feedback', 'privateNotes', 'offerDetails'] },
    { id: 'recruiter', name: 'Recruiter', permissions: { dashboard: ['view'], candidates: ['view', 'create', 'edit', 'assign'], applications: ['view', 'create', 'edit', 'assign'], jobs: ['view'], requisitions: ['view', 'create'], interviews: ['view', 'create', 'edit'], tasks: ['view', 'create', 'edit'], notes: ['view', 'create', 'edit'], documents: ['view', 'create', 'edit'] }, scope: 'owned', sensitive: ['contact', 'feedback'] },
    { id: 'hiring-manager', name: 'Hiring Manager', permissions: { dashboard: ['view'], candidates: ['view'], applications: ['view'], jobs: ['view'], requisitions: ['view', 'create', 'approve'], interviews: ['view', 'create'], feedback: ['view', 'create'], notes: ['view', 'create'], documents: ['view'] }, scope: 'department', sensitive: ['contact', 'feedback'] },
    { id: 'interviewer', name: 'Interviewer', permissions: { candidates: ['view'], applications: ['view'], interviews: ['view'], feedback: ['create'] }, scope: 'owned', sensitive: [] },
    { id: 'finance', name: 'Finance', permissions: { dashboard: ['view'], offers: ['view'], invoices: ['view', 'create', 'edit', 'export'], reporting: ['view'] }, scope: 'all', sensitive: ['salary', 'offerDetails', 'financialInformation'] },
    { id: 'employee', name: 'Employee', permissions: { careers: ['view'], referrals: ['view', 'create'] }, scope: 'owned', sensitive: [] },
    { id: 'agency-consultant', name: 'Agency Consultant', permissions: { clients: ['view', 'create', 'edit'], candidates: ['view', 'create', 'edit'], jobs: ['view', 'create', 'edit'], submissions: ['view', 'create', 'edit'], placements: ['view'], notes: ['view', 'create', 'edit'], documents: ['view', 'create', 'edit'] }, scope: 'owned', sensitive: ['contact', 'agencyFees'] }
  ],
  users: [
    { id: 'demo-admin', name: 'Alex Morgan', email: 'admin@localhost.test', roleId: 'admin', departmentId: 'unit-company', locationId: 'location-hq' },
    { id: 'demo-ceo', name: 'Jamie Wallace', email: 'ceo@localhost.test', roleId: 'ceo', departmentId: 'unit-company', locationId: 'location-hq' },
    { id: 'demo-hr-head', name: 'Avery Johnson', email: 'hr-head@localhost.test', roleId: 'hr-head', departmentId: 'unit-company', locationId: 'location-hq' },
    { id: 'demo-recruiter', name: 'Jordan Lee', email: 'recruiter@localhost.test', roleId: 'recruiter', departmentId: 'unit-engineering', locationId: 'location-hq' },
    { id: 'demo-manager', name: 'Taylor Brooks', email: 'manager@localhost.test', roleId: 'hiring-manager', departmentId: 'unit-engineering', locationId: 'location-hq' },
    { id: 'demo-interviewer', name: 'Casey Patel', email: 'interviewer@localhost.test', roleId: 'interviewer', departmentId: 'unit-engineering', locationId: 'location-hq' },
    { id: 'demo-finance', name: 'Morgan Chen', email: 'finance@localhost.test', roleId: 'finance', departmentId: 'unit-company', locationId: 'location-hq' },
    { id: 'demo-employee', name: 'Sam Rivera', email: 'employee@localhost.test', roleId: 'employee', departmentId: 'unit-sales', locationId: 'location-hq' }
  ],
  employmentTypes: [
    { id: 'full-time', label: 'Full-time', enabled: true }, { id: 'part-time', label: 'Part-time', enabled: true },
    { id: 'internship', label: 'Internship', enabled: true }, { id: 'contract', label: 'Contract', enabled: true },
    { id: 'freelance', label: 'Freelance', enabled: false }, { id: 'temporary', label: 'Temporary', enabled: false },
    { id: 'campus', label: 'Campus', enabled: true }, { id: 'internal-transfer', label: 'Internal transfer', enabled: false }
  ],
  customFields: { jobs: [], candidates: [], requisitions: [] },
  pipelines: [{ id: 'general', name: 'General Hiring', category: 'general', default: true, stages: [
    { id: 'applied', name: 'Applied', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] },
    { id: 'screening', name: 'Screening', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] },
    { id: 'interview', name: 'Interview', required: true, requires: ['interview'], allowedRoles: ['admin', 'hr-head', 'recruiter', 'hiring-manager'] },
    { id: 'offer', name: 'Offer', required: true, requires: ['approval'], allowedRoles: ['admin', 'hr-head'] },
    { id: 'hired', name: 'Hired', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] },
    { id: 'rejected', name: 'Rejected', required: false, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] },
    { id: 'withdrawn', name: 'Withdrawn', required: false, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }
  ], transitions: [{ from: 'applied', to: 'screening' }, { from: 'screening', to: 'interview' }, { from: 'interview', to: 'offer' }, { from: 'offer', to: 'hired' }, { from: 'applied', to: 'rejected' }, { from: 'screening', to: 'rejected' }, { from: 'interview', to: 'rejected' }, { from: 'offer', to: 'rejected' }, { from: 'applied', to: 'withdrawn' }, { from: 'screening', to: 'withdrawn' }, { from: 'interview', to: 'withdrawn' }] }],
  applicationForms: [{ id: 'default-application', name: 'Job Application', language: 'en', sections: [{ id: 'about-you', title: 'About you', fields: [{ field: 'fullName', label: 'Full name', type: 'shortText', required: true }, { field: 'email', label: 'Email', type: 'email', required: true }, { field: 'phone', label: 'Phone', type: 'phone', required: false }, { field: 'resume', label: 'Resume', type: 'file', required: true }, { field: 'consent', label: 'I agree to the privacy notice', type: 'checkbox', required: true }] }], conditions: [], knockoutQuestions: [] }],
  approvalWorkflows: [{ id: 'requisition-approval', name: 'Hiring request approval', module: 'requisitions', steps: [{ roleId: 'hiring-manager' }, { roleId: 'hr-head' }], threshold: null, sequential: true }, { id: 'offer-approval', name: 'Offer approval', module: 'offers', steps: [{ roleId: 'hr-head' }, { roleId: 'ceo' }], threshold: null, sequential: true }],
  requisitions: { requesters: ['hiring-manager', 'hr-head', 'admin'], requireJustification: true, allowReplacement: true, requireBudget: false, requireTargetDate: false, approvalWorkflowId: 'requisition-approval', fields: ['headcount', 'departmentId', 'locationId', 'employmentType', 'urgency', 'targetDate', 'budget', 'salaryBand', 'justification'] },
  interviews: { types: [{ id: 'phone', name: 'Phone' }, { id: 'video', name: 'Video' }, { id: 'onsite', name: 'On-site' }], defaultDurationMinutes: 45, requiredFeedback: true, remindersHours: [24, 1], mockCalendar: true },
  offers: { currency: 'USD', expiryDays: 7, requireApproval: true, approvalWorkflowId: 'offer-approval', compensationComponents: ['baseSalary', 'bonus', 'variableCompensation', 'benefits', 'joiningBonus', 'equity'], templateId: '', mockDocumentGeneration: true },
  tasks: { priorities: ['low', 'normal', 'high', 'urgent'], statuses: ['open', 'in_progress', 'done', 'cancelled'], reminders: true },
  notifications: { channels: ['in_app'], preferences: { assignments: true, approvals: true, interviews: true, overdueFeedback: true, tasks: true, offers: true, joining: true, automation: true } },
  audit: { enabled: true, events: ['create', 'edit', 'archive', 'delete', 'stage_change', 'permission_change', 'approval', 'export', 'offer_change', 'configuration_change'], retentionDays: 730 },
  data: { importEnabled: true, exportEnabled: true, duplicateKeys: ['email', 'phone', 'profileUrl'], mergePolicy: 'review', archiveEnabled: true, retentionDays: 365, deletionApprovalRequired: true },
  savedViews: { enabled: true, allowShared: true, defaults: ['my-candidates', 'interviews-this-week', 'jobs-awaiting-approval', 'overdue-tasks'] },
  sources: [{ id: 'careers-site', name: 'Careers site', enabled: true }, { id: 'referral', name: 'Referral', enabled: true }, { id: 'recruiter-sourcing', name: 'Recruiter sourcing', enabled: true }, { id: 'job-board', name: 'Job board', enabled: true }, { id: 'campus', name: 'Campus', enabled: true }, { id: 'agency', name: 'Agency', enabled: false }],
  documents: { storage: 'local', categories: ['Resume', 'Cover letter', 'Portfolio', 'Offer', 'Identity', 'Other'], allowReplacement: true, defaultVisibility: 'restricted', maxFileSizeMb: 20 },
  delegations: [],
  customStatuses: { candidate: ['active', 'on_hold', 'rejected', 'withdrawn', 'hired'], job: ['draft', 'open', 'paused', 'filled', 'cancelled'], offer: ['draft', 'pending_approval', 'sent', 'accepted', 'rejected', 'expired', 'withdrawn'] },
  scorecards: [{ id: 'general-scorecard', name: 'General interview', competencies: [{ id: 'communication', name: 'Communication', weight: 1, required: true }, { id: 'role-skills', name: 'Role skills', weight: 2, required: true }], ratingScale: { min: 1, max: 5, labels: ['Needs improvement', 'Developing', 'Meets expectations', 'Strong', 'Exceptional'] }, recommendations: ['strong-no', 'no', 'lean-no', 'lean-yes', 'yes', 'strong-yes'], mandatoryFeedback: true }],
  interviewPlans: [{ id: 'standard-plan', name: 'Standard interview plan', category: 'general', rounds: [{ id: 'recruiter-screen', name: 'Recruiter screen', type: 'phone', durationMinutes: 30, scorecardId: 'general-scorecard', requiredFeedback: true }, { id: 'hiring-interview', name: 'Hiring manager interview', type: 'video', durationMinutes: 60, scorecardId: 'general-scorecard', requiredFeedback: true }] }],
  jobTemplates: [{ id: 'general-role', name: 'General role', title: '', description: '', requirements: '', benefits: '', employmentType: 'full-time', pipelineId: 'general', applicationFormId: 'default-application', interviewPlanId: 'standard-plan' }],
  communicationTemplates: [{ id: 'application-received', event: 'application.created', channel: 'email', language: 'en', subject: 'We received your application for {{job}}', body: 'Hello {{candidate}}, thank you for applying to {{company}}. We will be in touch.', approvalRequired: false }, { id: 'interview-invitation', event: 'interview.scheduled', channel: 'email', language: 'en', subject: 'Interview for {{job}}', body: 'Hello {{candidate}}, your interview is scheduled for {{date}}.', approvalRequired: false }],
  automations: [],
  onboardingTemplates: [{ id: 'standard-onboarding', name: 'Standard onboarding', tasks: [{ id: 'collect-documents', title: 'Collect joining documents', ownerRoleId: 'hr-head', daysFromJoining: -7 }, { id: 'manager-introduction', title: 'Plan first-week introduction', ownerRoleId: 'hiring-manager', daysFromJoining: -2 }] }],
  taxonomies: { tags: ['High potential', 'Silver medalist', 'Do not contact'], rejectionReasons: ['Skills mismatch', 'Experience mismatch', 'Role filled', 'Compensation mismatch'], withdrawalReasons: ['Accepted another offer', 'No longer interested'], sources: ['Careers site', 'Referral', 'Recruiter sourcing', 'Job board', 'Campus', 'Social', 'Agency'], documentCategories: ['Resume', 'Cover letter', 'Portfolio', 'Offer', 'Identity', 'Other'], skills: [] },
  privacy: { notice: '', consentRequired: true, retentionDays: 365, deletionWorkflow: true, anonymizeOnDeletion: true, communicationPreferences: true },
  sla: { applicationReviewHours: 72, interviewFeedbackHours: 24, offerApprovalHours: 48, defaultStageDays: 14, escalationAfterHours: 24 },
  workforceTargets: [], integrations: { email: { provider: 'mock', enabled: false }, calendar: { provider: 'mock', enabled: false }, jobBoards: [], hris: { provider: 'mock', enabled: false }, assessments: [], backgroundChecks: [], eSignature: { provider: 'mock', enabled: false }, messaging: [], storage: { provider: 'local', enabled: true }, identity: { provider: 'mock', enabled: false }, webhooks: [] },
  agency: { clients: false, clientContacts: false, contracts: false, mandates: false, submissions: false, placements: false, fees: false, guarantees: false, invoices: false, feeTypes: ['fixed', 'percentage', 'retainer'], defaultGuaranteeDays: 90, clientPipelines: false },
  referrals: { enabled: false, eligibility: 'employees', duplicatePolicy: 'review', rewards: [], milestones: ['hired', 'joined'], payoutStatuses: ['pending', 'approved', 'paid'] },
  settings: { configurationDraft: true }
}

function defaults(preset = 'corporate') {
  const config = clone(baseConfig)
  if (preset === 'agency' || preset === 'recruitment-agency') {
    config.mode = 'agency'
    config.company = { name: 'Northstar Recruitment', slug: 'northstar-recruitment', legalName: '', website: '', supportEmail: '' }
    config.branding.productName = 'Northstar Talent Desk'
    config.terminology = { ...config.terminology, jobs: 'Mandates', candidates: 'Candidates', recruiters: 'Consultants', clients: 'Clients', hires: 'Placements' }
    config.modules = { ...config.modules, agency: true, invoices: true, referrals: false, workforcePlanning: false, onboarding: false }
    config.organization.units = [{ id: 'unit-company', name: 'Northstar Recruitment', type: 'company', parentId: null, defaultHiringOwnerId: '' }, { id: 'unit-delivery', name: 'Delivery', type: 'department', parentId: 'unit-company', defaultHiringOwnerId: '' }]
    for (const user of config.users) if (user.departmentId && !config.organization.units.some(unit => unit.id === user.departmentId)) user.departmentId = 'unit-delivery'
    config.users.push({ id: 'demo-agency-consultant', name: 'Morgan Reed', email: 'consultant@localhost.test', roleId: 'agency-consultant', departmentId: 'unit-delivery', locationId: 'location-hq' })
    config.roles.find(role => role.id === 'recruiter').name = 'Consultant'
    config.terminology.recruiters = 'Consultants'
    config.pipelines = [{ id: 'agency-mandate', name: 'Agency Mandate', category: 'agency', default: true, stages: [
      { id: 'sourced', name: 'Sourced', required: true, requires: [], allowedRoles: ['admin', 'agency-consultant'] }, { id: 'screened', name: 'Screened', required: true, requires: [], allowedRoles: ['admin', 'agency-consultant'] }, { id: 'submitted', name: 'Submitted to Client', required: true, requires: ['client'], allowedRoles: ['admin', 'agency-consultant'] }, { id: 'interview', name: 'Client Interview', required: true, requires: ['interview'], allowedRoles: ['admin', 'agency-consultant'] }, { id: 'placed', name: 'Placed', required: true, requires: ['placement'], allowedRoles: ['admin', 'agency-consultant'] }, { id: 'rejected', name: 'Rejected', required: false, requires: [], allowedRoles: ['admin', 'agency-consultant'] }
    ], transitions: [{ from: 'sourced', to: 'screened' }, { from: 'screened', to: 'submitted' }, { from: 'submitted', to: 'interview' }, { from: 'interview', to: 'placed' }, { from: 'sourced', to: 'rejected' }, { from: 'screened', to: 'rejected' }, { from: 'submitted', to: 'rejected' }, { from: 'interview', to: 'rejected' }] }]
    for (const template of config.jobTemplates) template.pipelineId = 'agency-mandate'
    config.approvalWorkflows = [{ id: 'fee-approval', name: 'Agency fee approval', module: 'invoices', steps: [{ roleId: 'finance' }, { roleId: 'admin' }], threshold: 10000, sequential: true }]
    config.requisitions.approvalWorkflowId = ''
    config.offers.requireApproval = false
    config.offers.approvalWorkflowId = ''
    config.sources = config.sources.map(source => source.id === 'agency' ? { ...source, enabled: true } : source)
    config.agency = { ...config.agency, clients: true, clientContacts: true, contracts: true, mandates: true, submissions: true, placements: true, fees: true, guarantees: true, invoices: true }
  } else if (preset === 'startup') {
    config.mode = 'startup'
    config.company = { name: 'Brightside', slug: 'brightside', legalName: '', website: '', supportEmail: '' }
    config.branding.productName = 'Brightside Hiring'
    config.modules = { ...config.modules, requisitions: false, offers: false, onboarding: false, referrals: true, automation: false, agency: false, invoices: false, talentCrm: false, integrations: false, workforcePlanning: false }
    config.organization.units = [{ id: 'unit-company', name: 'Brightside', type: 'company', parentId: null, defaultHiringOwnerId: '' }]
    config.roles = config.roles.filter(role => ['admin', 'recruiter', 'hiring-manager', 'interviewer', 'employee'].includes(role.id))
    config.users = config.users.filter(user => config.roles.some(role => role.id === user.roleId))
    for (const user of config.users) user.departmentId = 'unit-company'
    config.pipelines = [{ id: 'startup-simple', name: 'Simple Hiring', category: 'general', default: true, stages: [
      { id: 'applied', name: 'Applied', required: true, requires: [], allowedRoles: ['admin', 'recruiter'] }, { id: 'interview', name: 'Interview', required: true, requires: ['interview'], allowedRoles: ['admin', 'recruiter', 'hiring-manager'] }, { id: 'decision', name: 'Decision', required: true, requires: [], allowedRoles: ['admin', 'recruiter', 'hiring-manager'] }, { id: 'hired', name: 'Hired', required: true, requires: [], allowedRoles: ['admin', 'recruiter'] }, { id: 'rejected', name: 'Rejected', required: false, requires: [], allowedRoles: ['admin', 'recruiter'] }
    ], transitions: [{ from: 'applied', to: 'interview' }, { from: 'interview', to: 'decision' }, { from: 'decision', to: 'hired' }, { from: 'applied', to: 'rejected' }, { from: 'interview', to: 'rejected' }] }]
    for (const template of config.jobTemplates) template.pipelineId = 'startup-simple'
    config.approvalWorkflows = []
    config.requisitions = { ...config.requisitions, requesters: ['admin', 'recruiter'], requireJustification: false, approvalWorkflowId: '' }
    config.offers = { ...config.offers, requireApproval: false, approvalWorkflowId: '' }
    config.sla = { applicationReviewHours: 48, interviewFeedbackHours: 24, offerApprovalHours: 24, defaultStageDays: 7, escalationAfterHours: 12 }
  } else if (preset === 'campus') {
    config.mode = 'corporate'
    config.company = { name: 'Campus Careers', slug: 'campus-careers', legalName: '', website: '', supportEmail: '' }
    config.branding.productName = 'Campus Hiring'
    config.terminology = { ...config.terminology, candidates: 'Students', hires: 'Hires' }
    config.modules = { ...config.modules, referrals: false, workforcePlanning: false, agency: false }
    config.employmentTypes = config.employmentTypes.map(type => ({ ...type, enabled: ['internship', 'campus', 'full-time'].includes(type.id) }))
    config.sources = config.sources.map(source => source.id === 'campus' ? { ...source, enabled: true } : source)
    config.pipelines = [{ id: 'campus-hiring', name: 'Campus Hiring', category: 'campus', default: true, stages: [
      { id: 'applied', name: 'Applied', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }, { id: 'screening', name: 'Screening', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }, { id: 'assessment', name: 'Assessment', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }, { id: 'interview', name: 'Interview', required: true, requires: ['interview'], allowedRoles: ['admin', 'hr-head', 'recruiter', 'hiring-manager'] }, { id: 'offer', name: 'Offer', required: true, requires: ['approval'], allowedRoles: ['admin', 'hr-head'] }, { id: 'hired', name: 'Hired', required: true, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }, { id: 'rejected', name: 'Rejected', required: false, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }
    ], transitions: [{ from: 'applied', to: 'screening' }, { from: 'screening', to: 'assessment' }, { from: 'assessment', to: 'interview' }, { from: 'interview', to: 'offer' }, { from: 'offer', to: 'hired' }, { from: 'applied', to: 'rejected' }, { from: 'screening', to: 'rejected' }, { from: 'assessment', to: 'rejected' }, { from: 'interview', to: 'rejected' }] }]
    for (const template of config.jobTemplates) template.pipelineId = 'campus-hiring'
  } else if (preset === 'basic') {
    config.mode = 'startup'
    config.company = { name: 'Acme Company', slug: 'acme-company', legalName: '', website: '', supportEmail: '' }
    config.branding.productName = 'Acme Hiring'
    config.modules = { ...config.modules, requisitions: false, offers: false, onboarding: false, referrals: false, automation: false, agency: false, invoices: false, talentCrm: false, integrations: false, workforcePlanning: false, audit: false }
    config.roles = config.roles.filter(role => ['admin', 'recruiter', 'hiring-manager', 'interviewer'].includes(role.id))
    config.users = config.users.filter(user => config.roles.some(role => role.id === user.roleId))
    for (const user of config.users) user.departmentId = 'unit-company'
    config.approvalWorkflows = []
    config.requisitions = { ...config.requisitions, requesters: ['admin', 'recruiter'], requireJustification: false, approvalWorkflowId: '' }
    config.offers = { ...config.offers, requireApproval: false, approvalWorkflowId: '' }
    config.pipelines = [{ id: 'basic', name: 'Basic Hiring', category: 'general', default: true, stages: [
      { id: 'applied', name: 'Applied', required: true, requires: [], allowedRoles: ['admin', 'recruiter'] }, { id: 'interview', name: 'Interview', required: true, requires: ['interview'], allowedRoles: ['admin', 'recruiter', 'hiring-manager'] }, { id: 'hired', name: 'Hired', required: true, requires: [], allowedRoles: ['admin', 'recruiter'] }, { id: 'rejected', name: 'Rejected', required: false, requires: [], allowedRoles: ['admin', 'recruiter'] }
    ], transitions: [{ from: 'applied', to: 'interview' }, { from: 'interview', to: 'hired' }, { from: 'applied', to: 'rejected' }, { from: 'interview', to: 'rejected' }] }]
    for (const template of config.jobTemplates) template.pipelineId = 'basic'
  } else if (preset !== 'corporate') {
    throw new Error(`Unknown ATS preset "${preset}". Choose corporate, agency, startup, campus, or basic.`)
  }
  for (const form of config.applicationForms || []) for (const section of form.sections || []) for (const field of section.fields || []) {
    const canonicalId = String(field.id || field.key || field.field || '')
    if (canonicalId) Object.assign(field, { id: canonicalId, key: canonicalId, field: canonicalId })
  }
  return config
}

function deepMerge(base, extra) {
  if (!isObject(base) || !isObject(extra)) return clone(extra === undefined ? base : extra)
  const result = clone(base)
  for (const [key, value] of Object.entries(extra)) result[key] = key in base && isObject(base[key]) && isObject(value) ? deepMerge(base[key], value) : clone(value)
  return result
}

function migrateConfig(oldConfig) {
  if (!isObject(oldConfig)) throw new TypeError('Configuration must be a JSON object.')
  const source = clone(oldConfig)
  if (Number.isInteger(source.schemaVersion) && source.schemaVersion > SCHEMA_VERSION) {
    throw new RangeError(`Configuration schema ${source.schemaVersion} is newer than this application supports (maximum ${SCHEMA_VERSION}).`)
  }
  // Canonical V2 data is already migrated. Returning a clone makes migration idempotent
  // and prevents wrapping a prior legacy.sourceConfig recursively on each load.
  if (source.schemaVersion === SCHEMA_VERSION) return source
  const preset = source.mode === 'agency' || source.company?.displayName && /agency|recruit/i.test(source.company.displayName) && source.modules?.clients ? 'agency' : 'corporate'
  const canonical = defaults(preset)
  const oldCompany = source.company || {}
  const oldTerms = source.terminology || {}
  const oldModules = source.modules || {}
  const next = deepMerge(canonical, source)
  next.schemaVersion = SCHEMA_VERSION
  next.mode = ['corporate', 'agency', 'startup'].includes(source.mode) ? source.mode : preset
  next.company = deepMerge(canonical.company, {
    name: oldCompany.name || oldCompany.displayName || canonical.company.name,
    slug: source.slug || oldCompany.slug || slugify(oldCompany.shortName || oldCompany.displayName || oldCompany.name),
    legalName: oldCompany.legalName || '', website: oldCompany.website || '', supportEmail: oldCompany.supportEmail || oldCompany.hrEmail || ''
  })
  next.branding = deepMerge(canonical.branding, {
    productName: oldCompany.atsProductName || source.branding?.productName || canonical.branding.productName,
    primaryColor: source.branding?.primaryColor || canonical.branding.primaryColor,
    secondaryColor: source.branding?.secondaryColor || canonical.branding.secondaryColor,
    accentColor: source.branding?.accentColor || canonical.branding.accentColor,
    logo: source.branding?.squareLogo || source.branding?.logo || '',
    horizontalLogo: source.branding?.horizontalLogo || '', favicon: source.branding?.favicon || '',
    loginHeadline: source.branding?.loginHeadline || canonical.branding.loginHeadline,
    loginSubheading: source.branding?.loginSubheading || canonical.branding.loginSubheading
  })
  const term = (key, fallback) => typeof oldTerms[key] === 'string' ? oldTerms[key] : oldTerms[key]?.plural || oldTerms[key]?.singular || fallback
  next.terminology = { ...canonical.terminology, jobs: term('jobs', term('job', canonical.terminology.jobs)), candidates: term('candidates', term('candidate', canonical.terminology.candidates)), recruiters: term('recruiters', term('consultant', canonical.terminology.recruiters)), clients: term('clients', term('client', canonical.terminology.clients)), hires: term('hires', term('placement', canonical.terminology.hires)) }
  next.modules = { ...canonical.modules, ...Object.fromEntries(Object.entries(oldModules).filter(([, value]) => typeof value === 'boolean')) }
  if (oldModules.publicRoles !== undefined) next.modules.careers = oldModules.publicRoles
  if (oldModules.clients !== undefined && next.mode === 'agency') next.modules.agency = oldModules.clients
  if (Array.isArray(source.pipeline) && !Array.isArray(source.pipelines)) {
    const stages = source.pipeline.filter(stage => stage && stage.key !== 'duplicate').map(stage => ({ id: String(stage.key || slugify(stage.label)), name: String(stage.label || stage.key), required: stage.enabled !== false, requires: [], allowedRoles: ['admin', 'hr-head', 'recruiter'] }))
    if (stages.length) next.pipelines = [{ id: 'migrated-default', name: 'Migrated Pipeline', category: 'general', default: true, stages, transitions: stages.slice(1).map((stage, index) => ({ from: stages[index].id, to: stage.id })) }]
  }
  // Keep the complete source intact so older builder features and customer data survive migration.
  next.legacy = deepMerge(next.legacy || {}, { schemaVersion: source.schemaVersion || source.version || 1, sourceConfig: source })
  return next
}

function validateFields(fields, values = {}) {
  const errors = []
  if (!Array.isArray(fields)) return { valid: false, errors: ['fields must be an array.'] }
  if (!isObject(values)) return { valid: false, errors: ['values must be an object.'] }
  const ids = new Set()
  for (const [index, field] of fields.entries()) {
    const path = `fields[${index}]`
    if (!isObject(field)) { errors.push(`${path} must be an object.`); continue }
    const id = String(field.id || field.key || field.field || '')
    if (!id) errors.push(`${path}.id is required.`)
    else if (ids.has(id)) errors.push(`${path}.id "${id}" is duplicated.`)
    ids.add(id)
    if (!FIELD_TYPES.includes(field.type)) errors.push(`${path}.type must be one of: ${FIELD_TYPES.join(', ')}.`)
    if (!String(field.label || '').trim()) errors.push(`${path}.label is required.`)
    const value = values[id]
    const missing = value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0
    if (field.required && missing) errors.push(`${id} is required.`)
    if (field.type === 'checkbox' && field.required && value !== true) errors.push(`${id} must be checked.`)
    if (missing) continue
    if (field.type === 'number' && !Number.isFinite(Number(value))) errors.push(`${id} must be a number.`)
    if (field.type === 'currency' && (!isObject(value) || !Number.isFinite(Number(value.amount)) || !String(value.currency || '').trim())) errors.push(`${id} must include a numeric amount and currency.`)
    if (field.type === 'checkbox' && typeof value !== 'boolean') errors.push(`${id} must be true or false.`)
    if (field.type === 'date' && Number.isNaN(Date.parse(value))) errors.push(`${id} must be a valid date.`)
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors.push(`${id} must be a valid email address.`)
    if (field.type === 'url' && !/^https?:\/\//i.test(String(value))) errors.push(`${id} must be a valid http(s) URL.`)
    if (['singleSelect', 'multiSelect'].includes(field.type)) {
      const chosen = field.type === 'multiSelect' ? value : [value]
      if (field.type === 'multiSelect' && !Array.isArray(value)) errors.push(`${id} must be a list of choices.`)
      else if (Array.isArray(field.options) && chosen.some(choice => !field.options.some(option => (isObject(option) ? option.value : option) === choice))) errors.push(`${id} contains an unavailable choice.`)
    }
    if (typeof value === 'string' && field.validation?.maxLength && value.length > field.validation.maxLength) errors.push(`${id} exceeds ${field.validation.maxLength} characters.`)
    if (typeof value === 'string' && field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) errors.push(`${id} has an invalid format.`)
    if (typeof value === 'number' && field.validation?.min != null && value < field.validation.min) errors.push(`${id} must be at least ${field.validation.min}.`)
    if (typeof value === 'number' && field.validation?.max != null && value > field.validation.max) errors.push(`${id} must be at most ${field.validation.max}.`)
  }
  return { valid: errors.length === 0, errors }
}

function validateFieldDefinitions(fields) {
  const errors = []
  if (!Array.isArray(fields)) return ['must be an array.']
  const ids = new Set()
  for (const [index, field] of fields.entries()) {
    const path = `[${index}]`
    if (!isObject(field)) { errors.push(`${path} must be an object.`); continue }
    const id = String(field.id || field.key || field.field || '')
    if (!id) errors.push(`${path}.id is required.`)
    else if (ids.has(id)) errors.push(`${path}.id "${id}" is duplicated.`)
    ids.add(id)
    if (!FIELD_TYPES.includes(field.type)) errors.push(`${path}.type must be one of: ${FIELD_TYPES.join(', ')}.`)
    if (!String(field.label || '').trim()) errors.push(`${path}.label is required.`)
    if (['singleSelect', 'multiSelect'].includes(field.type) && (!Array.isArray(field.options) || !field.options.length)) errors.push(`${path}.options must contain at least one option.`)
    if (field.visibility && !['public', 'internal', 'private', 'restricted'].includes(field.visibility)) errors.push(`${path}.visibility is invalid.`)
    if (field.validation?.pattern) {
      try { new RegExp(field.validation.pattern) } catch { errors.push(`${path}.validation.pattern must be a valid regular expression.`) }
    }
  }
  return errors
}

function validateConfig(config) {
  const errors = []
  const warnings = []
  const asArray = value => Array.isArray(value) ? value : []
  const requireArray = (value, path) => {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array.`)
      return false
    }
    return true
  }
  const checkUniqueIds = (rows, path) => {
    if (!requireArray(rows, path)) return new Set()
    const ids = new Set()
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row.id !== 'string' || !row.id.trim()) errors.push(`${path}[${index}].id is required.`)
      else if (ids.has(row.id)) errors.push(`${path}[${index}].id "${row.id}" is duplicated.`)
      else ids.add(row.id)
    }
    return ids
  }
  if (!isObject(config)) return { valid: false, errors: ['Configuration must be an object.'], warnings: [] }
  if (config.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}; call migrateConfig first.`)
  if (!['corporate', 'agency', 'startup'].includes(config.mode)) errors.push('mode must be corporate, agency, or startup.')
  if (!String(config.company?.name || '').trim()) errors.push('company.name is required.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(config.company?.slug || ''))) errors.push('company.slug must contain lowercase letters, numbers, and hyphens.')
  for (const key of ['primaryColor', 'secondaryColor', 'accentColor']) if (!/^#[0-9a-f]{6}$/i.test(String(config.branding?.[key] || ''))) errors.push(`branding.${key} must be a six-digit hex color.`)
  const regional = config.regional || {}
  if (!/^[A-Z]{3}$/.test(String(regional.currency || ''))) errors.push('regional.currency must be a three-letter currency code.')
  try { new Intl.DateTimeFormat('en-US', { timeZone: regional.timezone }).format(0); if (!regional.timezone) throw new Error() } catch { errors.push('regional.timezone must be a valid IANA time zone.') }
  for (const key of ['language', 'numberLocale']) {
    try { if (typeof regional[key] !== 'string' || !regional[key] || !Intl.getCanonicalLocales(regional[key]).length) throw new Error() } catch { errors.push(`regional.${key} must be a valid locale code.`) }
  }
  if (!['12h', '24h'].includes(regional.timeFormat)) errors.push('regional.timeFormat must be 12h or 24h.')
  if (typeof regional.dateFormat !== 'string' || !['YYYY', 'MM', 'DD'].every(token => regional.dateFormat.split(token).length === 2)) errors.push('regional.dateFormat must contain YYYY, MM, and DD once each.')
  if (!Array.isArray(regional.workingDays) || !regional.workingDays.length || regional.workingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || !unique(regional.workingDays)) errors.push('regional.workingDays must contain unique day numbers from 0 (Sunday) to 6 (Saturday).')
  for (const key of ['start', 'end']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(regional.workingHours?.[key] || ''))) errors.push(`regional.workingHours.${key} must be a valid HH:mm time.`)
  if (!isObject(config.modules) || Object.entries(config.modules).some(([, value]) => typeof value !== 'boolean')) errors.push('modules must map feature names to booleans.')
  if (config.mode === 'corporate' && config.modules?.agency) warnings.push('Agency module is enabled in corporate mode; agency workflows and permissions will also be available.')
  if (config.mode === 'agency' && !config.modules?.agency) errors.push('Agency mode requires the agency module to be enabled.')
  if (!requireArray(config.roles, 'roles') || !config.roles.length) errors.push('At least one role is required.')
  const roleIds = checkUniqueIds(config.roles, 'roles')
  for (const [index, role] of asArray(config.roles).entries()) {
    if (!String(role?.name || '').trim()) errors.push(`roles[${index}].name is required.`)
    const validScopes = ['all', 'owned', 'department', 'location', 'assigned']
    if (role?.scope && typeof role.scope === 'string' && !validScopes.includes(role.scope)) errors.push(`roles[${index}].scope is invalid.`)
    if (role?.scope && isObject(role.scope)) for (const [module, scope] of Object.entries(role.scope)) if (!validScopes.includes(scope)) errors.push(`roles[${index}].scope.${module} is invalid.`)
    if (role?.scopes && (!isObject(role.scopes) || Object.values(role.scopes).some(scope => !validScopes.includes(scope)))) errors.push(`roles[${index}].scopes contains an invalid scope.`)
    if (!isObject(role?.permissions)) errors.push(`roles[${index}].permissions must be an object.`)
    else for (const [module, actions] of Object.entries(role.permissions)) {
      if (!Array.isArray(actions) || actions.some(action => !ACTIONS.includes(action))) errors.push(`roles[${index}].permissions.${module} contains an invalid action.`)
    }
  }
  const userIds = checkUniqueIds(config.users, 'users')
  const userEmails = new Set()
  for (const [index, user] of asArray(config.users).entries()) {
    if (user?.email) {
      const email = String(user.email).trim().toLowerCase()
      if (userEmails.has(email)) errors.push(`users[${index}].email must be unique.`)
      userEmails.add(email)
    }
    if (!roleIds.has(user?.roleId)) errors.push(`users[${index}].roleId must reference a configured role.`)
  }
  if (!requireArray(config.users, 'users')) errors.push('At least one local user is required.')
  const org = config.organization || {}
  const unitIds = checkUniqueIds(org.units, 'organization.units')
  const locationIds = checkUniqueIds(org.locations, 'organization.locations')
  checkUniqueIds(org.legalEntities, 'organization.legalEntities')
  checkUniqueIds(org.costCentres || [], 'organization.costCentres')
  if (!Array.isArray(org.reportingRelationships)) errors.push('organization.reportingRelationships must be an array.')
  for (const [index, unit] of asArray(config.organization?.units).entries()) {
    if (!unit?.id || !String(unit.name || '').trim()) errors.push(`organization.units[${index}] requires id and name.`)
    if (unit?.parentId && !unitIds.has(unit.parentId)) errors.push(`organization.units[${index}].parentId references an unknown unit.`)
    if (unit?.parentId === unit?.id) errors.push(`organization.units[${index}] cannot be its own parent.`)
    if (unit?.defaultHiringOwnerId && !userIds.has(unit.defaultHiringOwnerId)) errors.push(`organization.units[${index}].defaultHiringOwnerId references an unknown user.`)
    // A parent chain must terminate; cycles make hierarchy traversal and scoped access ambiguous.
    const visited = new Set([unit?.id])
    let parentId = unit?.parentId
    while (parentId) {
      if (visited.has(parentId)) { errors.push(`organization.units[${index}] is part of a parent hierarchy cycle.`); break }
      visited.add(parentId)
      parentId = asArray(config.organization?.units).find(candidate => candidate?.id === parentId)?.parentId
    }
  }
  for (const [index, entity] of asArray(org.legalEntities).entries()) if (!entity?.id || !String(entity.name || '').trim()) errors.push(`organization.legalEntities[${index}] requires id and name.`)
  for (const [index, centre] of asArray(org.costCentres).entries()) {
    if (!centre?.id || !String(centre.name || '').trim()) errors.push(`organization.costCentres[${index}] requires id and name.`)
    if (centre?.unitId && !unitIds.has(centre.unitId)) errors.push(`organization.costCentres[${index}].unitId references an unknown unit.`)
  }
  for (const [index, relation] of asArray(org.reportingRelationships).entries()) {
    if (relation?.userId && !userIds.has(relation.userId)) errors.push(`organization.reportingRelationships[${index}].userId references an unknown user.`)
    if (relation?.managerId && !userIds.has(relation.managerId)) errors.push(`organization.reportingRelationships[${index}].managerId references an unknown user.`)
    if (relation?.userId && relation.userId === relation.managerId) errors.push(`organization.reportingRelationships[${index}] cannot report to itself.`)
  }
  for (const [index, user] of asArray(config.users).entries()) {
    if (user?.departmentId && !unitIds.has(user.departmentId)) errors.push(`users[${index}].departmentId references an unknown organization unit.`)
    if (user?.locationId && !locationIds.has(user.locationId)) errors.push(`users[${index}].locationId references an unknown location.`)
  }
  if (!requireArray(config.pipelines, 'pipelines') || !config.pipelines.length) errors.push('At least one pipeline is required.')
  const pipelineIds = checkUniqueIds(config.pipelines, 'pipelines')
  let defaultPipelines = 0
  for (const [i, pipeline] of asArray(config.pipelines).entries()) {
    if (!isObject(pipeline)) { errors.push(`pipelines[${i}] must be an object.`); continue }
    if (!pipeline?.id || !String(pipeline.name || '').trim()) errors.push(`pipelines[${i}] requires id and name.`)
    if (pipeline.default) defaultPipelines++
    const stageIds = checkUniqueIds(pipeline.stages, `pipelines[${i}].stages`)
    if (!pipeline.stages?.length) errors.push(`pipelines[${i}].stages must include at least one stage.`)
    for (const [j, stage] of asArray(pipeline.stages).entries()) {
      if (!String(stage?.name || '').trim()) errors.push(`pipelines[${i}].stages[${j}].name is required.`)
      if (stage?.allowedRoles != null && !Array.isArray(stage.allowedRoles)) errors.push(`pipelines[${i}].stages[${j}].allowedRoles must be an array.`)
      for (const roleId of asArray(stage?.allowedRoles)) if (!roleIds.has(roleId)) errors.push(`pipelines[${i}].stages[${j}] references unknown role "${roleId}".`)
      if (stage?.requires != null && (!Array.isArray(stage.requires) || stage.requires.some(value => typeof value !== 'string' || !value.trim()))) errors.push(`pipelines[${i}].stages[${j}].requires must be an array of non-empty strings.`)
      for (const requirement of asArray(stage?.requires)) if (!['interview', 'feedback', 'scorecard', 'approval', 'client', 'placement'].includes(requirement)) errors.push(`pipelines[${i}].stages[${j}].requires contains unsupported requirement "${requirement}".`)
    }
    if (pipeline.transitions != null && !Array.isArray(pipeline.transitions)) errors.push(`pipelines[${i}].transitions must be an array.`)
    const transitionKeys = new Set()
    for (const [j, transition] of asArray(pipeline.transitions).entries()) {
      if (!stageIds.has(transition?.from) || !stageIds.has(transition?.to)) errors.push(`pipelines[${i}].transitions[${j}] references an unknown stage.`)
      if (transition?.from === transition?.to) errors.push(`pipelines[${i}].transitions[${j}] cannot transition a stage to itself.`)
      const key = `${transition?.from}\0${transition?.to}`
      if (transitionKeys.has(key)) errors.push(`pipelines[${i}].transitions[${j}] duplicates a transition.`)
      transitionKeys.add(key)
    }
  }
  if (defaultPipelines !== 1) errors.push('Exactly one pipeline must be marked default.')
  for (const [bucket, fields] of Object.entries(config.customFields || {})) for (const error of validateFieldDefinitions(fields)) errors.push(`customFields.${bucket}${error}`)
  for (const [formIndex, form] of asArray(config.applicationForms).entries()) {
    const formPath = `applicationForms[${formIndex}]`
    if (!isObject(form)) { errors.push(`${formPath} must be an object.`); continue }
    requireArray(form.sections, `${formPath}.sections`)
    const answerKeys = new Set()
    for (const [sectionIndex, section] of asArray(form.sections).entries()) {
      if (!isObject(section)) { errors.push(`${formPath}.sections[${sectionIndex}] must be an object.`); continue }
      const fields = section.fields
      for (const error of validateFieldDefinitions(fields)) errors.push(`applicationForms[${formIndex}].sections[${sectionIndex}].fields${error}`)
      for (const [fieldIndex, field] of asArray(fields).entries()) {
        const ids = [field?.id, field?.key, field?.field].filter(value => value != null && value !== '').map(String)
        if (new Set(ids).size > 1) errors.push(`applicationForms[${formIndex}].sections[${sectionIndex}].fields[${fieldIndex}] id, key, and field must agree.`)
        const key = String(field?.field || field?.key || field?.id || '')
        if (answerKeys.has(key)) errors.push(`${formPath} answer key "${key}" is duplicated across sections.`)
        answerKeys.add(key)
      }
    }
    const allFields = asArray(form.sections).flatMap(section => asArray(section?.fields))
    for (const [key, types] of [['fullName', ['text', 'shortText']], ['email', ['email']]]) {
      const identity = allFields.find(field => (field?.field || field?.key || field?.id) === key)
      if (!identity || !types.includes(identity.type) || identity.required !== true) errors.push(`${formPath} must include the required ${key} identity question with its canonical answer key and type.`)
      if (identity && (identity.enabled === false || identity.visible === false || identity.condition || identity.when || identity.conditions?.length)) errors.push(`${formPath}.${key} must remain visible without conditions.`)
    }
    if (allFields.filter(field => field?.type === 'file').length > 1) errors.push(`${formPath} supports one file upload question; use internal documents for additional attachments.`)
    const consentKeys = new Set(allFields.filter(field => field?.type === 'checkbox' && /consent|privacy|agree/i.test(`${field.field || field.key || field.id} ${field.label}`)).map(field => field.field || field.key || field.id))
    if (config.privacy?.consentRequired !== false) for (const field of allFields.filter(field => consentKeys.has(field?.field || field?.key || field?.id))) if (field.enabled === false || field.visible === false || field.condition || field.when || field.conditions?.length) errors.push(`${formPath} required privacy consent must remain visible without conditions.`)
    const checkCondition = (condition, path, targetRequired = false) => {
      if (!isObject(condition)) { errors.push(`${path} must be an object.`); return }
      const rule = condition.when || condition
      const source = rule.field || rule.key || rule.dependsOn
      const target = condition.targetField || condition.fieldId || condition.target || condition.showField || condition.hideField || (condition.when ? condition.field : null)
      if (!answerKeys.has(source)) errors.push(`${path} references an unknown answer question.`)
      if ((targetRequired || target) && !answerKeys.has(target)) errors.push(`${path} references an unknown target question.`)
      if (['fullName', 'email'].includes(target) || (config.privacy?.consentRequired !== false && consentKeys.has(target))) errors.push(`${path} cannot hide or conditionally show required identity or privacy consent questions.`)
      if (!['equals', 'notEquals', 'not_equals', 'contains', 'truthy', 'falsy', 'isEmpty', 'isNotEmpty', 'eq', 'neq', 'in', 'not_in'].includes(rule.operator || 'equals')) errors.push(`${path}.operator is unsupported.`)
    }
    if (form.conditions != null) requireArray(form.conditions, `${formPath}.conditions`)
    for (const [i, condition] of asArray(form.conditions).entries()) checkCondition(condition, `${formPath}.conditions[${i}]`, true)
    for (const [i, field] of asArray(form.sections).flatMap(section => asArray(section?.fields)).entries()) {
      if (field?.condition || field?.when) checkCondition(field.condition || field.when, `${formPath}.fields[${i}].condition`)
      if (field?.conditions != null) requireArray(field.conditions, `${formPath}.fields[${i}].conditions`)
      for (const [j, condition] of asArray(field?.conditions).entries()) checkCondition(condition, `${formPath}.fields[${i}].conditions[${j}]`)
    }
    if (form.knockoutQuestions != null) requireArray(form.knockoutQuestions, `${formPath}.knockoutQuestions`)
    for (const [i, question] of asArray(form.knockoutQuestions).entries()) if (!answerKeys.has(question?.field || question?.key || question?.id)) errors.push(`${formPath}.knockoutQuestions[${i}] references an unknown answer question.`)
  }
  const workflowIds = new Set(asArray(config.approvalWorkflows).map(workflow => workflow?.id).filter(Boolean))
  checkUniqueIds(config.approvalWorkflows, 'approvalWorkflows')
  for (const [index, workflow] of asArray(config.approvalWorkflows).entries()) {
    if (!workflow?.id || !String(workflow.name || '').trim()) errors.push(`approvalWorkflows[${index}] requires id and name.`)
    if (!Array.isArray(workflow?.steps) || !workflow.steps.length) errors.push(`approvalWorkflows[${index}].steps must include at least one approver.`)
    if (!['requisitions', 'offers', 'invoices'].includes(workflow?.module)) errors.push(`approvalWorkflows[${index}].module must be requisitions, offers, or invoices.`)
    if (workflow?.threshold != null && (workflow.threshold === '' || !Number.isFinite(Number(workflow.threshold)) || Number(workflow.threshold) < 0)) errors.push(`approvalWorkflows[${index}].threshold must be a nonnegative amount or null.`)
    for (const step of asArray(workflow?.steps)) if (!roleIds.has(step?.roleId)) errors.push(`approvalWorkflows[${index}] references unknown role "${step?.roleId}".`)
  }
  if (config.requisitions?.approvalWorkflowId && !workflowIds.has(config.requisitions.approvalWorkflowId)) errors.push('requisitions.approvalWorkflowId references an unknown workflow.')
  if (config.offers?.approvalWorkflowId && !workflowIds.has(config.offers.approvalWorkflowId)) errors.push('offers.approvalWorkflowId references an unknown workflow.')
  for (const module of ['requisitions', 'offers']) if (config[module]?.approvalWorkflowId && asArray(config.approvalWorkflows).find(workflow => workflow?.id === config[module].approvalWorkflowId)?.module !== module) errors.push(`${module}.approvalWorkflowId must reference a workflow for ${module}.`)
  if (config.modules?.offers && config.offers?.requireApproval && !config.offers?.approvalWorkflowId) errors.push('offers.approvalWorkflowId is required when offer approval is enabled.')
  for (const [index, delegation] of asArray(config.delegations).entries()) {
    if (!roleIds.has(delegation?.delegateRoleId)) errors.push(`delegations[${index}].delegateRoleId references an unknown role.`)
    if (delegation?.roleId && !roleIds.has(delegation.roleId)) errors.push(`delegations[${index}].roleId references an unknown role.`)
  }
  if (config.modules?.careers && !config.applicationForms?.length) warnings.push('Careers is enabled but no application form is configured.')
  if (config.modules?.onboarding && !config.onboardingTemplates?.length) warnings.push('Onboarding is enabled but there are no onboarding templates.')
  if (config.modules?.agency && config.mode !== 'agency') warnings.push('Agency workflows should be reviewed for an internal hiring setup.')
  if (config.modules?.invoices && !config.modules?.agency) warnings.push('Invoices are enabled without agency mode; confirm they are needed for your organization.')
  if (!Array.isArray(config.organization?.units)) errors.push('organization.units must be an array.')
  if (!Array.isArray(config.organization?.locations)) errors.push('organization.locations must be an array.')
  if (!Array.isArray(config.approvalWorkflows) || !Array.isArray(config.automations) || !Array.isArray(config.delegations)) errors.push('approvalWorkflows, automations, and delegations must be arrays.')
  if (!config.modules?.agency && Object.entries(config.agency || {}).some(([key, value]) => key !== 'feeTypes' && key !== 'defaultGuaranteeDays' && value === true)) errors.push('Agency workflow settings cannot be enabled while the agency module is disabled.')
  if (config.modules?.agency && config.mode !== 'agency' && config.agency && Object.entries(config.agency).some(([key, value]) => key !== 'feeTypes' && key !== 'defaultGuaranteeDays' && value === true)) warnings.push('Agency workflows are enabled in a non-agency company mode.')
  if (!Number.isFinite(Number(config.privacy?.retentionDays)) || Number(config.privacy?.retentionDays) < 1) errors.push('privacy.retentionDays must be a positive number.')
  for (const [index, target] of asArray(config.workforceTargets).entries()) if (!target?.period || !Number.isFinite(Number(target.target))) errors.push(`workforceTargets[${index}] requires period and numeric target.`)

  // Reusable templates must point at real platform definitions or activation would create broken jobs.
  const formIds = checkUniqueIds(config.applicationForms, 'applicationForms')
  const scorecardIds = checkUniqueIds(config.scorecards || [], 'scorecards')
  for (const [index, scorecard] of asArray(config.scorecards).entries()) {
    const path = `scorecards[${index}]`
    if (!isObject(scorecard)) { errors.push(`${path} must be an object.`); continue }
    if (!String(scorecard.name || '').trim()) errors.push(`${path}.name is required.`)
    const scale = scorecard.ratingScale || {}
    const min = Number(scale.min ?? 1), max = Number(scale.max ?? 5)
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min > 99) errors.push(`${path}.ratingScale must have ordered integer bounds and at most 100 ratings.`)
    if (Array.isArray(scale.labels) && scale.labels.length && scale.labels.length !== max - min + 1) errors.push(`${path}.ratingScale.labels must have one label per rating, starting at the lowest rating.`)
    const competencies = scorecard.competencies || scorecard.criteria || []
    checkUniqueIds(competencies, `${path}.competencies`)
    if (!competencies.length) errors.push(`${path}.competencies must include at least one assessment item.`)
    for (const [i, item] of asArray(competencies).entries()) if (item?.weight != null && (!Number.isFinite(Number(item.weight)) || Number(item.weight) <= 0)) errors.push(`${path}.competencies[${i}].weight must be positive.`)
    if (scorecard.recommendations != null && (!Array.isArray(scorecard.recommendations) || !scorecard.recommendations.length || scorecard.recommendations.some(value => typeof value !== 'string' || !value.trim()) || !unique(scorecard.recommendations))) errors.push(`${path}.recommendations must contain unique, nonempty choices.`)
  }
  for (const key of ['rejectionReasons', 'withdrawalReasons']) if (config.taxonomies?.[key] != null && (!Array.isArray(config.taxonomies[key]) || config.taxonomies[key].some(value => typeof value !== 'string' || !value.trim()) || !unique(config.taxonomies[key]))) errors.push(`taxonomies.${key} must contain unique, nonempty reasons.`)
  const interviewPlanIds = checkUniqueIds(config.interviewPlans || [], 'interviewPlans')
  const employmentTypes = Array.isArray(config.employmentTypes) ? config.employmentTypes : []
  if (!Array.isArray(config.employmentTypes)) errors.push('employmentTypes must be an array.')
  const employmentTypeIds = new Set(employmentTypes.map(type => type?.id).filter(Boolean))
  for (const [index, plan] of asArray(config.interviewPlans).entries()) {
    if (!String(plan?.name || '').trim()) errors.push(`interviewPlans[${index}].name is required.`)
    if (!Array.isArray(plan?.rounds) || !plan.rounds.length) errors.push(`interviewPlans[${index}].rounds must include at least one round.`)
    checkUniqueIds(plan?.rounds, `interviewPlans[${index}].rounds`)
    for (const [roundIndex, round] of asArray(plan?.rounds).entries()) {
      if (round?.scorecardId && !scorecardIds.has(round.scorecardId)) errors.push(`interviewPlans[${index}].rounds[${roundIndex}].scorecardId references an unknown scorecard.`)
      if (round?.durationMinutes != null && (!Number.isFinite(Number(round.durationMinutes)) || Number(round.durationMinutes) < 1)) errors.push(`interviewPlans[${index}].rounds[${roundIndex}].durationMinutes must be positive.`)
    }
  }
  for (const [index, template] of asArray(config.jobTemplates).entries()) {
    if (template?.pipelineId && !pipelineIds.has(template.pipelineId)) errors.push(`jobTemplates[${index}].pipelineId references an unknown pipeline.`)
    if (template?.applicationFormId && !formIds.has(template.applicationFormId)) errors.push(`jobTemplates[${index}].applicationFormId references an unknown application form.`)
    if (template?.interviewPlanId && !interviewPlanIds.has(template.interviewPlanId)) errors.push(`jobTemplates[${index}].interviewPlanId references an unknown interview plan.`)
    if (template?.employmentType && employmentTypeIds.size && !employmentTypeIds.has(template.employmentType)) errors.push(`jobTemplates[${index}].employmentType references an unknown employment type.`)
  }
  return { valid: errors.length === 0, errors, warnings }
}

const presets = [
  { id: 'corporate', name: 'Corporate', description: 'Structured internal hiring with departments, approvals, offers and onboarding.' },
  { id: 'agency', name: 'Recruitment Agency', description: 'Client mandates, consultant ownership, placements, fees, guarantees and invoices.' },
  { id: 'startup', name: 'Startup', description: 'A lightweight hiring setup with a short pipeline and fewer roles and approvals.' },
  { id: 'campus', name: 'Campus', description: 'Campus recruiting with student pipelines, assessments and internship hiring.' },
  { id: 'basic', name: 'Basic', description: 'A minimal hiring workspace with a short pipeline and no approval workflows.' }
]

module.exports = { SCHEMA_VERSION, ACTIONS, FIELD_TYPES, defaults, migrateConfig, validateConfig, validateFields, validateFieldDefinitions, presets }
