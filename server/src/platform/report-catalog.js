'use strict'

/**
 * Report catalog for the local ATS platform.
 *
 * `metrics` must already be computed for the requesting actor (including record
 * scope and permission filtering). This module only selects reportable metrics;
 * it never queries records or invents fallback values.
 */
const REPORTS = Object.freeze({
  overview: Object.freeze({ modules: ['reporting'], select: metrics => metrics }),
  pipeline: Object.freeze({ modules: ['reporting', 'applications'], select: metrics => selectKeys(metrics, ['pipeline']) }),
  sources: Object.freeze({ modules: ['reporting', 'applications'], select: metrics => selectKeys(metrics, ['sources']) }),
  workload: Object.freeze({ modules: ['reporting'], select: metrics => selectKeys(metrics, ['workload']) }),
  offers: Object.freeze({ modules: ['reporting', 'offers'], select: metrics => selectKeys(metrics, ['offers']) }),
  interviews: Object.freeze({ modules: ['reporting', 'interviews'], select: metrics => selectKeys(metrics, ['interviews']) }),
  agency: Object.freeze({ modules: ['reporting', 'agency'], select: (metrics, modules) => {
    const result = selectKeys(metrics, ['agency'])
    if (result.agency && modules.invoices !== true) result.agency = without(result.agency, 'invoices')
    return result
  } }),
  workforce: Object.freeze({ modules: ['reporting', 'workforcePlanning'], select: metrics => selectKeys(metrics, ['workforceTargets']) }),
})

function selectKeys(metrics, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(metrics, key)).map(key => [key, metrics[key]]))
}

function without(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key))
}

/**
 * Return the named report or null when the name is unknown or a required module
 * is disabled. Callers should return a generic 404 for null, so disabled reports
 * and invalid names have the same externally visible behavior.
 */
function getPlatformReport(name, metrics, config = {}) {
  const report = REPORTS[name]
  if (!report || !metrics || typeof metrics !== 'object') return null
  const modules = config?.modules || {}
  if (report.modules.some(module => modules[module] !== true)) return null

  return {
    name,
    generatedAt: metrics.generatedAt,
    metrics: report.select(metrics, modules),
  }
}

function listPlatformReports(config = {}) {
  const modules = config?.modules || {}
  return Object.keys(REPORTS).filter(name => REPORTS[name].modules.every(module => modules[module] === true))
}

module.exports = { getPlatformReport, listPlatformReports }
