'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { readFile } = require('node:fs/promises')
const { resolve } = require('node:path')

let server
let baseUrl

test.before(async () => {
  const port = 43_000 + process.pid % 1_000
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [resolve(__dirname, 'server.mjs')], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, ATS_BUILDER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Builder did not start.')), 10_000)
    server.once('exit', code => reject(new Error(`Builder exited early (${code}).`)))
    server.stderr.on('data', chunk => reject(new Error(String(chunk))))
    server.stdout.on('data', chunk => {
      if (!String(chunk).includes('ATS Builder running')) return
      clearTimeout(timeout)
      resolveReady()
    })
  })
})

test.after(() => { if (server && server.exitCode === null) server.kill('SIGTERM') })

test('guided builder is the primary buyer experience', async () => {
  const response = await fetch(`${baseUrl}/`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /id="steps"/)
  assert.match(html, /id="save-draft"/)
  assert.match(html, /id="import-trigger"/)
  assert.match(html, /id="export"/)
  assert.match(html, /Review &amp; generate|step-content/)
  assert.match(html, /class="editor-preview-layout"/)
  assert.match(html, /id="preview-frame"/)
  assert.match(html, /id="preview-page"/)
  assert.match(html, /Preview updates as you edit/)
  assert.doesNotMatch(html, /id="config"/)
})

test('builder script wires immediate, page-aware live preview updates', async () => {
  const response = await fetch(`${baseUrl}/app.js`)
  assert.equal(response.status, 200)
  const script = await response.text()
  assert.match(script, /function renderPreview\(\)/)
  assert.match(script, /previewPageForStep/)
  assert.match(script, /addEventListener\(eventName, update\)/)
  assert.match(script, /data-preview-page/)
  assert.match(script, /modules\.agency/)
  assert.match(script, /validCurrency/)
})

test('local Vite proxy uses the API server IPv4 bind address', async () => {
  const source = await readFile(resolve(__dirname, '..', 'vite.config.js'), 'utf8')
  assert.match(source, /http:\/\/127\.0\.0\.1:4000/)
  assert.doesNotMatch(source, /target:\s*['"]http:\/\/localhost:4000/)
})

test('every buyer preset loads and validates through the builder API', async () => {
  for (const name of ['corporate', 'agency', 'startup', 'campus', 'basic']) {
    const presetResponse = await fetch(`${baseUrl}/api/presets/${name}`)
    assert.equal(presetResponse.status, 200)
    const config = await presetResponse.json()
    const validationResponse = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
    })
    assert.equal(validationResponse.status, 200)
    const result = await validationResponse.json()
    assert.equal(result.valid, true, `${name}: ${(result.errors || []).join(', ')}`)
  }
})
