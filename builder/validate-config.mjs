import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaults, validateConfig } from '../shared/ats-config.cjs'

export async function readAndValidateConfig(filePath) {
  const absolute = filePath ? resolve(filePath) : null
  const config = absolute ? JSON.parse(await readFile(absolute, 'utf8')) : defaults('corporate')
  const result = validateConfig(config)
  if (!result.valid) throw new Error(`Invalid schemaV2 configuration:\n- ${result.errors.join('\n- ')}`)
  return config
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await readAndValidateConfig(process.argv[2])
  const absolute = process.argv[2] ? resolve(process.argv[2]) : null
  console.log(absolute ? `schemaV2 configuration is valid: ${absolute}` : 'Default corporate schemaV2 configuration is valid.')
}
