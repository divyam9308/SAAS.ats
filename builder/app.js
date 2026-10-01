const $ = selector => document.querySelector(selector)
const clone = value => structuredClone(value)
const STORAGE_KEY = 'ats-platform-builder-draft-v2'

const STEPS = [
  { id: 'company', title: 'Company & preset', help: 'Start with the closest operating model, then make it yours.' },
  { id: 'modules', title: 'Modules', help: 'Choose the capabilities this company will actually use.' },
  { id: 'language', title: 'Brand & terminology', help: 'Make the workspace look and sound like the company.' },
  { id: 'regional', title: 'Region & working time', help: 'Control formats used throughout the ATS.' },
  { id: 'hiring', title: 'Hiring workflow', help: 'Set the default journey from application to hire.' },
  { id: 'review', title: 'Review & generate', help: 'Validate the configuration before creating the workspace.' },
]

const MODULES = [
  ['requisitions','Hiring requests','Request and approve headcount before opening roles.'],
  ['careers','Careers site','Publish jobs and accept configured applications.'],
  ['offers','Offers','Create, approve and track offers.'],
  ['onboarding','Onboarding','Run joining checklists after acceptance.'],
  ['referrals','Employee referrals','Track referrers, milestones and rewards.'],
  ['talentCrm','Talent CRM','Maintain pools, saved searches and follow-ups.'],
  ['workforcePlanning','Workforce planning','Compare hiring targets with actual results.'],
  ['automation','Advanced automation','Run configured event-to-action rules.'],
  ['agency','Recruitment agency mode','Enable clients, submissions, placements and fees.'],
  ['invoices','Invoices','Track agency placement invoices.'],
]

const PRESETS = {
  corporate: ['Corporate','Structured approvals, offers and onboarding.'],
  agency: ['Recruitment agency','Clients, mandates, placements, fees and invoices.'],
  startup: ['Startup','Lean roles, simple approvals and a fast pipeline.'],
  campus: ['Campus-heavy hiring','High-volume graduate applications and structured interviews.'],
  basic: ['Minimal ATS','Core jobs, candidates and applications with fewer modules.'],
}

let presetName = 'corporate'
let presetConfig = null
let config = null
let stepIndex = 0
let selectedPreviewPage = 'auto'

const slugify = value => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[character])
const get = path => path.split('.').reduce((value, key) => value?.[key], config)
function set(path, value) {
  const keys = path.split('.')
  let cursor = config
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {}
  cursor[keys.at(-1)] = value
}

function field(path, label, options = {}) {
  const value = get(path) ?? ''
  const required = options.required ? 'required' : ''
  const help = options.help ? `<small>${escapeHtml(options.help)}</small>` : ''
  if (options.type === 'select') return `<label class="field"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span><select data-path="${path}" ${required}>${options.values.map(item => { const [optionValue, optionLabel] = Array.isArray(item) ? item : [item, item]; return `<option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>` }).join('')}</select>${help}</label>`
  return `<label class="field"><span>${escapeHtml(label)}${options.required ? ' *' : ''}</span><input data-path="${path}" type="${options.type || 'text'}" value="${escapeHtml(value)}" ${required}>${help}</label>`
}

function renderCompany() {
  return `<header class="step-heading"><span>Foundation</span><h2>How does this company hire?</h2><p>${STEPS[0].help}</p></header>
    <div class="preset-grid">${Object.entries(PRESETS).map(([key,[title,description]]) => `<button type="button" class="preset-card ${presetName === key ? 'is-selected' : ''}" data-preset="${key}"><i>${({ agency:'AG', startup:'ST', campus:'CA', basic:'MI', corporate:'CO' })[key]}</i><strong>${title}</strong><span>${description}</span></button>`).join('')}</div>
    <div class="form-grid">${field('company.name','Company name',{required:true})}${field('company.legalName','Legal name')}${field('company.slug','Workspace slug',{required:true,help:'Used for the generated folder and local package.'})}${field('branding.productName','ATS display name',{required:true})}${field('company.website','Company website',{type:'url'})}${field('company.supportEmail','Support email',{type:'email'})}</div>`
}

