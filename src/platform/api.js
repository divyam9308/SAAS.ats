const API_BASE = '/api/platform'

function getDemoUser() {
  try { return localStorage.getItem('ats_demo_user') || '' } catch { return '' }
}

export async function platformRequest(path, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('X-Demo-User', getDemoUser())
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined || options.body instanceof FormData ? options.body : JSON.stringify(options.body),
  })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.error || `Request failed (${response.status})`
    const error = new Error(typeof message === 'string' ? message : 'The request could not be completed.')
    error.status = response.status
    error.details = payload?.details || payload?.errors || null
    throw error
  }
  return payload?.data ?? payload
}

export const platformApi = {
  bootstrap: () => platformRequest('/bootstrap'),
  dashboard: () => platformRequest('/dashboard'),
  list: (kind, query = '') => platformRequest(`/records/${encodeURIComponent(kind)}${query ? `?${query}` : ''}`),
  get: (kind, id) => platformRequest(`/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`),
  create: (kind, data) => platformRequest(`/records/${encodeURIComponent(kind)}`, { method: 'POST', body: { data } }),
  update: (kind, id, data) => platformRequest(`/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { data } }),
  uploadDocument: (kind, id, data) => platformRequest(`/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/documents`, { method: 'POST', body: { data } }),
  documentVersions: (id) => platformRequest(`/documents/${encodeURIComponent(id)}/versions`),
  remove: (kind, id) => platformRequest(`/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  action: (kind, id, action, data = {}) => platformRequest(`/actions/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { method: 'POST', body: { data } }),
  findDuplicates: (kind, data) => platformRequest(`/duplicates/${encodeURIComponent(kind)}`, { method: 'POST', body: { data } }),
  savedViews: () => platformRequest('/saved-views'),
  createSavedView: (data) => platformRequest('/saved-views', { method: 'POST', body: { data } }),
  updateSavedView: (id, data) => platformRequest(`/saved-views/${encodeURIComponent(id)}`, { method: 'PATCH', body: { data } }),
  deleteSavedView: (id) => platformRequest(`/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runSavedView: (id) => platformRequest(`/saved-views/${encodeURIComponent(id)}/run`),
  invoiceDocument: async (id) => {
    const headers = new Headers({ Accept: 'text/html', 'X-Demo-User': getDemoUser() })
    const response = await fetch(`${API_BASE}/invoices/${encodeURIComponent(id)}/document`, { headers })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const message = payload?.error?.message || payload?.message || payload?.error || `Request failed (${response.status})`
      const error = new Error(typeof message === 'string' ? message : 'The invoice preview could not be opened.')
      error.status = response.status
      throw error
    }
    return response.blob()
  },
  search: (q) => platformRequest(`/search?q=${encodeURIComponent(q)}`),
  export: (kind) => platformRequest(`/export/${encodeURIComponent(kind)}`),
  publicJobs: () => platformRequest('/public/jobs'),
  publicJob: (id) => platformRequest(`/public/jobs/${encodeURIComponent(id)}`),
  apply: (id, data) => {
    if (data instanceof FormData) return platformRequest(`/public/jobs/${encodeURIComponent(id)}/apply`, { method: 'POST', body: data })
    return platformRequest(`/public/jobs/${encodeURIComponent(id)}/apply`, { method: 'POST', body: { data } })
  },
}
