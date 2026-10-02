const MODULE_DEPENDENCIES = {
  agency: ['agency workflows', 'client records, mandates, submissions, placements, fees and invoices'],
  invoices: ['invoice workflows', 'agency fee billing and invoice records'],
  offers: ['offer workflow', 'offer approvals and compensation records'],
  onboarding: ['onboarding', 'joining checklists and handoff tasks'],
  careers: ['careers site', 'public job listings and application forms'],
  applications: ['application workflows', 'candidate intake and job application records'],
  referrals: ['employee referrals', 'referral intake and reward tracking'],
  workforcePlanning: ['workforce planning', 'hiring targets and target reports'],
  requisitions: ['hiring requests', 'headcount approvals and request-to-job workflows'],
}

const humanize = (value) => String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const display = (value) => value === undefined ? 'not set' : value === null ? 'none' : typeof value === 'object' ? compactJson(value) : String(value)
function compactJson(value, max = 160) {
  const text = JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function itemIdentity(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { key: `index:${index}`, label: `Item ${index + 1}` }
  const property = ['id', 'key', 'name', 'title', 'label'].find((key) => item[key] != null && String(item[key]).trim())
  const value = property ? String(item[property]) : String(index)
  const label = String(item.name || item.title || item.label || item.key || item.id || `Item ${index + 1}`)
  return { key: `${property || 'index'}:${value}`, label }
}
function summarizeItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return display(item)
  const identity = item.name || item.title || item.label || item.key || item.id || 'Configuration item'
  const counts = Object.entries(item).filter(([, value]) => Array.isArray(value) && value.length)
    .map(([key, value]) => `${value.length} ${humanize(key).toLowerCase()}`)
  return counts.length ? `${identity} (${counts.join(', ')})` : String(identity)
}

export function resolveConfigPath(sectionId, sectionPath, mappings, localPath) {
  const parts = Array.isArray(localPath) ? localPath : String(localPath).split('.').filter(Boolean)
  const path = parts.join('.')
  const mappedPaths = Object.values(mappings || {})
  const alreadyCanonical = mappedPaths.find((mapped) => path === mapped || path.startsWith(`${mapped}.`))
  if (alreadyCanonical) return path
  const [head, ...tail] = parts
  if (mappings?.[head]) return [mappings[head], ...tail].join('.')
  if (sectionId === 'organization' && head === 'company') return ['company', ...tail].join('.')
  if (sectionId === 'organization' && head === 'structure') return ['organization', ...tail].join('.')
  if (sectionPath && (path === sectionPath || path.startsWith(`${sectionPath}.`))) return path
  return sectionPath ? `${sectionPath}.${path}` : path
}

export function getConfigDiff(active = {}, draft = {}, limit = 60) {
  const changes = []
  const push = (path, labels, before, after) => {
    if (changes.length >= limit) return
    changes.push({ path: path || 'configuration', label: labels.join(' › ') || 'Configuration', before: display(before), after: display(after) })
  }
  const walk = (before, after, path, labels) => {
    if (changes.length >= limit) return
    if (Object.is(before, after)) return
    if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
      if (Array.isArray(before)) {
        const objectItems = [...before, ...after].some((item) => item && typeof item === 'object' && !Array.isArray(item))
        if (!objectItems) {
          if (JSON.stringify(before) !== JSON.stringify(after)) push(path, labels, before, after)
          return
        }
        const beforeItems = new Map(before.map((item, index) => [itemIdentity(item, index).key, { item, index }]))
        const afterItems = new Map(after.map((item, index) => [itemIdentity(item, index).key, { item, index }]))
        for (const [key, { item, index }] of beforeItems) {
          const identity = itemIdentity(item, index)
          const segment = `[${encodeURIComponent(key)}]`
          const itemPath = path ? `${path}.${segment}` : segment
          const itemLabels = [...labels, identity.label]
          if (!afterItems.has(key)) push(itemPath, itemLabels, summarizeItem(item), 'removed')
          else walk(item, afterItems.get(key).item, itemPath, itemLabels)
        }
        for (const [key, { item, index }] of afterItems) {
          if (beforeItems.has(key)) continue
          const identity = itemIdentity(item, index)
          const segment = `[${encodeURIComponent(key)}]`
          const itemPath = path ? `${path}.${segment}` : segment
          push(itemPath, [...labels, identity.label], 'not configured', summarizeItem(item))
        }
        const previousOrder = before.map((item, index) => itemIdentity(item, index).key)
        const nextOrder = after.map((item, index) => itemIdentity(item, index).key)
        const sortedPrevious = previousOrder.slice().sort()
        const sortedNext = nextOrder.slice().sort()
        const sameItems = sortedPrevious.length === sortedNext.length && sortedPrevious.every((key, index) => key === sortedNext[index])
        if (sameItems && previousOrder.some((key, index) => key !== nextOrder[index])) {
          push(path ? `${path}.[order]` : '[order]', [...labels, 'Order'], previousOrder.map((key) => itemIdentity(beforeItems.get(key)?.item, beforeItems.get(key)?.index ?? 0).label), nextOrder.map((key) => itemIdentity(afterItems.get(key)?.item, afterItems.get(key)?.index ?? 0).label))
        }
        return
      }
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const key of keys) walk(before[key], after[key], path ? `${path}.${key}` : key, [...labels, humanize(key)])
      return
    }
    push(path, labels, before, after)
  }
  walk(active, draft, '', [])
  return changes
}

export function getDisabledModuleWarnings(before = {}, after = {}) {
  return Object.entries(MODULE_DEPENDENCIES)
    .filter(([module]) => before.modules?.[module] !== false && after.modules?.[module] === false)
    .map(([module, [name, impact]]) => ({ module, name, impact, message: `Disabling ${name} affects ${impact}. Its screens and new actions become unavailable; existing records remain stored and access continues to follow server permissions.` }))
}