function renderModules() {
  return `<header class="step-heading"><span>Capabilities</span><h2>Choose the working modules</h2><p>${STEPS[1].help}</p></header><div class="module-grid">${MODULES.map(([key,title,description]) => `<label class="module-card ${get(`modules.${key}`) ? 'is-selected' : ''}"><input type="checkbox" data-path="modules.${key}" ${get(`modules.${key}`) ? 'checked' : ''}><span><strong>${title}</strong><small>${description}</small></span></label>`).join('')}</div><div id="module-warning" class="inline-warning ${get('modules.agency') && !get('modules.invoices') ? '' : 'hidden'}">Agency mode is enabled without invoices. Placement tracking will work, but billing will stay hidden.</div>`
}

function renderLanguage() {
  return `<header class="step-heading"><span>Identity</span><h2>Brand and business language</h2><p>${STEPS[2].help}</p></header><div class="form-grid">${field('branding.primaryColor','Primary colour',{type:'color'})}${field('branding.accentColor','Accent colour',{type:'color'})}${field('branding.colorMode','Default theme',{type:'select',values:[['light','Light'],['dark','Dark']]})}${field('branding.typography','Typography',{type:'select',values:[['system','System'],['sans','Sans serif'],['serif','Serif'],['mono','Monospace']]})}${field('terminology.jobs','Jobs are called')}${field('terminology.candidates','Candidates are called')}${field('terminology.recruiters','Recruiters are called')}${field('terminology.clients','Clients are called')}${field('terminology.hires','Successful hires are called')}</div>`
}

function renderRegional() {
  return `<header class="step-heading"><span>Regional defaults</span><h2>Formats and working time</h2><p>${STEPS[3].help}</p></header><div class="form-grid">${field('regional.currency','Currency',{type:'select',values:['USD','INR','EUR','GBP','CAD','AUD','SGD']})}${field('regional.timezone','IANA time zone',{required:true,help:'Examples: Asia/Kolkata, Europe/London, America/New_York.'})}${field('regional.dateFormat','Date format',{type:'select',values:['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']})}${field('regional.timeFormat','Time format',{type:'select',values:[['12h','12 hour'],['24h','24 hour']]})}${field('regional.language','Language code',{required:true})}${field('regional.numberLocale','Number locale',{required:true})}${field('regional.workingHours.start','Workday starts',{type:'time'})}${field('regional.workingHours.end','Workday ends',{type:'time'})}</div>`
}

function pipelineStageNames() {
  return (config.pipelines?.[0]?.stages || []).map(stage => stage.name).join(', ')
}

function renderHiring() {
  const workflows = config.approvalWorkflows || []
  const requisitionWorkflow = workflows.find(item => item.module === 'requisitions')
  const offerWorkflow = workflows.find(item => item.module === 'offers')
  return `<header class="step-heading"><span>Operating model</span><h2>Default hiring workflow</h2><p>${STEPS[4].help}</p></header>
    <div class="field full"><span>Default pipeline stages</span><input id="pipeline-stages" value="${escapeHtml(pipelineStageNames())}"><small>Comma-separated, in working order. Keep rejected and withdrawn states if your team uses them.</small></div>
    <div class="form-grid"><label class="field"><span>Hiring-request approval</span><select id="requisition-approval"><option value="none" ${!requisitionWorkflow ? 'selected' : ''}>No approval</option><option value="single" ${requisitionWorkflow?.steps?.length === 1 ? 'selected' : ''}>One approver</option><option value="sequential" ${requisitionWorkflow?.steps?.length > 1 ? 'selected' : ''}>Sequential approval</option></select></label><label class="field"><span>Offer approval</span><select id="offer-approval"><option value="none" ${!offerWorkflow ? 'selected' : ''}>No approval</option><option value="single" ${offerWorkflow?.steps?.length === 1 ? 'selected' : ''}>HR approval</option><option value="sequential" ${offerWorkflow?.steps?.length > 1 ? 'selected' : ''}>HR then leadership</option></select></label></div>
    <div class="workflow-note"><strong>Still editable after generation</strong><p>Department-specific pipelines, scorecards, roles, forms and automation rules can be refined inside the generated ATS settings.</p></div>`
}

