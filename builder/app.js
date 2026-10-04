import { approvalFor, approvalRoles, editPipeline, newStage, removeStage, reorderStage, selectedPipeline, setApprovalMode, setModule } from './workflow-model.js'
import { resolveCareersCopy, safeCareersAssetUrl } from './runtime/careers-presentation.js'

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
let selectedPreviewVariant = 'auto'
let selectedPipelineId = ''
let reviewedSteps = new Set()

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
  if (options.type === 'textarea') return `<label class="field"><span>${escapeHtml(label)}</span><textarea data-path="${path}" rows="3">${escapeHtml(value)}</textarea>${help}</label>`
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
  return `<header class="step-heading"><span>Identity</span><h2>Brand and business language</h2><p>${STEPS[2].help}</p></header><div class="form-grid">${field('branding.primaryColor','Primary colour',{type:'color'})}${field('branding.accentColor','Accent colour',{type:'color'})}${field('branding.colorMode','Default theme',{type:'select',values:[['light','Light'],['dark','Dark']]})}${field('branding.typography','Typography',{type:'select',values:[['system','System'],['sans','Sans serif'],['serif','Serif'],['mono','Monospace']]})}${field('terminology.jobs','Jobs are called')}${field('terminology.candidates','Candidates are called')}${field('terminology.recruiters','Recruiters are called')}${field('terminology.clients','Clients are called')}${field('terminology.hires','Successful hires are called')}</div><details class="setup-disclosure"><summary>Careers identity and welcome message <span>Public candidate experience</span></summary><div class="form-grid">${field('branding.careersLogo','Careers logo URL',{help:'Use an HTTPS image URL or an asset path available in your workspace.'})}${field('careers.copy.eyebrow','Careers label')}${field('careers.headline','Careers headline')}${field('careers.intro','Welcome message',{type:'textarea'})}${field('careers.copy.apply','Apply button label')}${field('careers.copy.submit','Application submit label')}</div><button type="button" class="button secondary" data-show-preview="careers">Preview careers site</button></details>`
}

function renderRegional() {
  return `<header class="step-heading"><span>Regional defaults</span><h2>Formats and working time</h2><p>${STEPS[3].help}</p></header><div class="form-grid">${field('regional.currency','Currency',{type:'select',values:['USD','INR','EUR','GBP','CAD','AUD','SGD']})}${field('regional.timezone','Time zone',{required:true,help:'Examples: Asia/Kolkata, Europe/London, America/New_York.'})}${field('regional.dateFormat','Date format',{type:'select',values:['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']})}${field('regional.timeFormat','Time format',{type:'select',values:[['12h','12 hour'],['24h','24 hour']]})}${field('regional.language','Language code',{required:true})}${field('regional.numberLocale','Number locale',{required:true})}${field('regional.salaryUnit','Salary period',{type:'select',values:['year','month','hour']})}${field('regional.workingHours.start','Workday starts',{type:'time'})}${field('regional.workingHours.end','Workday ends',{type:'time'})}</div><fieldset class="workdays"><legend>Working days</legend><p>Used when evaluating stage aging and SLA deadlines.</p>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index) => `<label><input type="checkbox" data-workday="${index}" ${(config.regional.workingDays || []).includes(index) ? 'checked' : ''}>${day}</label>`).join('')}</fieldset>`
}

function pipelineStageNames() {
  return (selectedPipeline(config)?.stages || []).map(stage => stage.name).join(' → ')
}

