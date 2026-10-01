'use strict'

// Configured source entries are authoritative when present. Older deployments
// without sources keep accepting existing free-form attribution values.
function sourceOptions(config = {}) {
  if (!Array.isArray(config.sources)) return null
  return config.sources.filter(source => source && source.enabled !== false && source.id && source.name)
    .map(source => ({ id: String(source.id), label: String(source.name) }))
}

function normalizeSource(value, config = {}) {
  if (value == null || String(value).trim() === '') return { valid: true, value }
  const supplied = String(value).trim()
  const options = sourceOptions(config)
  if (options === null) return { valid: true, value: supplied }
  const match = options.find(option => option.id === supplied || option.label === supplied)
  return match ? { valid: true, value: match.label, id: match.id } : { valid: false, value: supplied }
}

function configuredSource(config = {}, id) {
  return (sourceOptions(config) || []).find(option => option.id === id) || null
}

module.exports = { sourceOptions, normalizeSource, configuredSource }
