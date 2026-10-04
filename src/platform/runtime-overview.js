const isOpen = (record) => !['done', 'complete', 'completed', 'cancelled', 'canceled', 'rejected', 'withdrawn', 'paid'].includes(String(record?.status || '').toLowerCase())

export function runtimeModuleEnabled(modules, key) {
  if (!modules) return true
  const entry = modules[key]
  if (entry === undefined && key === 'approvals') return modules.requisitions !== false || modules.offers !== false || (modules.agency === true && modules.invoices === true)
  if (entry === undefined && key === 'feedback') return modules.interviews !== false
  return entry === undefined ? true : typeof entry === 'boolean' ? entry : entry.enabled !== false
}

export function buildOperationalQueue(collections = {}) {
  const pending = (rows, states = ['pending', 'in_review', 'pending_approval']) => rows.filter((row) => states.includes(String(row.status || '').toLowerCase()))
  const tasks = (collections.tasks || []).filter(isOpen)
  const interviews = (collections.interviews || []).filter((row) => ['scheduled', 'rescheduled', 'confirmed'].includes(String(row.status || '').toLowerCase()))
  const approvals = pending(collections.approvals || [])
  const invoices = (collections.invoices || []).filter(isOpen)
  const submissions = pending(collections.submissions || [], ['draft', 'pending', 'submitted', 'client_review', 'under_review'])
  return [
    { key: 'approvals', label: 'Approvals waiting', count: approvals.length, route: 'approvals' },
    { key: 'tasks', label: 'Open tasks', count: tasks.length, route: 'tasks' },
    { key: 'interviews', label: 'Scheduled interviews', count: interviews.length, route: 'interviews' },
    ...(collections.submissions ? [{ key: 'submissions', label: 'Submissions in progress', count: submissions.length, route: 'submissions' }] : []),
    ...(collections.invoices ? [{ key: 'invoices', label: 'Invoices to resolve', count: invoices.length, route: 'invoices' }] : []),
  ].filter((item) => item.count > 0)
}
