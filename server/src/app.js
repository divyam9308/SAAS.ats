const express = require('express')
const cors = require('cors')
const crypto = require('node:crypto')
const platformMode = process.env.PLATFORM_MODE === 'true'
const { companyConfig, moduleEnabled } = platformMode
  ? { companyConfig: null, moduleEnabled: () => false }
  : require('./config/companyConfig')

const app = express()
app.disable('x-powered-by')

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' && process.env.ATS_STRUCTURED_LOGS !== 'true') return next()
  const requestId = req.get('x-request-id') || crypto.randomUUID()
  const startedAt = process.hrtime.bigint()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => console.info(JSON.stringify({ type: 'http_request', requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)) })))
  next()
})

const PERF_ROUTES = /^\/api\/(candidates|clients|jobs|dashboard|notifications|invoice|admin|performance|presence|reports)(?:\/|$)/

app.use((req, res, next) => {
  if (!(process.env.NODE_ENV !== 'production' || process.env.DEBUG_PERF === 'true') || !PERF_ROUTES.test(req.path)) return next()
  const requestId = req.get('x-request-id') || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = process.hrtime.bigint()
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    console.debug('[perf]', { route: req.path, method: req.method, requestId, status: res.statusCode, durationMs: Number(durationMs.toFixed(1)) })
  })
  next()
})

const configuredOrigins = platformMode ? [] : [
  ...(companyConfig.deployment?.corsOrigins || []),
  ...(process.env.ALLOWED_CORS_ORIGINS || '').split(',')
].map(value => String(value).trim()).filter(Boolean)
const ALLOWED_ORIGINS = [
  ...(platformMode ? [] : [process.env.FRONTEND_URL]),
  ...(!platformMode && companyConfig.deployment?.frontendUrl ? [companyConfig.deployment.frontendUrl] : []),
  ...configuredOrigins,
  ...(platformMode ? [/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/] : (process.env.NODE_ENV === 'production' ? [] : [/^http:\/\/localhost(:\d+)?$/]))
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman)
    if (!origin) return callback(null, true)
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    )
    callback(allowed ? null : new Error('Not allowed by CORS'), allowed)
  },
  credentials: true
}))

const maximumUploadMb = Math.max(1, Number(process.env.ATS_MAX_UPLOAD_MB) || 20)
const jsonBodyLimitBytes = Math.ceil(maximumUploadMb * 1024 * 1024 * 4 / 3) + 1024 * 1024
app.use(express.json({ limit: jsonBodyLimitBytes }))
if (platformMode) {
  const { createPlatformRouter } = require('./platform')
  const platformRouter = createPlatformRouter({ schedulerEnabled: process.env.NODE_ENV !== 'test' && process.env.PLATFORM_REMINDERS !== 'false' })
  app.locals.platformClose = () => platformRouter.close?.()
  app.use('/api/platform', platformRouter)
  app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: 'platform-local' }))
  app.use('/api', (req, res) => res.status(404).json({ error: 'This API is not part of the local platform runtime.' }))
} else if (process.env.LOCAL_DEMO_MODE === 'true') {
  app.use('/api', require('./local/localDemoRouter'))
} else {
const attachUser = require('./middleware/authMiddleware')
const requireAuth = require('./middleware/requireAuth')
const requireModule = require('./middleware/moduleEnabled')
if (moduleEnabled('publicRoles') && companyConfig.publicCareers?.enabled) {
  app.get('/share/open-roles/:slug', require('./controllers/publicRolesController').shareOpenRole)
  app.use('/api/public', require('./routes/publicRoles'))
}
app.use(attachUser)

const secureModule = (route, moduleKey, router) => app.use(route, requireAuth, requireModule(moduleKey), router)

secureModule('/api/candidates', 'candidates', require('./routes/candidates'))
secureModule('/api/applied-candidates', 'applications', require('./routes/appliedCandidates'))
secureModule('/api/resumes', 'candidates', require('./routes/resumes'))
secureModule('/api/documents', 'candidates', require('./routes/documents'))
secureModule('/api/clients', 'clients', require('./routes/clients'))
secureModule('/api/jobs', 'jobs', require('./routes/jobs'))
secureModule('/api/dashboard', 'dashboard', require('./routes/dashboard'))
secureModule('/api/notifications', 'notifications', require('./routes/notifications'))
secureModule('/api/admin', 'admin', require('./routes/admin'))
secureModule('/api/performance', 'performance', require('./routes/performance'))
secureModule('/api/attendance', 'attendance', require('./routes/attendance'))
secureModule('/api/reports', 'reports', require('./routes/reports'))
secureModule('/api/user-manual', 'userManual', require('./routes/userManual'))
app.use('/api/presence', requireAuth, require('./routes/presence'))
secureModule('/api/invoice', 'invoices', require('./routes/invoice'))
secureModule('/api/gst', 'invoices', require('./routes/gst'))
app.use('/api/auth', requireAuth, require('./routes/auth'))
app.use('/api/user-preferences', requireAuth, require('./routes/userPreferences'))
app.use('/api/user-profiles', requireAuth, require('./routes/userProfiles'))
secureModule('/api/ai', 'aiParsing', require('./routes/ai'))
}

if (!platformMode) app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: `Request exceeds the configured ${maximumUploadMb} MB upload limit` })
  if (error?.message === 'Not allowed by CORS') return res.status(403).json({ error: 'Origin is not allowed' })
  console.error(JSON.stringify({ type: 'request_error', requestId: res.getHeader('x-request-id') || null, method: req.method, path: req.path, message: error?.message || 'Unknown request error' }))
  return res.status(500).json({ error: 'Request failed' })
})

module.exports = app