function reviewWarnings() {
  const warnings = []
  if (get('modules.agency') && !get('modules.invoices')) warnings.push('Agency mode is enabled without invoices.')
  if (!get('modules.careers')) warnings.push('The public careers site will be hidden.')
  if (!get('modules.offers') && get('modules.onboarding')) warnings.push('Onboarding is enabled without the offer module; plans must be started manually.')
  if (!config.pipelines?.[0]?.stages?.length) warnings.push('At least one pipeline stage is required.')
  return warnings
}

function renderReview() {
  const enabled = MODULES.filter(([key]) => get(`modules.${key}`)).map(([,title]) => title)
  const warnings = reviewWarnings()
  return `<header class="step-heading"><span>Ready to build</span><h2>Review the workspace</h2><p>${STEPS[5].help}</p></header>
    ${warnings.length ? `<div class="warning-list"><strong>Review these choices</strong>${warnings.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : '<div class="success-banner">No configuration conflicts detected in this summary.</div>'}
    <div class="review-grid"><article><small>Company</small><strong>${escapeHtml(get('company.name'))}</strong><span>${escapeHtml(get('branding.productName'))} · ${escapeHtml(presetName)}</span></article><article><small>Modules</small><strong>${enabled.length} enabled</strong><span>${escapeHtml(enabled.join(', '))}</span></article><article><small>Hiring</small><strong>${config.pipelines?.[0]?.stages?.length || 0} pipeline stages</strong><span>${escapeHtml(pipelineStageNames())}</span></article><article><small>Region</small><strong>${escapeHtml(get('regional.currency'))} · ${escapeHtml(get('regional.timezone'))}</strong><span>${escapeHtml(get('regional.dateFormat'))} · ${escapeHtml(get('regional.timeFormat'))}</span></article></div>
    <label class="apply-option"><input id="apply-after-generate" type="checkbox" checked><span>Apply this configuration to the local ATS after generation</span></label>
    <details class="advanced"><summary>Advanced configuration JSON</summary><p>Use this only when you need a setting not shown in the guided setup.</p><textarea id="advanced-json" spellcheck="false">${escapeHtml(JSON.stringify(config, null, 2))}</textarea><button id="apply-json" class="button secondary" type="button">Apply JSON changes</button></details>`
}

function renderStep() {
  $('#steps').innerHTML = STEPS.map((step,index) => `<button type="button" data-step="${index}" class="${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-complete' : ''}"><i>${index < stepIndex ? '✓' : index + 1}</i><span><strong>${step.title}</strong><small>${index < stepIndex ? 'Complete' : index === stepIndex ? 'In progress' : 'Not started'}</small></span></button>`).join('')
  $('#step-content').innerHTML = [renderCompany,renderModules,renderLanguage,renderRegional,renderHiring,renderReview][stepIndex]()
  $('#progress-label').textContent = `Step ${stepIndex + 1} of ${STEPS.length}`
  const percent = Math.round((stepIndex + 1) / STEPS.length * 100)
  $('#progress-percent').textContent = `${percent}% complete`
  $('#progress-bar').style.width = `${percent}%`
  $('#back').disabled = stepIndex === 0
  $('#next').textContent = stepIndex === STEPS.length - 1 ? 'Validate & generate ATS' : 'Continue'
  $('#reset-step').disabled = stepIndex === STEPS.length - 1
  bindStep()
  renderPreview()
}

function bindStep() {
  document.querySelectorAll('[data-path]').forEach(control => {
    const update = () => {
      set(control.dataset.path, control.type === 'checkbox' ? control.checked : control.value)
      if (control.dataset.path === 'company.name' && !get('company.slug')) set('company.slug', slugify(control.value))
      if (stepIndex === 1) renderStep()
      else renderPreview()
    }
    const eventName = control.matches('select') || control.type === 'checkbox' ? 'change' : 'input'
    control.addEventListener(eventName, update)
  })
  $('#pipeline-stages')?.addEventListener('input', () => { updatePipeline($('#pipeline-stages').value); renderPreview() })
  $('#requisition-approval')?.addEventListener('change', () => { updateWorkflow('requisitions', $('#requisition-approval').value); renderPreview() })
  $('#offer-approval')?.addEventListener('change', () => { updateWorkflow('offers', $('#offer-approval').value); renderPreview() })
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => loadPreset(button.dataset.preset, true)))
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => { collectStep(); stepIndex = Number(button.dataset.step); showStatus(''); renderStep() }))
  $('#apply-json')?.addEventListener('click', () => {
    try { config = JSON.parse($('#advanced-json').value); showStatus('Advanced JSON applied to this draft.', 'success'); renderStep() }
    catch (error) { showStatus(`Configuration JSON is not valid: ${error.message}`, 'error') }
  })
}

const textFrom = (value, fallback) => String(value || fallback)
function currentTerminology() {
  const source = config.terminology || {}
  const term = (key, fallback) => {
    const value = source[key]
    if (typeof value === 'string') return value
    return value?.plural || value?.singular || fallback
  }
  return {
    jobs: term('jobs', term('job', 'Jobs')),
    candidates: term('candidates', term('candidate', 'Candidates')),
    recruiters: term('recruiters', term('consultant', 'Recruiters')),
    clients: term('clients', term('client', 'Clients')),
    hires: term('hires', source.hiredStage || 'Hires'),
  }
}

function previewPageForStep() {
  return ['dashboard', 'dashboard', 'jobs', 'dashboard', 'pipeline', 'dashboard'][stepIndex] || 'dashboard'
}

function renderPreview() {
  const node = $('#preview-frame')
  if (!node || !config) return
  const requested = selectedPreviewPage === 'auto' ? previewPageForStep() : selectedPreviewPage
  const modules = config.modules || {}
  const normalized = {
    careers: Boolean(modules.careers ?? modules.publicRoles),
    jobs: Boolean(modules.jobs ?? true),
    candidates: Boolean(modules.candidates ?? true),
    pipeline: Boolean(modules.applications ?? true),
  }
  const page = requested === 'careers' && !normalized.careers ? 'dashboard' : requested
  const dark = get('branding.colorMode') === 'dark'
  const primary = safeColor(get('branding.primaryColor'), '#2347c5')
  const accent = safeColor(get('branding.accentColor'), '#13a88a')
  const product = textFrom(get('branding.productName') || get('company.atsProductName'), 'Talent Workspace')
  const company = textFrom(get('company.name') || get('company.displayName'), 'Your Company')
  const terms = currentTerminology()
  const currency = textFrom(get('regional.currency') || get('company.currency'), 'USD')
  const timeZone = textFrom(get('regional.timezone') || get('company.timezone'), 'UTC')
  const dateFormat = textFrom(get('regional.dateFormat') || get('company.dateFormat'), 'DD/MM/YYYY')
  const typefaces = { system:'Inter, ui-sans-serif, system-ui, sans-serif', sans:'Arial, sans-serif', serif:'Georgia, serif', mono:'ui-monospace, monospace' }
  const today = formatPreviewDate(dateFormat, timeZone)
  const sampleTime = formatPreviewTime(get('regional.timeFormat') || '24h', timeZone)
  const safeCurrency = validCurrency(currency)
  const money = new Intl.NumberFormat('en', { style:'currency', currency:safeCurrency, maximumFractionDigits:0 }).format(safeCurrency === 'INR' ? 1850000 : 85000)
  const nav = [
    ['dashboard', 'Overview', true], ['jobs', terms.jobs, normalized.jobs], ['candidates', terms.candidates, normalized.candidates],
    ['pipeline', 'Pipeline', normalized.pipeline], ['requisitions', 'Hiring requests', modules.requisitions],
    ['offers', 'Offers', modules.offers], ['onboarding', 'Onboarding', modules.onboarding],
    ['referrals', 'Referrals', modules.referrals], ['talentCrm', 'Talent pools', modules.talentCrm],
    ['workforcePlanning', 'Workforce plan', modules.workforcePlanning], ['automation', 'Automations', modules.automation],
    ['clients', terms.clients, modules.agency], ['invoices', 'Invoices', modules.invoices], ['careers', 'Careers', normalized.careers],
  ].filter(([, , enabled]) => enabled)
  const titles = { dashboard:'Hiring overview', jobs:terms.jobs, candidates:terms.candidates, pipeline:'Hiring pipeline', careers:`Careers at ${company}`, requisitions:'Hiring requests', offers:'Offers', onboarding:'Onboarding', referrals:'Employee referrals', talentCrm:'Talent pools', workforcePlanning:'Workforce plan', automation:'Automation rules', clients:terms.clients, invoices:'Invoices' }
  const activeLabel = titles[page] || titles.dashboard
  const content = previewContent(page, { terms, currency, money, today, dateFormat, timeZone, company, accent, sampleTime })
  node.dataset.page = page
  node.style.setProperty('--preview-primary', primary)
  node.style.setProperty('--preview-accent', accent)
  node.style.setProperty('--preview-font', typefaces[get('branding.typography')] || typefaces.system)
  node.classList.toggle('is-dark', dark)
  node.innerHTML = `<div class="mock-ats" style="--preview-primary:${escapeHtml(primary)};--preview-accent:${escapeHtml(accent)};--preview-font:${typefaces[get('branding.typography')] || typefaces.system}"><header class="mock-topbar"><div class="mock-brand"><span class="mock-brand-mark">${escapeHtml(product.slice(0,2).toUpperCase())}</span><span><strong>${escapeHtml(product)}</strong><small>${escapeHtml(company)}</small></span></div><span class="mock-user"><i></i> Admin</span></header><div class="mock-body"><nav class="mock-nav" aria-label="Preview navigation">${nav.map(([id,label]) => `<button type="button" data-preview-page="${id}" class="${id === page ? 'is-current' : ''}">${escapeHtml(label)}</button>`).join('')}</nav><main class="mock-main"><div class="mock-page-heading"><div><small>${escapeHtml(today.toUpperCase())}</small><h3>${escapeHtml(activeLabel)}</h3></div><span class="mock-add">+ ${escapeHtml(page === 'jobs' ? `Add ${terms.jobs.replace(/s$/i,'')}` : `New ${page === 'candidates' ? terms.candidates.replace(/s$/i,'') : 'record'}`)}</span></div>${content}</main></div></div>`
  const selector = $('#preview-page')
  if (selector && selector.value !== selectedPreviewPage) selector.value = selectedPreviewPage
}

function validZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone:zone }); return zone } catch { return 'UTC' }
}

function validCurrency(currency) {
  try {
    const normalized = String(currency || '').toUpperCase()
    new Intl.NumberFormat('en', { style:'currency', currency:normalized })
    return normalized
  } catch { return 'USD' }
}

function safeColor(value, fallback) {
  return /^#[\da-f]{6}$/i.test(String(value || '')) ? String(value) : fallback
}

function formatPreviewDate(pattern, zone) {
  const parts = new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:validZone(zone) }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const day = values.day || '01', month = values.month || '01', year = values.year || '2026'
  if (pattern === 'MM/DD/YYYY') return `${month}/${day}/${year}`
  if (pattern === 'YYYY-MM-DD') return `${year}-${month}-${day}`
  return `${day}/${month}/${year}`
}

function formatPreviewTime(format, zone) {
  return new Intl.DateTimeFormat('en', { hour:'2-digit', minute:'2-digit', hour12:format !== '24h', timeZone:validZone(zone) }).format(new Date())
}

function previewContent(page, data) {
  const { terms, money, today, dateFormat, timeZone, company, accent, sampleTime } = data
  if (page === 'careers') return `<section class="career-hero"><small>CAREERS · ${escapeHtml(company.toUpperCase())}</small><h4>Do work that moves people forward.</h4><p>Find a role where your next chapter can start.</p><span class="mock-add">Explore open roles</span></section><div class="mock-list"><strong>Featured opportunities</strong><article><span><b>Senior Product Designer</b><small>Product · Hybrid</small></span><span>Patiala</span></article><article><span><b>Talent Acquisition Partner</b><small>People · Full-time</small></span><span>Remote</span></article></div>`
  if (page === 'pipeline') {
    const stages = config.pipelines?.[0]?.stages || []
    const names = stages.length ? stages.map(stage => stage.name) : ['Applied','Screening','Interview','Offer','Hired']
    return `<div class="mock-pipeline-meta"><span>${escapeHtml(config.pipelines?.[0]?.name || 'General hiring')}</span><span>${names.length} stages</span></div><div class="mock-kanban">${names.slice(0,5).map((stage,index) => `<article><div><strong>${escapeHtml(stage)}</strong><i>${[12,8,5,3,2][index] || 1}</i></div><small>${['Maya Chen','Arjun Mehta','Sam Rivera','Priya Shah','Alex Morgan'][index]}</small><small>${index < names.length - 1 ? 'Updated recently' : 'Ready for next step'}</small></article>`).join('')}</div><div class="mock-approval"><span>Approvals</span><b>${(config.approvalWorkflows || []).length ? `${(config.approvalWorkflows || []).length} workflow${config.approvalWorkflows.length === 1 ? '' : 's'} configured` : 'No approval steps configured'}</b></div>`
  }
  if (page === 'jobs' || page === 'candidates') {
    const isJobs = page === 'jobs'
    return `<div class="mock-stats"><article><small>${isJobs ? 'OPEN' : 'NEW THIS MONTH'}</small><strong>${isJobs ? '12' : '48'}</strong></article><article><small>${isJobs ? 'IN REVIEW' : 'IN PROCESS'}</small><strong>${isJobs ? '4' : '126'}</strong></article><article><small>${isJobs ? 'HIRES YTD' : 'RESPONSE RATE'}</small><strong>${isJobs ? '8' : '72%'}</strong></article></div><div class="mock-list"><div class="mock-list-heading"><strong>${escapeHtml(isJobs ? terms.jobs : terms.candidates)}</strong><small>Updated · ${escapeHtml(today)}</small></div>${isJobs ? `<article><span><b>Senior Software Engineer</b><small>Engineering · Full-time</small></span><span>${escapeHtml(money)}</span><i class="mock-status">Hiring</i></article><article><span><b>Growth Marketing Lead</b><small>Marketing · Hybrid</small></span><span>${escapeHtml(money)}</span><i class="mock-status">New</i></article>` : `<article><span><b>Maya Chen</b><small>Product Designer · Referral</small></span><span>Interview · ${escapeHtml(today)}</span><i class="mock-status">Active</i></article><article><span><b>Arjun Mehta</b><small>Software Engineer · Careers</small></span><span>Screening · ${escapeHtml(today)}</span><i class="mock-status">Active</i></article>`}</div>`
  }
  return `<div class="mock-stats"><article><small>OPEN ${escapeHtml(terms.jobs.toUpperCase())}</small><strong>12</strong><span>Across 4 departments</span></article><article><small>ACTIVE ${escapeHtml(terms.candidates.toUpperCase())}</small><strong>126</strong><span>+18 this month</span></article><article><small>AVERAGE TIME TO HIRE</small><strong>24 days</strong><span>↓ 3 days this quarter</span></article></div><div class="mock-chart"><div><strong>Hiring progress</strong><small>Current quarter</small></div><div class="chart-bars" aria-label="Sample hiring trend">${[40,62,48,76,58,88,67,100,77,92,72,83].map((height,index) => `<i style="height:${height}%;opacity:${.4+index*.05}"></i>`).join('')}</div><div class="chart-legend"><span>Target 18 hires</span><b>12 / 18</b></div></div><div class="mock-list"><div class="mock-list-heading"><strong>Upcoming interviews</strong><small>${escapeHtml(timeZone)} · ${escapeHtml(today)}</small></div><article><span><b>Maya Chen · Product Designer</b><small>Panel interview · Product team</small></span><span>${escapeHtml(today)} · ${escapeHtml(sampleTime)}</span><i class="mock-status">Confirmed</i></article><article><span><b>Arjun Mehta · Software Engineer</b><small>Technical round · Engineering</small></span><span>${escapeHtml(today)} · ${escapeHtml(sampleTime)}</span><i class="mock-status">Feedback due</i></article></div>`
}

$('#preview-page')?.addEventListener('change', event => { selectedPreviewPage = event.target.value; renderPreview() })
$('#preview-frame')?.addEventListener('click', event => {
  const target = event.target.closest('[data-preview-page]')
  if (!target) return
  selectedPreviewPage = target.dataset.previewPage
  const selector = $('#preview-page')
  if (selector) selector.value = selectedPreviewPage
  renderPreview()
})

function collectStep() {
  document.querySelectorAll('[data-path]').forEach(control => set(control.dataset.path, control.type === 'checkbox' ? control.checked : control.value))
  if (stepIndex === 4) {
    updatePipeline($('#pipeline-stages')?.value || '')
    updateWorkflow('requisitions', $('#requisition-approval')?.value || 'none')
    updateWorkflow('offers', $('#offer-approval')?.value || 'none')
  }
}

function updatePipeline(value) {
  const names = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
  const previous = config.pipelines?.[0] || { id:'general', name:'General Hiring', category:'general', default:true }
  if (!names.length) {
    config.pipelines = [{ ...previous, stages:[], transitions:[] }]
    return
  }
  const oldByName = new Map((previous.stages || []).map(stage => [stage.name.toLowerCase(), stage]))
  const stages = names.map(name => oldByName.get(name.toLowerCase()) || { id: slugify(name), name, required: !['rejected','withdrawn','on hold'].includes(name.toLowerCase()), requires: [], allowedRoles: ['admin','hr-head','recruiter'] })
  const terminal = new Set(['rejected','withdrawn','on-hold','on hold'])
  const active = stages.filter(stage => !terminal.has(stage.id) && !terminal.has(stage.name.toLowerCase()))
  const transitions = active.slice(0,-1).map((stage,index) => ({ from: stage.id, to: active[index + 1].id }))
  for (const stage of active.slice(0,-1)) for (const end of stages.filter(item => terminal.has(item.id) || terminal.has(item.name.toLowerCase()))) transitions.push({ from: stage.id, to: end.id })
  config.pipelines = [{ ...previous, stages, transitions }]
}

function updateWorkflow(module, mode) {
  config.approvalWorkflows ??= []
  config.approvalWorkflows = config.approvalWorkflows.filter(item => item.module !== module)
  if (mode === 'none') return
  const singleRole = module === 'offers' ? 'hr-head' : 'hiring-manager'
  const steps = mode === 'single' ? [{ roleId: singleRole }] : module === 'offers' ? [{ roleId:'hr-head' },{ roleId:'ceo' }] : [{ roleId:'hiring-manager' },{ roleId:'hr-head' }]
  config.approvalWorkflows.push({ id:`${module}-approval`, name:`${module === 'offers' ? 'Offer' : 'Hiring request'} approval`, module, steps, threshold:null, sequential:true })
}

function validateCurrentStep() {
  collectStep()
  if (stepIndex === 0) {
    if (!get('company.name')?.trim() || !get('company.slug')?.trim() || !get('branding.productName')?.trim()) return 'Complete the company name, workspace slug and ATS display name.'
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(get('company.slug'))) return 'Workspace slug must use lowercase letters, numbers and single hyphens.'
  }
  if (stepIndex === 3) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: get('regional.timezone') }).format() } catch { return 'Enter a valid IANA time zone, such as Asia/Kolkata.' }
  }
  if (stepIndex === 4 && !config.pipelines?.[0]?.stages?.length) return 'Add at least one pipeline stage.'
  return ''
}

function showStatus(message, kind = '') { const node = $('#status'); node.textContent = message; node.className = kind }

async function loadPreset(name, confirmReplace = false) {
  if (confirmReplace && config && !window.confirm('Replace this draft with the selected preset?')) return
  const response = await fetch(`/api/presets/${encodeURIComponent(name)}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Could not load the preset.')
  presetName = name
  presetConfig = clone(payload)
  config = clone(payload)
  showStatus(`${PRESETS[name][0]} preset loaded. Everything remains editable.`, 'success')
  renderStep()
}

