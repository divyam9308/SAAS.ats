const fs = require('fs')
const path = require('path')

const CONFIG_PATH = process.env.COMPANY_CONFIG_PATH
  ? path.resolve(process.env.COMPANY_CONFIG_PATH)
  : path.resolve(__dirname, '../../../config/company.config.json')

function loadCompanyConfig() {
  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const required = [
    ['company.displayName', parsed.company?.displayName],
    ['company.financialYearStartMonth', parsed.company?.financialYearStartMonth],
    ['authentication.mode', parsed.authentication?.mode],
    ['modules', parsed.modules],
    ['pipeline', parsed.pipeline]
  ]
  const missing = required.filter(([, value]) => value === undefined || value === null || value === '').map(([key]) => key)
  const month = Number(parsed.company?.financialYearStartMonth)
  if (!Number.isInteger(month) || month < 1 || month > 12) missing.push('company.financialYearStartMonth (1-12)')
  if (missing.length) throw new Error(`Invalid company configuration: ${missing.join(', ')}`)
  return Object.freeze(parsed)
}

const companyConfig = loadCompanyConfig()

function moduleEnabled(key) {
  return companyConfig.modules?.[key] !== false
}

function emailAllowed(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return false
  const auth = companyConfig.authentication || {}
  if (auth.mode === 'any') return true
  if ((auth.allowedEmails || []).map(item => String(item).toLowerCase()).includes(email)) return true
  if (auth.mode === 'whitelist') return false
  const domain = email.split('@').pop()
  return (auth.allowedDomains || []).map(item => String(item).replace(/^@/, '').toLowerCase()).includes(domain)
}

function billingEntities() {
  return companyConfig.billing?.entities || []
}

function billingEntity(key) {
  return billingEntities().find(entity => entity.key === key) || billingEntities()[0] || null
}

function financialYearStartMonth() {
  return Number(companyConfig.company.financialYearStartMonth)
}

module.exports = { CONFIG_PATH, billingEntities, billingEntity, companyConfig, emailAllowed, financialYearStartMonth, loadCompanyConfig, moduleEnabled }

