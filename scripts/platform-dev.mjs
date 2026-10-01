import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PLATFORM_MODE: 'true',
  LOCAL_DEMO_MODE: 'true',
  ATS_PLATFORM_DB: resolve(root, 'server/data/platform-local.sqlite'),
  ATS_PLATFORM_DATA_DIR: resolve(root, 'server/data/platform-documents'),
  PORT: process.env.PORT || '4000',
  FRONTEND_URL: 'http://127.0.0.1:5173',
  VITE_PLATFORM_MODE: 'true',
  VITE_BUILDER_AVAILABLE: 'true',
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = []
let stopping = false

function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal)
  }
}

function start(label, command, args, env = baseEnv) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
  children.push(child)
  child.on('error', error => {
    console.error(`${label} failed to start: ${error.message}`)
    process.exitCode = 1
    stop()
  })
  child.on('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? 1
      console.error(`${label} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.`)
      stop()
    }
  })
  return child
}

start('Platform API', process.execPath, [resolve(root, 'server/server.js')])
start('Platform UI', npm, ['run', 'dev', '--', '--host', '127.0.0.1'])
start('Platform Builder API', process.execPath, [resolve(root, 'builder/server.mjs')], { ...baseEnv, ATS_BUILDER_PORT: process.env.ATS_BUILDER_PORT || '4177' })

console.log('Local ATS platform: http://127.0.0.1:5173/platform')
console.log('Local API: http://127.0.0.1:4000/api/platform')
console.log('Local schemaV2 Builder API: http://127.0.0.1:4177/api')
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
