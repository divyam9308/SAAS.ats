import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const serverRequire = createRequire(resolve('server/package.json'))
const express = serverRequire('express')
const { defaults } = serverRequire('../shared/ats-config.cjs')
const { createPlatformRouter } = serverRequire('./src/platform/index.js')
const { openDatabase, seedCompany } = serverRequire('./src/platform/database.js')

const candidateCount = Number(process.env.ATS_PERF_CANDIDATES || 20_000)
const soakSeconds = Number(process.env.ATS_SOAK_SECONDS || 30)
const directory = await mkdtemp(join(tmpdir(), 'ats-performance-'))
const dbPath = join(directory, 'platform.sqlite')
const dataDir = join(directory, 'documents')
let server
let router

function percentile(values, percent) {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percent) - 1)] || 0
}

async function timedRequest(url, options) {
  const started = performance.now()
  const response = await fetch(url, options)
  const payload = await response.json()
  const duration = performance.now() - started
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  return { duration, payload: payload.data ?? payload }
}

try {
  const config = defaults('corporate')
  const db = openDatabase(dbPath)
  seedCompany(db, 'local-company', config, { seedDemo: false })
  const insert = db.prepare('INSERT INTO platform_records(company_id,kind,id,data,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,NULL)')
  const timestamp = new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let index = 0; index < candidateCount; index += 1) {
      const id = `perf-candidate-${String(index).padStart(6, '0')}`
      const data = { id, name: `Performance Candidate ${index}`, email: `perf-${index}@example.test`, status: index % 7 === 0 ? 'on_hold' : 'active', source: index % 3 === 0 ? 'Referral' : 'Careers site', ownerId: 'demo-recruiter', createdAt: timestamp, updatedAt: timestamp }
      insert.run('local-company', 'candidates', id, JSON.stringify(data), timestamp, timestamp)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }

  router = createPlatformRouter({ dbPath, dataDir })
  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/platform', router)
  server = await new Promise(resolveReady => {
    const listening = app.listen(0, '127.0.0.1', () => resolveReady(listening))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/platform`
  const headers = { 'content-type': 'application/json', 'x-demo-user': 'demo-admin' }
  const memoryBefore = process.memoryUsage().rss

  const list = await timedRequest(`${base}/records/candidates`, { headers })
  assert.equal(list.payload.length, candidateCount)
  assert.ok(list.duration < 4_000, `20k candidate list took ${list.duration.toFixed(1)}ms`)

  const readRuns = await Promise.all(Array.from({ length: 60 }, () => timedRequest(`${base}/dashboard`, { headers })))
  const writeRuns = await Promise.all(Array.from({ length: 60 }, (_, index) => timedRequest(`${base}/records/tasks`, {
    method: 'POST', headers, body: JSON.stringify({ data: { title: `Concurrent task ${index}`, ownerId: 'demo-admin', status: 'open', priority: 'normal' } }),
  })))
  assert.ok(percentile(readRuns.map(run => run.duration), .95) < 1_500, 'Dashboard read p95 exceeded 1500ms')
  assert.ok(percentile(writeRuns.map(run => run.duration), .95) < 2_000, 'Concurrent write p95 exceeded 2000ms')

  const soakLatencies = []
  const soakDeadline = Date.now() + soakSeconds * 1_000
  let sequence = 0
  let soakBatch = 0
  while (Date.now() < soakDeadline) {
    const writeThisBatch = soakBatch % 10 === 0
    const batch = await Promise.all(Array.from({ length: 8 }, (_, index) => timedRequest(writeThisBatch && index === 0 ? `${base}/records/tasks` : `${base}/dashboard`, writeThisBatch && index === 0 ? {
      method: 'POST', headers, body: JSON.stringify({ data: { title: `Soak task ${sequence++}`, ownerId: 'demo-admin', status: 'open', priority: 'low' } }),
    } : { headers })))
    soakLatencies.push(...batch.map(run => run.duration))
    soakBatch += 1
  }
  const memoryGrowthMb = (process.memoryUsage().rss - memoryBefore) / 1024 / 1024
  assert.ok(percentile(soakLatencies, .99) < 2_500, 'Soak p99 exceeded 2500ms')
  assert.ok(memoryGrowthMb < 256, `Memory grew by ${memoryGrowthMb.toFixed(1)} MiB`)
  console.log(JSON.stringify({ candidateCount, listMs: Number(list.duration.toFixed(1)), concurrentReads: readRuns.length, readP95Ms: Number(percentile(readRuns.map(run => run.duration), .95).toFixed(1)), concurrentWrites: writeRuns.length, writeP95Ms: Number(percentile(writeRuns.map(run => run.duration), .95).toFixed(1)), soakSeconds, soakRequests: soakLatencies.length, soakP99Ms: Number(percentile(soakLatencies, .99).toFixed(1)), memoryGrowthMb: Number(memoryGrowthMb.toFixed(1)) }, null, 2))
} finally {
  await new Promise(resolveClose => server ? server.close(resolveClose) : resolveClose())
  router?.close()
  await rm(directory, { recursive: true, force: true })
}