async function validateConfig() {
  collectStep()
  const response = await fetch('/api/validate', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(config) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Validation request failed.')
  if (!result.valid) throw new Error((result.errors || ['Configuration is not valid.']).join('\n'))
  return result
}

async function generate() {
  const button = $('#next')
  button.disabled = true
  button.textContent = 'Generating local workspace…'
  showStatus('Validating the complete configuration…')
  try {
    const result = await validateConfig()
    const response = await fetch('/api/generate', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ config, activate: $('#apply-after-generate')?.checked !== false }) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Generation failed.')
    $('#download').href = payload.archiveUrl
    $('#download').download = `${payload.slug}-ats-platform.tar.gz`
    $('#result-copy').textContent = `${payload.slug} has an independent configuration and SQLite database.${payload.applied?.applied ? ' It is also active in the local ATS.' : ''}`
    $('#result').classList.remove('hidden')
    showStatus([...(result.warnings || []).map(item => `Warning: ${item}`), 'Configuration valid. Workspace generated successfully.'].join('\n'), 'success')
    localStorage.removeItem(STORAGE_KEY)
    $('#result').scrollIntoView({ behavior:'smooth', block:'nearest' })
  } catch (error) { showStatus(error.message, 'error') }
  finally { button.disabled = false; button.textContent = 'Validate & generate ATS' }
}

