const fieldKey = field => String(field?.field || field?.key || field?.id || field?.name || '')

function allApplicationFields(form) {
  return (form?.sections || []).flatMap(section => section?.fields || [])
}

function fieldTypeFor(form, key) {
  const field = allApplicationFields(form).find(item => fieldKey(item) === String(key))
  return String(field?.type || '').toLowerCase()
}

function typedValue(value, type) {
  if (value == null) return value
  if (['checkbox', 'boolean', 'bool'].includes(type)) {
    if (value === true || value === false) return value
    if (value === 1 || value === 0) return Boolean(value)
    if (typeof value === 'string') {
      if (/^(true|1|yes|on)$/i.test(value.trim())) return true
      if (/^(false|0|no|off)$/i.test(value.trim())) return false
    }
    return value
  }
  if (['number', 'numeric', 'integer', 'decimal', 'currency', 'percentage'].includes(type)) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : value
    if (typeof value === 'string' && value.trim() !== '') {
      const number = Number(value)
      if (Number.isFinite(number)) return number
    }
  }
  return value
}

function conditionParts(condition) {
  const nested = condition?.when && typeof condition.when === 'object' ? condition.when : null
  const source = nested || condition || {}
  return {
    key: source.field || source.key || source.dependsOn || condition?.field || condition?.key || condition?.dependsOn,
    expected: source.value ?? source.equals ?? condition?.value ?? condition?.equals,
    operator: source.operator || condition?.operator || 'equals'
  }
}

function conditionMet(condition, form, values = {}) {
  const { key, expected, operator: rawOperator } = conditionParts(condition)
  if (!key) return true
  const operator = String(rawOperator).replace(/[-_]/g, '').toLowerCase()
  const type = fieldTypeFor(form, key)
  const actual = values?.[key]
  const typedActual = typedValue(actual, type)
  const typedExpected = typedValue(expected, type)
  if (operator === 'truthy') return Boolean(typedActual)
  if (operator === 'falsy') return !typedActual
  if (operator === 'isempty') return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0)
  if (operator === 'isnotempty') return !(actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0))
  if (operator === 'contains') {
    return Array.isArray(typedActual)
      ? typedActual.some(item => typedValue(item, type) === typedExpected)
      : typedActual != null && String(typedActual).includes(String(typedExpected ?? ''))
  }
  if (operator === 'in' || operator === 'notin') {
    const values = Array.isArray(typedExpected) ? typedExpected.map(item => typedValue(item, type)) : [typedExpected]
    const included = Array.isArray(typedActual)
      ? typedActual.some(item => values.includes(typedValue(item, type)))
      : values.includes(typedActual)
    return operator === 'notin' ? !included : included
  }
  const equal = typedActual === typedExpected
  return ['notequals', 'neq'].includes(operator) ? !equal : equal
}

function conditionTarget(condition) {
  return condition?.fieldId || condition?.targetField || condition?.target || condition?.showField || condition?.hideField || condition?.field
}

/** Match application-form field visibility in both the browser and public API. */
export function isApplicationFieldVisible(field, form, values = {}) {
  if (!field || field.enabled === false || field.visible === false) return false
  const ownCondition = field.condition || field.when
  if (ownCondition && !conditionMet(ownCondition, form, values)) return false

  const key = fieldKey(field)
  if (!key) return true
  const conditions = [...(form?.conditions || []), ...(field.conditions || [])]
  const matching = conditions.filter(condition => String(conditionTarget(condition) ?? '') === key)
  return matching.every(condition => {
    const result = conditionMet(condition.when || condition, form, values)
    return condition.action === 'hide' || condition.hideField ? !result : result
  })
}
