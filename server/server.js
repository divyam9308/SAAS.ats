const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const { companyConfig } = require('./src/config/companyConfig')
const app = require('./src/app')
const { resolveBindHost } = require('./src/local/bindHost')

const port = process.env.PORT || 4000
const host = resolveBindHost({
  host: process.env.HOST,
  platformMode: process.env.PLATFORM_MODE === 'true',
  localDemoMode: process.env.LOCAL_DEMO_MODE === 'true'
})

if (process.env.LOCAL_DEMO_MODE !== 'true') require('./src/services/aiProvider').validateAiConfig()

const server = app.listen(port, host, () => {
  const address = host || 'all interfaces'
  console.log(`${companyConfig.company.atsProductName} API listening on ${address}:${port}`)
})

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  server.close(() => {
    app.locals.platformClose?.()
    process.exit(0)
  })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