function resetStep() {
  if (!presetConfig) return
  const paths = { company:['company','branding'], modules:['modules'], language:['branding','terminology'], regional:['regional'], hiring:['pipelines','approvalWorkflows'] }[STEPS[stepIndex].id] || []
  for (const path of paths) config[path] = clone(presetConfig[path])
  showStatus('This section was reset to the selected preset.', 'success')
  renderStep()
}

function exportConfig() {
  collectStep()
  const url = URL.createObjectURL(new Blob([JSON.stringify(config,null,2)], { type:'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `${get('company.slug') || 'company'}.config.json`; link.click(); link.remove(); URL.revokeObjectURL(url)
}

function importConfig(file) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { try { config = JSON.parse(reader.result); presetName = PRESETS[config.settings?.preset] ? config.settings.preset : config.mode === 'agency' || config.modules?.agency ? 'agency' : 'corporate'; stepIndex = 0; showStatus('Configuration imported. Review each section before generating.', 'success'); renderStep() } catch (error) { showStatus(`Could not import configuration: ${error.message}`, 'error') } }
  reader.readAsText(file)
}

$('#back').addEventListener('click', () => { collectStep(); if (stepIndex > 0) stepIndex -= 1; showStatus(''); renderStep() })
$('#next').addEventListener('click', async () => { const error = validateCurrentStep(); if (error) return showStatus(error,'error'); if (stepIndex === STEPS.length - 1) return generate(); stepIndex += 1; showStatus(''); renderStep(); window.scrollTo({ top:0, behavior:'smooth' }) })
$('#reset-step').addEventListener('click', resetStep)
$('#reset-all').addEventListener('click', () => { if (window.confirm('Reset the entire setup to the selected preset?')) { config = clone(presetConfig); stepIndex = 0; localStorage.removeItem(STORAGE_KEY); showStatus('Setup reset.', 'success'); renderStep() } })
$('#save-draft').addEventListener('click', () => { collectStep(); localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetName, config, stepIndex })); showStatus('Draft saved in this browser.', 'success') })
$('#export').addEventListener('click', exportConfig)
$('#import-trigger').addEventListener('click', () => $('#import-file').click())
$('#import-file').addEventListener('change', event => importConfig(event.target.files?.[0]))

async function start() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try { const draft = JSON.parse(saved); presetName = draft.presetName || 'corporate'; config = draft.config; stepIndex = Math.min(Number(draft.stepIndex) || 0, STEPS.length - 1); const response = await fetch(`/api/presets/${presetName}`); presetConfig = await response.json(); renderStep(); showStatus('Saved draft restored.', 'success'); return } catch { localStorage.removeItem(STORAGE_KEY) }
  }
  await loadPreset('corporate')
}

start().catch(error => showStatus(error.message,'error'))
