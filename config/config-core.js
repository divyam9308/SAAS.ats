export const MODULE_KEYS = Object.freeze([
  'dashboard', 'candidates', 'clients', 'jobs', 'applications', 'publicRoles',
  'reports', 'attendance', 'performance', 'invoices', 'admin', 'userManual',
  'aiParsing', 'notifications'
])

export const AUTH_MODES = Object.freeze(['any', 'domain', 'domains', 'whitelist'])
export const FIELD_STATES = Object.freeze(['required', 'optional', 'hidden'])

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => String(value ?? '').trim()

export function validateCompanyConfig(config) {
  const errors = []
  if (!isObject(config)) return { valid: false, errors: ['Configuration must be an object.'] }
  if (config.version !== 1) errors.push('version must be 1.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text(config.slug))) errors.push('slug must use lowercase letters, numbers, and hyphens.')
  if (!text(config.company?.displayName)) errors.push('company.displayName is required.')
  if (!text(config.company?.legalName)) errors.push('company.legalName is required.')
  const fyMonth = Number(config.company?.financialYearStartMonth)
  if (!Number.isInteger(fyMonth) || fyMonth < 1 || fyMonth > 12) errors.push('company.financialYearStartMonth must be between 1 and 12.')
  for (const colorKey of ['primaryColor', 'secondaryColor', 'accentColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(text(config.branding?.[colorKey]))) errors.push(`branding.${colorKey} must be a six-digit hex color.`)
  }
  if (!AUTH_MODES.includes(config.authentication?.mode)) errors.push(`authentication.mode must be one of: ${AUTH_MODES.join(', ')}.`)
  if (!config.authentication?.googleEnabled && !config.authentication?.passwordEnabled) errors.push('At least one authentication provider must be enabled.')
  if (['domain', 'domains'].includes(config.authentication?.mode) && !config.authentication?.allowedDomains?.length) errors.push('authentication.allowedDomains is required for domain mode.')
  if (config.authentication?.mode === 'whitelist' && !config.authentication?.allowedEmails?.length) errors.push('authentication.allowedEmails is required for whitelist mode.')
  for (const key of MODULE_KEYS) {
    if (typeof config.modules?.[key] !== 'boolean') errors.push(`modules.${key} must be true or false.`)
  }
  const pipelineKeys = new Set()
  for (const [index, stage] of (config.pipeline || []).entries()) {
    if (!/^[a-z][a-z0-9_]*$/.test(text(stage?.key))) errors.push(`pipeline[${index}].key must be a stable snake_case key.`)
    if (!text(stage?.label)) errors.push(`pipeline[${index}].label is required.`)
    if (pipelineKeys.has(stage?.key)) errors.push(`pipeline key "${stage.key}" is duplicated.`)
    pipelineKeys.add(stage?.key)
  }
  if (!pipelineKeys.has('duplicate')) errors.push('pipeline must contain the protected duplicate stage.')
  if ((config.pipeline || []).find(stage => stage.key === 'duplicate')?.protected !== true) errors.push('pipeline duplicate stage must be protected.')
  const entityKeys = new Set()
  for (const [index, entity] of (config.billing?.entities || []).entries()) {
    if (!text(entity?.key)) errors.push(`billing.entities[${index}].key is required.`)
    if (!text(entity?.name)) errors.push(`billing.entities[${index}].name is required.`)
    if (!text(entity?.invoicePrefix)) errors.push(`billing.entities[${index}].invoicePrefix is required.`)
    if (!text(entity?.proformaPrefix)) errors.push(`billing.entities[${index}].proformaPrefix is required.`)
    if (entityKeys.has(entity?.key)) errors.push(`billing entity key "${entity.key}" is duplicated.`)
    entityKeys.add(entity?.key)
  }
  for (const [field, state] of Object.entries(config.candidate?.fields || {})) {
    if (!FIELD_STATES.includes(state)) errors.push(`candidate.fields.${field} must be required, optional, or hidden.`)
  }
  if (config.publicCareers?.enabled && config.candidate?.fields?.cv !== 'required') errors.push('candidate.fields.cv must be required when public careers is enabled.')
  return { valid: errors.length === 0, errors }
}

export function assertCompanyConfig(config) {
  const result = validateCompanyConfig(config)
  if (!result.valid) throw new Error(`Invalid company configuration:\n- ${result.errors.join('\n- ')}`)
  return config
}

export function isModuleEnabled(config, key) {
  return config.modules?.[key] !== false
}

export function terminology(config, key, plural = false) {
  const entry = config.terminology?.[key]
  if (typeof entry === 'string') return entry
  return text(entry?.[plural ? 'plural' : 'singular']) || key
}

export function isEmailAllowed(config, emailValue) {
  const email = text(emailValue).toLowerCase()
  if (!email || !email.includes('@')) return false
  const auth = config.authentication || {}
  if (auth.mode === 'any') return true
  const allowedEmails = (auth.allowedEmails || []).map(value => text(value).toLowerCase())
  if (allowedEmails.includes(email)) return true
  if (auth.mode === 'whitelist') return false
  const domain = email.split('@').pop()
  return (auth.allowedDomains || []).map(value => text(value).replace(/^@/, '').toLowerCase()).includes(domain)
}

export function authRestrictionLabel(config) {
  const auth = config.authentication || {}
  if (auth.mode === 'any') return 'Any valid email account is permitted'
  if (auth.mode === 'whitelist') return 'Only approved email accounts are permitted'
  const domains = (auth.allowedDomains || []).map(value => `@${String(value).replace(/^@/, '')}`)
  return domains.length === 1 ? `Only ${domains[0]} accounts are permitted` : `Only ${domains.join(', ')} accounts are permitted`
}

export function fiscalYearStartForDate(dateValue, startMonth = 4) {
  const date = new Date(dateValue)
  const monthIndex = Math.max(1, Math.min(12, Number(startMonth) || 4)) - 1
  return date.getMonth() >= monthIndex ? date.getFullYear() : date.getFullYear() - 1
}

export function fiscalYearLabel(dateValue, startMonth = 4, prefix = 'FY ') {
  const start = fiscalYearStartForDate(dateValue, startMonth)
  return `${prefix}${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function fiscalYearRange(startYear, startMonth = 4) {
  const monthIndex = Math.max(1, Math.min(12, Number(startMonth) || 4)) - 1
  return {
    start: new Date(startYear, monthIndex, 1),
    end: new Date(startYear + 1, monthIndex, 0, 23, 59, 59, 999)
  }
}

export function billingEntity(config, key) {
  return (config.billing?.entities || []).find(entity => entity.key === key) || config.billing?.entities?.[0] || null
}

export function invoicePrefix(config, key, type = 'tax_invoice') {
  const entity = billingEntity(config, key)
  return type === 'proforma_invoice' ? entity?.proformaPrefix : entity?.invoicePrefix
}

export function safeCompanySlug(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}
