import rawCompanyConfig from '../../config/company.config.json' with { type: 'json' }
import {
  assertCompanyConfig,
  authRestrictionLabel,
  billingEntity,
  fiscalYearLabel,
  fiscalYearRange,
  fiscalYearStartForDate,
  invoicePrefix,
  isEmailAllowed,
  isModuleEnabled,
  terminology
} from '../../config/config-core.js'

export const companyConfig = Object.freeze(assertCompanyConfig(rawCompanyConfig))
export const moduleEnabled = key => isModuleEnabled(companyConfig, key)
export const term = (key, plural = false) => terminology(companyConfig, key, plural)
export const emailAllowed = email => isEmailAllowed(companyConfig, email)
export const loginRestrictionLabel = () => authRestrictionLabel(companyConfig)
export const configuredBillingEntity = key => billingEntity(companyConfig, key)
export const configuredInvoicePrefix = (key, type) => invoicePrefix(companyConfig, key, type)
export const configuredFiscalYearLabel = date => fiscalYearLabel(date, companyConfig.company.financialYearStartMonth)
export const configuredFiscalYearStart = date => fiscalYearStartForDate(date, companyConfig.company.financialYearStartMonth)
export const configuredFiscalYearRange = year => fiscalYearRange(year, companyConfig.company.financialYearStartMonth)

export function applyCompanyBranding(documentRef = document) {
  const { company, branding } = companyConfig
  const root = documentRef.documentElement
  const rgb = hex => String(hex).replace('#', '').match(/.{2}/g).map(value => Number.parseInt(value, 16)).join(',')
  root.style.setProperty('--brand-primary', branding.primaryColor)
  root.style.setProperty('--brand-secondary', branding.secondaryColor)
  root.style.setProperty('--brand-accent', branding.accentColor)
  root.style.setProperty('--brand-blue', branding.primaryColor)
  root.style.setProperty('--brand-gold', branding.accentColor)
  root.style.setProperty('--brand-blue-rgb', rgb(branding.primaryColor))
  root.style.setProperty('--brand-gold-rgb', rgb(branding.accentColor))
  root.style.setProperty('--modern-primary', branding.primaryColor)
  root.style.setProperty('--modern-navy', branding.primaryColor)
  documentRef.title = `${company.atsProductName} — ${company.tagline}`
  const description = documentRef.querySelector('meta[name="description"]')
  if (description) description.setAttribute('content', `${company.atsProductName} — ${company.tagline}`)
  if (branding.favicon) {
    const favicon = documentRef.querySelector('link[rel="icon"]')
    if (favicon) favicon.setAttribute('href', branding.favicon)
  }
}
