// Draft-only operations keep stable workflow identities and leave other pipelines intact.
export function selectedPipeline(config, id) {
  return (config.pipelines || []).find(item => item.id === id) || (config.pipelines || []).find(item => item.default) || config.pipelines?.[0]
}

export function editPipeline(config, id, edit) {
  const next = structuredClone(config)
  const index = next.pipelines.findIndex(item => item.id === id)
  if (index < 0) throw new Error('Choose a configured pipeline first.')
  next.pipelines[index] = edit(next.pipelines[index])
  return next
}

export function newStage(pipeline, roles = []) {
  let count = (pipeline.stages || []).length + 1
  while ((pipeline.stages || []).some(stage => stage.id === `stage-${count}`)) count += 1
  return { id: `stage-${count}`, name: 'New stage', required: true, requires: [], allowedRoles: roles.filter(role => ['admin', 'hr-head', 'recruiter', 'agency-consultant'].includes(role.id)).map(role => role.id) }
}

export function removeStage(pipeline, id) {
  if (pipeline.stages.length <= 1) throw new Error('Keep at least one stage in the pipeline.')
  return { ...pipeline, stages: pipeline.stages.filter(stage => stage.id !== id), transitions: (pipeline.transitions || []).filter(item => item.from !== id && item.to !== id) }
}

export function reorderStage(pipeline, index, direction) {
  const stages = [...pipeline.stages]
  const target = index + direction
  if (target < 0 || target >= stages.length) return pipeline
  ;[stages[index], stages[target]] = [stages[target], stages[index]]
  // Display order and permitted transitions are separate buyer choices.
  return { ...pipeline, stages }
}

export function approvalFor(config, module) {
  const policy = config[module] || {}
  if (module === 'offers' && policy.requireApproval === false) return null
  return (config.approvalWorkflows || []).find(item => item.id === policy.approvalWorkflowId && item.module === module) || null
}

export function approvalRoles(config, module) {
  return (config.roles || []).filter(role => ['approve', 'administer', '*'].some(action => (role.permissions?.[module] || []).includes(action) || (role.permissions?.['*'] || []).includes(action)))
}

export function setApprovalMode(config, module, mode) {
  const next = structuredClone(config)
  next[module] ||= {}
  next.approvalWorkflows ||= []
  if (mode === 'none') {
    next[module].approvalWorkflowId = ''
    if (module === 'offers') next.offers.requireApproval = false
    return next
  }
  const existing = approvalFor(next, module)
  const roles = approvalRoles(next, module)
  if (!roles.length) throw new Error('Give at least one role approval access in Settings first.')
  const preferred = module === 'offers' ? ['hr-head', 'ceo', 'admin'] : ['hiring-manager', 'hr-head', 'admin']
  const ordered = [...preferred.map(id => roles.find(role => role.id === id)).filter(Boolean), ...roles.filter(role => !preferred.includes(role.id))]
  let id = existing?.id || `${module}-approval`
  let suffix = 2
  while (!existing && next.approvalWorkflows.some(workflow => workflow.id === id)) id = `${module}-approval-${suffix++}`
  const steps = existing?.steps?.length ? structuredClone(existing.steps) : ordered.slice(0, mode === 'single' ? 1 : 2).map(role => ({ roleId: role.id }))
  if (mode === 'single') steps.splice(1)
  if (mode !== 'single' && steps.length === 1 && ordered.length > 1) steps.push({ roleId: ordered.find(role => role.id !== steps[0].roleId).id })
  const workflow = { ...existing, id, name: existing?.name || `${module === 'offers' ? 'Offer' : 'Hiring request'} approval`, module, steps, threshold: existing?.threshold ?? null, sequential: mode !== 'parallel' }
  const index = next.approvalWorkflows.findIndex(item => item.id === id)
  if (index < 0) next.approvalWorkflows.push(workflow)
  else next.approvalWorkflows[index] = workflow
  next[module].approvalWorkflowId = id
  if (module === 'offers') next.offers.requireApproval = true
  return next
}

export function setModule(config, key, enabled) {
  const next = structuredClone(config)
  next.modules[key] = enabled
  if (key === 'agency' && !enabled) {
    if (next.mode === 'agency') next.mode = 'corporate'
    next.modules.invoices = false
    for (const setting of Object.keys(next.agency || {})) if (typeof next.agency[setting] === 'boolean') next.agency[setting] = false
  }
  if (key === 'agency' && enabled) {
    for (const setting of ['clients', 'clientContacts', 'contracts', 'mandates', 'submissions', 'placements', 'fees', 'guarantees']) next.agency[setting] = true
    next.agency.invoices = Boolean(next.modules.invoices)
  }
  if (key === 'invoices') {
    if (enabled && !next.modules.agency) throw new Error('Enable recruitment agency workflows before invoices.')
    next.agency.invoices = enabled
  }
  return next
}
