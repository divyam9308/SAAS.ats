import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyCompanyConfig, generateCompanyPackage } from './generate.mjs'
import { defaults, validateConfig } from '../shared/ats-config.cjs'

const host = '127.0.0.1'
const port = Number(process.env.ATS_BUILDER_PORT || 4177)
const root = resolve(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = resolve(root, '..')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }

const send = (response, status, body, type = 'application/json; charset=utf-8') => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function body(request) {
  let value = ''
  for await (const chunk of request) {
    value += chunk
    if (value.length > 12_000_000) throw new Error('Request is too large.')
  }
  return JSON.parse(value || '{}')
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || ''
  if (/^http:\/\/(?:127\.0\.0\.1|localhost):5173$/.test(origin)) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-credentials', 'true')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    response.setHeader('vary', 'Origin')
  }
  if (request.method === 'OPTIONS') { response.writeHead(204); return response.end() }
  try {
    if (request.method === 'GET' && request.url === '/api/config') {
      return send(response, 200, defaults('corporate'))
    }
    if (request.method === 'GET' && request.url?.startsWith('/api/presets/')) {
      const name = request.url.slice('/api/presets/'.length)
      if (!['corporate', 'agency', 'startup', 'campus', 'basic'].includes(name)) return send(response, 404, { error: 'Preset not found.' })
      return send(response, 200, defaults(name))
    }
    if (request.method === 'POST' && request.url === '/api/validate') {
      const payload = await body(request)
      return send(response, 200, validateConfig(payload))
    }
    if (request.method === 'POST' && request.url === '/api/generate') {
      const payload = await body(request)
      const result = await generateCompanyPackage(payload.config)
      const applied = payload.activate ? await applyCompanyConfig(payload.config) : null
      return send(response, 201, {
        ...result,
        applied,
        outputDirectory: `generated/${result.slug}/workspace`,
        configFile: `configs/${result.slug}.json`,
        archiveUrl: `/api/download/${result.slug}`
      })
    }
    if (request.method === 'POST' && request.url === '/api/apply') {
      const payload = await body(request)
      return send(response, 200, await applyCompanyConfig(payload.config || payload))
    }
    if (request.method === 'GET' && /^\/api\/download\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.url || '')) {
      const slug = request.url.slice('/api/download/'.length)
      const archive = await readFile(join(repositoryRoot, 'generated', `${slug}-ats-platform.tar.gz`))
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${slug}-ats-platform.tar.gz"`,
        'content-length': archive.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      })
      response.end(archive)
      return
    }
    if (request.method === 'GET' && /^\/assets\/[a-zA-Z0-9._-]+\.svg$/.test(request.url || '')) {
      const asset = join(repositoryRoot, 'public', request.url)
      return send(response, 200, await readFile(asset), mime['.svg'])
    }
    const pathname = request.url === '/' ? '/index.html' : String(request.url || '').split('?')[0]
    if (!/^\/(index\.html|app\.js|styles\.css|entities\.css)$/.test(pathname)) return send(response, 404, 'Not found', 'text/plain')
    const file = join(root, pathname)
    return send(response, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream')
  } catch (error) {
    return send(response, 400, { error: error.message || 'Builder request failed.' })
  }
})

server.listen(port, host, () => console.log(`ATS Builder running at http://${host}:${port}`))