function renderHiring() {
  const pipeline = selectedPipeline(config, selectedPipelineId)
  selectedPipelineId = pipeline?.id || ''
  const pipelineIndex = (config.pipelines || []).indexOf(pipeline)
  return `<header class="step-heading"><span>Operating model</span><h2>Default hiring workflow</h2><p>${STEPS[4].help}</p></header>
    <section class="workflow-editor" aria-label="Hiring pipeline editor"><div class="workflow-editor-heading"><div><h3>Your hiring journey</h3><p>Rename stages without changing their identity or permissions.</p></div><span class="count-badge">${pipeline?.stages?.length || 0} stages</span></div>
    <label class="field"><span>Pipeline</span><select id="pipeline-selector">${(config.pipelines || []).map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selectedPipelineId ? 'selected' : ''}>${escapeHtml(item.name)}${item.default ? ' · Default' : ''}</option>`).join('')}</select></label>
    ${pipeline ? `<div class="pipeline-stage-list">${pipeline.stages.map((stage,index) => `<article class="pipeline-stage"><span class="stage-order" aria-hidden="true">${index + 1}</span><label class="field"><span>Stage ${index + 1} name</span><input data-path="pipelines.${pipelineIndex}.stages.${index}.name" value="${escapeHtml(stage.name)}" required></label><div class="stage-actions"><button type="button" class="stage-action" aria-label="Move ${escapeHtml(stage.name)} up" data-stage-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="stage-action" aria-label="Move ${escapeHtml(stage.name)} down" data-stage-down="${index}" ${index === pipeline.stages.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="stage-action danger" aria-label="Remove ${escapeHtml(stage.name)}" data-stage-remove="${escapeHtml(stage.id)}" ${pipeline.stages.length === 1 ? 'disabled' : ''}>×</button></div><details class="stage-rules"><summary>Stage rules <span>${(stage.allowedRoles || []).length} roles · ${(stage.requires || []).length} requirements</span></summary><fieldset><legend>Who may move an application here?</legend>${(config.roles || []).map(role => `<label><input type="checkbox" data-stage-role="${escapeHtml(role.id)}" data-stage-index="${index}" ${(stage.allowedRoles || []).includes(role.id) ? 'checked' : ''}>${escapeHtml(role.name)}</label>`).join('')}</fieldset><fieldset><legend>Required before entering</legend>${[...new Set(['interview','feedback','approval',...(stage.requires || [])])].map(requirement => `<label><input type="checkbox" data-stage-requirement="${escapeHtml(requirement)}" data-stage-index="${index}" ${(stage.requires || []).includes(requirement) ? 'checked' : ''}>${escapeHtml(humanizePreview(requirement))}</label>`).join('')}</fieldset></details></article>`).join('')}</div><button type="button" id="add-pipeline-stage" class="button secondary">+ Add stage</button>
    <details class="setup-disclosure"><summary>Allowed stage moves <span>${(pipeline.transitions || []).length} configured</span></summary><p class="editor-help">Display order does not change allowed moves. Choose the moves your team can make, including rejection, withdrawal or reopening.</p><div class="transition-list">${(pipeline.transitions || []).map((transition,index) => `<div><span>${escapeHtml(pipeline.stages.find(stage => stage.id === transition.from)?.name || transition.from)} <b aria-hidden="true">→</b> ${escapeHtml(pipeline.stages.find(stage => stage.id === transition.to)?.name || transition.to)}</span><button type="button" class="stage-action danger" data-transition-remove="${index}" aria-label="Remove move ${escapeHtml(transition.from)} to ${escapeHtml(transition.to)}">×</button></div>`).join('')}</div><div class="transition-create"><label class="field"><span>From stage</span><select id="transition-from">${pipeline.stages.map(stage => `<option value="${escapeHtml(stage.id)}">${escapeHtml(stage.name)}</option>`).join('')}</select></label><label class="field"><span>To stage</span><select id="transition-to">${pipeline.stages.map((stage,index) => `<option value="${escapeHtml(stage.id)}" ${index === 1 ? 'selected' : ''}>${escapeHtml(stage.name)}</option>`).join('')}</select></label><button type="button" id="add-transition" class="button secondary">Add move</button></div></details>` : '<p>No pipeline configured. Import a valid configuration or select a preset.</p>'}</section>
    <details class="setup-disclosure"><summary>Approval decisions <span>Requests and offers</span></summary>${renderApproval('requisitions', 'Hiring-request approval')}${renderApproval('offers', 'Offer approval')}</details>
    <div class="workflow-note"><strong>Refine the rest in Settings</strong><p>Application forms, roles, scorecards and interview plans stay editable in the generated ATS. This draft preserves all additional pipelines and approval definitions.</p></div>`
}

function renderApproval(module, label) {
  const workflow = approvalFor(config, module)
  const mode = !workflow ? 'none' : workflow.sequential === false ? 'parallel' : workflow.steps.length === 1 ? 'single' : 'sequential'
  const roles = approvalRoles(config, module)
  const workflowIndex = (config.approvalWorkflows || []).indexOf(workflow)
  return `<section class="approval-setup"><label class="field"><span>${escapeHtml(label)}${config.modules[module] ? '' : ' · Module disabled'}</span><select data-approval-mode="${module}">${[['none','No approval'],['single','One approver'],['sequential','Approvers in order'],['parallel','All approvers in parallel']].map(([value,title]) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label>${workflow ? `<ol class="approval-chain">${workflow.steps.map((step,index) => `<li><label class="field"><span>${mode === 'parallel' ? 'Approver' : 'Step'} ${index + 1}</span><select data-path="approvalWorkflows.${workflowIndex}.steps.${index}.roleId">${roles.map(role => `<option value="${escapeHtml(role.id)}" ${step.roleId === role.id ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}</select></label></li>`).join('')}</ol>` : '<p class="editor-help">Records can proceed without an approval chain.</p>'}</section>`
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
  $('#steps').innerHTML = STEPS.map((step,index) => `<button type="button" data-step="${index}" ${index === stepIndex ? 'aria-current="step"' : ''} class="${index === stepIndex ? 'is-active' : ''} ${reviewedSteps.has(index) ? 'is-complete' : ''}"><i>${reviewedSteps.has(index) ? '✓' : index + 1}</i><span><strong>${step.title}</strong><small>${index === stepIndex ? 'In progress' : reviewedSteps.has(index) ? 'Reviewed' : 'Not reviewed'}</small></span></button>`).join('')
  $('#step-content').innerHTML = [renderCompany,renderModules,renderLanguage,renderRegional,renderHiring,renderReview][stepIndex]()
  $('#progress-label').textContent = `Step ${stepIndex + 1} of ${STEPS.length}`
  const percent = Math.round(reviewedSteps.size / (STEPS.length - 1) * 100)
  $('#progress-percent').textContent = `${reviewedSteps.size} of 5 reviewed`
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
      const value = control.type === 'checkbox' ? control.checked : control.type === 'number' && control.value !== '' ? Number(control.value) : control.value
      if (control.dataset.path.startsWith('modules.')) {
        try { config = setModule(config, control.dataset.path.split('.')[1], value) }
        catch (error) { control.checked = !value; showStatus(error.message, 'error'); return }
      } else set(control.dataset.path, value)
      if (control.dataset.path === 'company.name' && !get('company.slug')) set('company.slug', slugify(control.value))
      reviewedSteps.delete(stepIndex)
      if (stepIndex === 1) renderStep()
      else renderPreview()
    }
    const eventName = control.matches('select') || control.type === 'checkbox' ? 'change' : 'input'
    control.addEventListener(eventName, update)
  })
  $('#pipeline-selector')?.addEventListener('change', event => { selectedPipelineId = event.target.value; selectedPreviewVariant = selectedPipelineId; renderStep() })
  const changePipeline = edit => {
    try { config = editPipeline(config, selectedPipelineId, edit); reviewedSteps.delete(4); renderStep() }
    catch (error) { showStatus(error.message, 'error') }
  }
  $('#add-pipeline-stage')?.addEventListener('click', () => changePipeline(pipeline => ({ ...pipeline, stages: [...pipeline.stages, newStage(pipeline, config.roles)] })))
  document.querySelectorAll('[data-stage-up]').forEach(button => button.addEventListener('click', () => changePipeline(pipeline => reorderStage(pipeline, Number(button.dataset.stageUp), -1))))
  document.querySelectorAll('[data-stage-down]').forEach(button => button.addEventListener('click', () => changePipeline(pipeline => reorderStage(pipeline, Number(button.dataset.stageDown), 1))))
  document.querySelectorAll('[data-stage-remove]').forEach(button => button.addEventListener('click', () => {
    if (window.confirm('Remove this stage and its allowed moves from the draft?')) changePipeline(pipeline => removeStage(pipeline, button.dataset.stageRemove))
  }))
  document.querySelectorAll('[data-stage-role], [data-stage-requirement]').forEach(control => control.addEventListener('change', () => {
    const property = control.dataset.stageRole ? 'allowedRoles' : 'requires'
    const value = control.dataset.stageRole || control.dataset.stageRequirement
    changePipeline(pipeline => {
      const stage = pipeline.stages[Number(control.dataset.stageIndex)]
      const values = new Set(stage[property] || [])
      if (control.checked) values.add(value); else values.delete(value)
      stage[property] = [...values]
      return pipeline
    })
  }))
  document.querySelectorAll('[data-transition-remove]').forEach(button => button.addEventListener('click', () => changePipeline(pipeline => ({ ...pipeline, transitions: pipeline.transitions.filter((_,index) => index !== Number(button.dataset.transitionRemove)) }))))
  $('#add-transition')?.addEventListener('click', () => {
    const from = $('#transition-from').value, to = $('#transition-to').value
    if (from === to) return showStatus('Choose two different stages.', 'error')
    changePipeline(pipeline => {
      if (pipeline.transitions.some(item => item.from === from && item.to === to)) throw new Error('That move is already allowed.')
      return { ...pipeline, transitions: [...pipeline.transitions, { from, to }] }
    })
  })
  document.querySelectorAll('[data-approval-mode]').forEach(control => control.addEventListener('change', () => {
    try { config = setApprovalMode(config, control.dataset.approvalMode, control.value); reviewedSteps.delete(4); renderStep() }
    catch (error) { showStatus(error.message, 'error') }
  }))
  document.querySelectorAll('[data-workday]').forEach(control => control.addEventListener('change', () => {
    set('regional.workingDays', [...document.querySelectorAll('[data-workday]:checked')].map(item => Number(item.dataset.workday)))
    reviewedSteps.delete(3)
    renderPreview()
  }))
  document.querySelectorAll('[data-show-preview]').forEach(button => button.addEventListener('click', () => { selectedPreviewPage = button.dataset.showPreview; renderPreview() }))
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => loadPreset(button.dataset.preset, true).catch(error => showStatus(error.message, 'error'))))
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => { const error = validateCurrentStep(); if (error) return showStatus(error,'error'); if (stepIndex < 5) reviewedSteps.add(stepIndex); stepIndex = Number(button.dataset.step); showStatus(''); renderStep() }))
  $('#apply-json')?.addEventListener('click', async () => {
    try { config = await normalizeImported(JSON.parse($('#advanced-json').value)); reviewedSteps.clear(); showStatus('Advanced JSON applied to this draft.', 'success'); renderStep() }
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

function previewVariants(page) {
  const sources = {
    jobs: config.jobTemplates,
    application: config.applicationForms,
    pipeline: config.pipelines,
    scorecards: config.scorecards,
    requisitions: (config.approvalWorkflows || []).filter(item => item.module === 'requisitions'),
    offers: (config.approvalWorkflows || []).filter(item => item.module === 'offers'),
    onboarding: config.onboardingTemplates,
    communications: config.communicationTemplates,
    automation: config.automations,
  }
  return (sources[page] || []).map((item, index) => ({ id: String(item.id || index), label: item.name || item.title || item.subject || `${humanizePreview(page)} ${index + 1}`, item }))
}

function humanizePreview(value) {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

function selectPreviewVariant(page) {
  const options = previewVariants(page)
  const label = $('#preview-variant-label')
  const selector = $('#preview-variant')
  if (!label || !selector) return null
  label.classList.toggle('hidden', options.length < 2)
  if (!options.length) {
    selector.innerHTML = ''
    selectedPreviewVariant = 'auto'
    return null
  }
  if (!options.some(option => option.id === selectedPreviewVariant)) selectedPreviewVariant = options[0].id
  selector.innerHTML = options.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === selectedPreviewVariant ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
  return options.find(option => option.id === selectedPreviewVariant)?.item || options[0].item
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
  const page = requested
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
  let locale = get('regional.numberLocale') || get('regional.language') || 'en-US'
  try { new Intl.NumberFormat(locale) } catch { locale = 'en-US' }
  const money = new Intl.NumberFormat(locale, { style:'currency', currency:safeCurrency, maximumFractionDigits:0 }).format(safeCurrency === 'INR' ? 1850000 : 85000)
  const nav = [
    ['dashboard', 'Overview', true], ['jobs', terms.jobs, normalized.jobs], ['candidates', terms.candidates, normalized.candidates],
    ['candidateProfile', `${terms.candidates.replace(/s$/i, '')} profile`, normalized.candidates], ['pipeline', 'Pipeline', normalized.pipeline], ['application', 'Application forms', normalized.careers], ['requisitions', 'Hiring requests', modules.requisitions],
    ['scorecards', 'Scorecards', modules.interviews], ['offers', 'Offers', modules.offers], ['onboarding', 'Onboarding', modules.onboarding],
    ['communications', 'Communications', true],
    ['referrals', 'Referrals', modules.referrals], ['talentCrm', 'Talent pools', modules.talentCrm],
    ['workforcePlanning', 'Workforce plan', modules.workforcePlanning], ['automation', 'Automations', modules.automation],
    ['clients', terms.clients, modules.agency], ['submissions', 'Submissions', modules.agency], ['placements', 'Placements', modules.agency], ['invoices', 'Invoices', modules.invoices], ['careers', 'Careers', normalized.careers],
  ].filter(([, , enabled]) => enabled)
  const titles = { dashboard:'Hiring overview', jobs:terms.jobs, application:'Application form', candidates:terms.candidates, candidateProfile:`${terms.candidates.replace(/s$/i, '')} profile`, pipeline:'Hiring pipeline', careers:`Careers at ${company}`, requisitions:'Hiring requests', scorecards:'Interview scorecards', offers:'Offers', onboarding:'Onboarding', communications:'Communications', referrals:'Employee referrals', talentCrm:'Talent pools', workforcePlanning:'Workforce plan', automation:'Automation rules', clients:terms.clients, submissions:'Candidate submissions', placements:'Placements', invoices:'Invoices' }
  const activeLabel = titles[page] || titles.dashboard
  const variant = selectPreviewVariant(page)
  const moduleForPage = { dashboard:'dashboard', jobs:'jobs', candidates:'candidates', candidateProfile:'candidates', pipeline:'applications', application:'careers', careers:'careers', scorecards:'interviews', requisitions:'requisitions', offers:'offers', onboarding:'onboarding', referrals:'referrals', talentCrm:'talentCrm', workforcePlanning:'workforcePlanning', automation:'automation', clients:'agency', submissions:'agency', placements:'agency', invoices:'invoices' }[page]
  const content = moduleForPage && modules[moduleForPage] === false ? `<div class="mock-empty mock-empty-large"><strong>${escapeHtml(activeLabel)} is disabled</strong><span>Enable the module to include this page in the generated ATS.</span></div>` : previewContent(page, { terms, currency, money, today, dateFormat, timeZone, company, accent, sampleTime, variant })
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
  const { terms, money, today, timeZone, company, sampleTime, variant } = data
  if (page === 'careers') {
    const copy = resolveCareersCopy(config.careers)
    const logo = safeCareersAssetUrl(config.branding?.careersLogo || config.branding?.logo)
    const headline = config.careers?.copy?.headline || config.careers?.headline || copy.headline
    const intro = config.careers?.copy?.intro || config.careers?.intro || copy.intro
    return `<section class="career-hero">${logo ? `<img class="preview-careers-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(company)} logo">` : ''}<small>${escapeHtml(copy.eyebrow)} · ${escapeHtml(company)}</small><h4>${escapeHtml(headline)}</h4><p>${escapeHtml(intro)}</p><span class="mock-add">${escapeHtml(copy.apply)}</span></section><div class="mock-list"><strong>${escapeHtml(terms.jobs)}</strong><article><span><b>Senior Product Designer</b><small>Product · ${escapeHtml(config.employmentTypes?.find(type => type.enabled)?.label || 'Full-time')}</small></span><span>Remote</span></article></div><p class="preview-privacy">${escapeHtml(config.careers?.footer || copy.privacyFooter)}</p>`
  }
  if (page === 'pipeline') {
    const pipeline = variant || selectedPipeline(config, selectedPipelineId)
    const stages = pipeline?.stages || []
    const names = stages.length ? stages.map(stage => stage.name) : ['Applied','Screening','Interview','Offer','Hired']
    return `<div class="mock-pipeline-meta"><span>${escapeHtml(pipeline?.name || 'General hiring')}</span><span>${names.length} stages</span></div><div class="mock-kanban">${names.map((stage,index) => `<article><div><strong>${escapeHtml(stage)}</strong><i>${[12,8,5,3,2][index] || 0}</i></div><small>${['Maya Chen','Arjun Mehta','Sam Rivera','Priya Shah','Alex Morgan'][index] || 'No sample records'}</small><small>${index < names.length - 1 ? 'Updated recently' : 'Ready for next step'}</small></article>`).join('')}</div><div class="mock-approval"><span>Allowed moves</span><b>${(pipeline?.transitions || []).length} configured</b></div>`
  }
  if (page === 'jobs' || page === 'candidates') {
    const isJobs = page === 'jobs'
    return `<div class="mock-stats"><article><small>${isJobs ? 'OPEN' : 'NEW THIS MONTH'}</small><strong>${isJobs ? '12' : '48'}</strong></article><article><small>${isJobs ? 'IN REVIEW' : 'IN PROCESS'}</small><strong>${isJobs ? '4' : '126'}</strong></article><article><small>${isJobs ? 'HIRES YTD' : 'RESPONSE RATE'}</small><strong>${isJobs ? '8' : '72%'}</strong></article></div><div class="mock-list"><div class="mock-list-heading"><strong>${escapeHtml(isJobs ? terms.jobs : terms.candidates)}</strong><small>Updated · ${escapeHtml(today)}</small></div>${isJobs ? `<article><span><b>Senior Software Engineer</b><small>Engineering · Full-time</small></span><span>${escapeHtml(money)}</span><i class="mock-status">Hiring</i></article><article><span><b>Growth Marketing Lead</b><small>Marketing · Hybrid</small></span><span>${escapeHtml(money)}</span><i class="mock-status">New</i></article>` : `<article><span><b>Maya Chen</b><small>Product Designer · Referral</small></span><span>Interview · ${escapeHtml(today)}</span><i class="mock-status">Active</i></article><article><span><b>Arjun Mehta</b><small>Software Engineer · Careers</small></span><span>Screening · ${escapeHtml(today)}</span><i class="mock-status">Active</i></article>`}</div>`
  }
  if (page === 'application') {
    const form = variant || config.applicationForms?.[0] || { name:'Application form', sections:[] }
    const sections = form.sections || []
    return `<div class="mock-form"><div class="mock-form-title"><strong>${escapeHtml(form.name || 'Application form')}</strong><small>${escapeHtml(form.language || 'en').toUpperCase()} · ${sections.length} section${sections.length === 1 ? '' : 's'}</small></div>${sections.map(section => `<section><h4>${escapeHtml(section.title || section.name || 'Questions')}</h4>${(section.fields || []).map(field => `<label><span>${escapeHtml(field.label || field.field || field.key)}${field.required ? ' *' : ''}</span><i>${escapeHtml(humanizePreview(field.type || 'short text'))}</i></label>`).join('') || '<small>No fields configured</small>'}</section>`).join('') || '<div class="mock-empty">No application sections configured.</div>'}<button type="button">${escapeHtml(config.careers?.copy?.submit || 'Submit application')}</button></div>`
  }
  if (page === 'candidateProfile') return `<div class="mock-profile"><div class="mock-profile-head"><i>MC</i><span><strong>Maya Chen</strong><small>Product Designer · Active</small></span></div><div class="mock-profile-grid"><article><small>CONTACT</small><b>maya@example.test</b><span>+1 555 010 2040</span></article><article><small>CURRENT STAGE</small><b>${escapeHtml(selectedPipeline(config)?.stages?.[0]?.name || 'Applied')}</b><span>Updated ${escapeHtml(today)}</span></article><article><small>OWNER</small><b>${escapeHtml(terms.recruiters.replace(/s$/i,''))}</b><span>Talent team</span></article><article><small>CONSENT</small><b>Granted</b><span>${escapeHtml(config.privacy?.retentionDays || 365)}-day retention review</span></article></div><div class="mock-activity"><strong>Profile fields</strong>${(config.customFields?.candidates || []).length ? config.customFields.candidates.map(field => `<span>${escapeHtml(field.label || field.id || field.key)}</span>`).join('') : '<span>Experience</span><span>Skills</span><span>Documents</span><span>Activity</span>'}</div></div>`
  if (page === 'scorecards') {
    const scorecard = variant || config.scorecards?.[0] || { name:'Interview scorecard', competencies:[] }
    return `<div class="mock-scorecard"><div><strong>${escapeHtml(scorecard.name || 'Interview scorecard')}</strong><small>${scorecard.mandatoryFeedback ? 'Feedback required before completion' : 'Draft feedback may be saved'}</small></div>${(scorecard.competencies || []).map((item, index) => `<article><span><b>${escapeHtml(item.name || item.label || `Competency ${index + 1}`)}</b><small>Weight ${escapeHtml(item.weight ?? 1)}${item.required ? ' · Required' : ''}</small></span><i>${Array.from({length: Number(scorecard.ratingScale?.max || 5)}, (_, rating) => `<em>${rating + 1}</em>`).join('')}</i></article>`).join('') || '<div class="mock-empty">No competencies configured.</div>'}<footer><span>Recommendation</span><b>${escapeHtml((scorecard.recommendations || ['Yes']).map(humanizePreview).join(' · '))}</b></footer></div>`
  }
  if (page === 'requisitions') {
    const workflow = variant || (config.approvalWorkflows || []).find(item => item.module === 'requisitions')
    return `<div class="mock-stats"><article><small>OPEN REQUESTS</small><strong>6</strong><span>2 awaiting approval</span></article><article><small>PLANNED HEADCOUNT</small><strong>14</strong><span>Across 5 teams</span></article><article><small>APPROVAL SLA</small><strong>${escapeHtml(config.sla?.offerApprovalHours || 48)}h</strong><span>Configured response time</span></article></div>${workflowCard(workflow, 'Hiring request approval')}`
  }
  if (page === 'offers') {
    const workflow = variant || (config.approvalWorkflows || []).find(item => item.module === 'offers')
    return `<div class="mock-document"><div class="mock-document-head"><span><small>OFFER PREVIEW</small><strong>Senior Product Designer</strong></span><i>Draft</i></div><div class="mock-document-grid"><span><small>CANDIDATE</small><b>Maya Chen</b></span><span><small>COMPENSATION</small><b>${escapeHtml(money)}</b></span><span><small>EXPIRES</small><b>${escapeHtml(config.offers?.expiryDays || 7)} days after issue</b></span><span><small>CURRENCY</small><b>${escapeHtml(config.offers?.currency || data.currency)}</b></span></div><div class="mock-chip-list">${(config.offers?.compensationComponents || []).map(component => `<span>${escapeHtml(humanizePreview(component))}</span>`).join('')}</div></div>${workflowCard(workflow, 'Offer approval')}`
  }
  if (page === 'onboarding') {
    const plan = variant || config.onboardingTemplates?.[0] || { name:'Onboarding plan', tasks:[] }
    return `<div class="mock-checklist"><div><strong>${escapeHtml(plan.name || 'Onboarding plan')}</strong><small>${(plan.tasks || []).length} configured tasks</small></div>${(plan.tasks || []).map((task, index) => `<article><i>${index + 1}</i><span><b>${escapeHtml(task.title || task.name || 'Joining task')}</b><small>${escapeHtml(humanizePreview(task.ownerRoleId || 'HR'))} · ${Number(task.daysFromJoining || 0) < 0 ? `${Math.abs(Number(task.daysFromJoining))} days before joining` : `${Number(task.daysFromJoining || 0)} days after joining`}</small></span><em>${task.required === false ? 'Optional' : 'Required'}</em></article>`).join('') || '<div class="mock-empty">No onboarding tasks configured.</div>'}</div>`
  }
  if (page === 'communications') {
    const template = variant || config.communicationTemplates?.[0] || {}
    return `<div class="mock-message"><div><span><small>${escapeHtml(humanizePreview(template.channel || 'email'))}</small><b>${escapeHtml(template.event || 'Configured event')}</b></span><i>${template.approvalRequired ? 'Approval required' : 'Ready to send'}</i></div><label>Subject<strong>${escapeHtml(template.subject || 'Configured message subject')}</strong></label><section>${escapeHtml(template.body || 'Message content will appear here.')}</section><footer><span>Language ${escapeHtml((template.language || 'en').toUpperCase())}</span><b>Mock outbox · no live delivery</b></footer></div>`
  }
  if (page === 'automation') {
    const rule = variant || config.automations?.[0]
    return rule ? `<div class="mock-automation"><div><i>${rule.enabled === false ? 'Paused' : 'Active'}</i><span><strong>${escapeHtml(rule.name || 'Automation rule')}</strong><small>When ${escapeHtml(humanizePreview(rule.trigger?.event || rule.trigger || 'configured event'))}</small></span></div><em>→</em><section>${(rule.actions || []).map(action => `<span>${escapeHtml(humanizePreview(action.type || action.action || 'configured action'))}</span>`).join('') || '<span>No actions configured</span>'}</section></div>` : '<div class="mock-empty mock-empty-large"><strong>No automation rules configured</strong><span>Add a rule in Settings to preview its trigger and actions.</span></div>'
  }
  if (page === 'clients' || page === 'submissions' || page === 'placements' || page === 'invoices') return agencyPreview(page, { money, today, terms })
  if (page === 'referrals') return `<div class="mock-stats"><article><small>ACTIVE REFERRALS</small><strong>18</strong><span>5 this month</span></article><article><small>HIRED</small><strong>4</strong><span>${escapeHtml((config.referrals?.milestones || []).map(humanizePreview).join(' → ') || 'Hired → Joined')}</span></article><article><small>REWARDS</small><strong>3</strong><span>${escapeHtml(humanizePreview(config.referrals?.payoutStatuses?.[0] || 'pending'))}</span></article></div><div class="mock-list"><strong>Recent referrals</strong><article><span><b>Sam Rivera</b><small>Referred by Jamie Lee</small></span><span>Interview</span><i class="mock-status">Active</i></article></div>`
  if (page === 'talentCrm') return `<div class="mock-stats"><article><small>TALENT POOLS</small><strong>6</strong><span>Configured saved groups</span></article><article><small>CONSENTED TALENT</small><strong>284</strong><span>Eligible for follow-up</span></article><article><small>FOLLOW-UPS DUE</small><strong>12</strong><span>This week</span></article></div><div class="mock-list"><strong>Priority pools</strong><article><span><b>Product leadership</b><small>48 people · Shared</small></span><span>Updated ${escapeHtml(today)}</span></article><article><span><b>Engineering silver medalists</b><small>76 people · Private</small></span><span>8 follow-ups</span></article></div>`
  if (page === 'workforcePlanning') return `<div class="mock-stats"><article><small>HIRING TARGET</small><strong>18</strong><span>Current quarter</span></article><article><small>HIRED</small><strong>12</strong><span>67% complete</span></article><article><small>OPEN GAP</small><strong>6</strong><span>Across 3 teams</span></article></div><div class="mock-progress-list"><article><span><b>Engineering</b><small>7 of 9</small></span><i><em style="width:78%"></em></i></article><article><span><b>Product</b><small>3 of 4</small></span><i><em style="width:75%"></em></i></article><article><span><b>Sales</b><small>2 of 5</small></span><i><em style="width:40%"></em></i></article></div>`
  return `<div class="mock-stats"><article><small>OPEN ${escapeHtml(terms.jobs.toUpperCase())}</small><strong>12</strong><span>Across 4 departments</span></article><article><small>ACTIVE ${escapeHtml(terms.candidates.toUpperCase())}</small><strong>126</strong><span>+18 this month</span></article><article><small>AVERAGE TIME TO HIRE</small><strong>24 days</strong><span>↓ 3 days this quarter</span></article></div><div class="mock-chart"><div><strong>Hiring progress</strong><small>Current quarter</small></div><div class="chart-bars" role="img" aria-label="Sample hiring trend">${[40,62,48,76,58,88,67,100,77,92,72,83].map((height,index) => `<i style="height:${height}%;opacity:${.4+index*.05}"></i>`).join('')}</div><div class="chart-legend"><span>Target 18 hires</span><b>12 / 18</b></div></div><div class="mock-list"><div class="mock-list-heading"><strong>Upcoming interviews</strong><small>${escapeHtml(timeZone)} · ${escapeHtml(today)}</small></div><article><span><b>Maya Chen · Product Designer</b><small>Panel interview · Product team</small></span><span>${escapeHtml(today)} · ${escapeHtml(sampleTime)}</span><i class="mock-status">Confirmed</i></article><article><span><b>Arjun Mehta · Software Engineer</b><small>Technical round · Engineering</small></span><span>${escapeHtml(today)} · ${escapeHtml(sampleTime)}</span><i class="mock-status">Feedback due</i></article></div>`
}

function workflowCard(workflow, fallbackName) {
  if (!workflow) return `<div class="mock-empty"><strong>${escapeHtml(fallbackName)}</strong><span>No approval workflow configured.</span></div>`
  return `<div class="mock-workflow"><div><strong>${escapeHtml(workflow.name || fallbackName)}</strong><small>${workflow.sequential === false ? 'Parallel approval' : 'Sequential approval'}${workflow.threshold ? ` · Threshold ${escapeHtml(workflow.threshold)}` : ''}</small></div><section>${(workflow.steps || []).map((step, index) => `<span><i>${index + 1}</i><b>${escapeHtml(humanizePreview(step.roleId || step.userId || 'Approver'))}</b></span>`).join('<em>→</em>') || '<small>No approvers configured</small>'}</section></div>`
}

function agencyPreview(page, { money, today, terms }) {
  const rows = {
    clients: [['Northstar Analytics','Technology','Active'],['Summit Retail','Consumer','Active']],
    submissions: [['Maya Chen','Senior Product Designer','Client review'],['Arjun Mehta','Platform Engineer','Interview']],
    placements: [['Priya Shah','Summit Retail',today],['Alex Morgan','Northstar Analytics',today]],
    invoices: [['INV-2026-014','Northstar Analytics',money],['INV-2026-013','Summit Retail','Paid']],
  }[page] || []
  const title = page === 'clients' ? terms.clients : humanizePreview(page)
  return `<div class="mock-stats"><article><small>${escapeHtml(title.toUpperCase())}</small><strong>${page === 'invoices' ? '8' : '24'}</strong><span>Current active records</span></article><article><small>${page === 'placements' ? 'GUARANTEE ACTIVE' : 'DUE THIS WEEK'}</small><strong>${page === 'invoices' ? '3' : '6'}</strong><span>Needs attention</span></article><article><small>${page === 'invoices' ? 'OUTSTANDING' : 'CONVERSION'}</small><strong>${page === 'invoices' ? escapeHtml(money) : '32%'}</strong><span>Configured agency workflow</span></article></div><div class="mock-list"><div class="mock-list-heading"><strong>${escapeHtml(title)}</strong><small>Agency workspace</small></div>${rows.map(row => `<article><span><b>${escapeHtml(row[0])}</b><small>${escapeHtml(row[1])}</small></span><span>${escapeHtml(row[2])}</span><i class="mock-status">Tracked</i></article>`).join('')}</div>`
}

$('#preview-page')?.addEventListener('change', event => { selectedPreviewPage = event.target.value; selectedPreviewVariant = 'auto'; renderPreview() })
$('#preview-variant')?.addEventListener('change', event => { selectedPreviewVariant = event.target.value; renderPreview() })
$('#preview-frame')?.addEventListener('click', event => {
  const target = event.target.closest('[data-preview-page]')
  if (!target) return
  selectedPreviewPage = target.dataset.previewPage
  const selector = $('#preview-page')
  if (selector) selector.value = selectedPreviewPage
  renderPreview()
})

function collectStep() {
  document.querySelectorAll('[data-path]').forEach(control => set(control.dataset.path, control.type === 'checkbox' ? control.checked : control.type === 'number' && control.value !== '' ? Number(control.value) : control.value))
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
  if (stepIndex === 4 && (config.pipelines || []).some(pipeline => !pipeline.stages?.length || pipeline.stages.some(stage => !stage.name?.trim()))) return 'Give every pipeline at least one stage and name each stage.'
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
  selectedPipelineId = ''
  reviewedSteps.clear()
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
  const paths = { company:['company','branding'], modules:['modules','mode','agency'], language:['branding','terminology','careers'], regional:['regional'], hiring:['pipelines','approvalWorkflows','requisitions','offers'] }[STEPS[stepIndex].id] || []
  for (const path of paths) config[path] = clone(presetConfig[path])
  reviewedSteps.delete(stepIndex)
  showStatus('This section was reset to the selected preset.', 'success')
  renderStep()
}

function exportConfig() {
  collectStep()
  const url = URL.createObjectURL(new Blob([JSON.stringify(config,null,2)], { type:'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `${get('company.slug') || 'company'}.config.json`; link.click(); link.remove(); URL.revokeObjectURL(url)
}

async function normalizeImported(input) {
  const response = await fetch('/api/normalize', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(input) })
  const payload = await response.json()
  if (!response.ok || !payload.valid) throw new Error(payload.error || (payload.errors || []).join('\n') || 'Configuration could not be imported.')
  return payload.config
}

function importConfig(file) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => { try { const imported = await normalizeImported(JSON.parse(reader.result)); config = imported; presetName = PRESETS[config.settings?.preset] ? config.settings.preset : config.mode === 'agency' || config.modules?.agency ? 'agency' : config.mode === 'startup' ? 'startup' : 'corporate'; const response = await fetch(`/api/presets/${presetName}`); presetConfig = await response.json(); reviewedSteps.clear(); selectedPipelineId = ''; stepIndex = 0; showStatus('Configuration imported. Review each section before generating.', 'success'); renderStep() } catch (error) { showStatus(`Could not import configuration: ${error.message}`, 'error') } }
  reader.readAsText(file)
}

$('#back').addEventListener('click', () => { collectStep(); if (stepIndex > 0) stepIndex -= 1; showStatus(''); renderStep() })
$('#next').addEventListener('click', async () => { const error = validateCurrentStep(); if (error) return showStatus(error,'error'); if (stepIndex === STEPS.length - 1) return generate(); reviewedSteps.add(stepIndex); stepIndex += 1; showStatus(''); renderStep(); window.scrollTo({ top:0, behavior:'smooth' }) })
$('#reset-step').addEventListener('click', resetStep)
$('#reset-all').addEventListener('click', () => { if (window.confirm('Reset the entire setup to the selected preset?')) { config = clone(presetConfig); stepIndex = 0; reviewedSteps.clear(); selectedPipelineId = ''; localStorage.removeItem(STORAGE_KEY); showStatus('Setup reset.', 'success'); renderStep() } })
$('#save-draft').addEventListener('click', () => { collectStep(); localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetName, config, stepIndex, reviewedSteps:[...reviewedSteps] })); showStatus('Draft saved in this browser.', 'success') })
$('#export').addEventListener('click', exportConfig)
$('#import-trigger').addEventListener('click', () => $('#import-file').click())
$('#import-file').addEventListener('change', event => importConfig(event.target.files?.[0]))

async function start() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try { const draft = JSON.parse(saved); presetName = PRESETS[draft.presetName] ? draft.presetName : 'corporate'; config = await normalizeImported(draft.config); stepIndex = Math.max(0, Math.min(Number(draft.stepIndex) || 0, STEPS.length - 1)); reviewedSteps = new Set((draft.reviewedSteps || []).filter(index => Number.isInteger(index) && index >= 0 && index < 5)); const response = await fetch(`/api/presets/${presetName}`); presetConfig = await response.json(); renderStep(); showStatus('Saved draft restored.', 'success'); return } catch { localStorage.removeItem(STORAGE_KEY) }
  }
  await loadPreset('corporate')
}

start().catch(error => showStatus(error.message,'error'))
