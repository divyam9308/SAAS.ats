import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const engines = (process.env.ATS_BROWSER_MATRIX || 'chromium,firefox,webkit').split(',').map(value => value.trim()).filter(Boolean)
for (const engine of engines) {
  console.log(`\n=== Browser acceptance: ${engine} ===`)
  const result = spawnSync(process.execPath, [resolve('scripts/browser-acceptance.mjs')], {
    cwd: process.cwd(),
    env: { ...process.env, ATS_BROWSER: engine },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log(`\nCross-browser acceptance passed for ${engines.join(', ')}`)
