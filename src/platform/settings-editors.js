export const ROLE_SCOPES = ['all', 'owned', 'assigned', 'department', 'location']
export const PIPELINE_REQUIREMENTS = [
  ['client', 'Active client linked'],
  ['placement', 'Placement recorded'],
  ['interview', 'Interview completed'],
  ['feedback', 'Interview feedback submitted'],
  ['approval', 'Approval completed'],
]
export const APPROVAL_MODULES = [
  ['requisitions', 'Hiring requests'],
  ['offers', 'Offers'],
  ['invoices', 'Invoices'],
]

export function patchCollectionItem(items, index, relativePath, value) {
  const next = structuredClone(Array.isArray(items) ? items : [])
  if (!Number.isInteger(index) || index < 0 || index >= next.length) throw new RangeError('Collection item index is out of range.')
  const parts = Array.isArray(relativePath) ? [...relativePath] : String(relativePath).split('.').filter(Boolean)
  if (parts[0] === String(index)) parts.shift()
  if (!parts.length) throw new Error('A collection item field path is required.')
  let cursor = next[index]
  for (const key of parts.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[parts.at(-1)] = value
  return next
}

export function reorderPipelineStages(pipeline, fromIndex, toIndex) {
  const stages = [...(pipeline?.stages || [])]
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= stages.length || toIndex >= stages.length) return pipeline
  const [stage] = stages.splice(fromIndex, 1)
  stages.splice(toIndex, 0, stage)
  return { ...pipeline, stages }
}

export function removePipelineStage(pipeline, stageId) {
  const stages = (pipeline?.stages || []).filter((stage) => stage.id !== stageId)
  const transitions = (pipeline?.transitions || []).filter((transition) => transition.from !== stageId && transition.to !== stageId)
  return { ...pipeline, stages, transitions }
}

export function updateCondition(condition, property, value) {
  if (property === 'field' || property === 'operator' || property === 'value') {
    if (condition.when && typeof condition.when === 'object') {
      return { ...condition, when: { ...condition.when, [property]: value } }
    }
  }
  return { ...condition, [property]: value }
}

export function coerceConditionValue(value, fieldType) {
  if (fieldType === 'checkbox') return value === true || value === 'true'
  if (fieldType === 'number' || fieldType === 'currency') return value === '' ? '' : Number(value)
  return value
}

export function choiceLabel(choice) {
  if (choice && typeof choice === 'object') return String(choice.label ?? choice.name ?? choice.value ?? choice.id ?? '')
  return String(choice ?? '')
}

export function updateChoiceList(previous = [], text = '') {
  const labels = String(text).split(',').map((value) => value.trim()).filter(Boolean)
  return labels.map((label, index) => {
    const old = previous[index]
    if (!old || typeof old !== 'object') return label
    if ('label' in old) return { ...old, label }
    if ('name' in old) return { ...old, name: label }
    return { ...old, value: label }
  })
}

export function rolesWithApprovalPermission(roles = [], module) {
  return roles.filter((role) => {
    const moduleActions = role.permissions?.[module] || []
    const globalActions = role.permissions?.['*'] || []
    return [...moduleActions, ...globalActions].some((action) => ['approve', 'administer', '*'].includes(action))
  })
}

export function createNewApplicationForm(makeId) {
  return {
    id: makeId('form'), name: 'New application form', language: 'en',
    sections: [{ id: makeId('section'), title: 'About you', fields: [
      { id: 'fullName', field: 'fullName', key: 'fullName', label: 'Full name', type: 'shortText', required: true },
      { id: 'email', field: 'email', key: 'email', label: 'Email', type: 'email', required: true },
    ] }], conditions: [], knockoutQuestions: [],
  }
}

export function createCustomQuestion(makeId) {
  const id = String(makeId('question')).replace(/[^a-zA-Z0-9_-]/g, '_')
  const key = id || 'custom_question'
  return { id: key, field: key, key, label: 'New question', type: 'shortText', required: false }
}
