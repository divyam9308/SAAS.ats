#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createBackup, previewBackup, restoreBackup } = require('../server/src/platform/deployment-backup.js');

export function resolveDefaults(root = process.cwd(), env = process.env) {
  const generated = fs.existsSync(path.join(root, 'config/platform.config.json'));
  return {
    dbPath: env.ATS_PLATFORM_DB || path.join(root, generated ? 'server/data/platform.sqlite' : 'server/data/platform-local.sqlite'),
    documentsPath: env.ATS_PLATFORM_DATA_DIR || path.join(root, generated ? 'server/data/documents' : 'server/data/platform-documents'),
  };
}
function usage() {
  return `Usage:
  node scripts/deployment-backup.mjs backup --destination <new-directory> [--db <file>] [--documents <directory>]
  node scripts/deployment-backup.mjs preview --bundle <directory>
  node scripts/deployment-backup.mjs restore --bundle <directory> [--db <file>] [--documents <directory>] --replace --confirm

Restore first validates every checksum and path. --replace moves current recognized ATS data aside beside each target before install; it never deletes that preserved copy.`;
}
export function parse(argv, defaults = resolveDefaults()) {
  const [command, ...args] = argv;
  const options = { ...defaults };
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (['--preview', '--replace', '--confirm'].includes(token)) options[token.slice(2)] = true;
    else if (['--out', '--destination', '--bundle', '--db', '--documents'].includes(token)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${token}`);
      options[{ '--out': 'destination', '--destination': 'destination', '--bundle': 'bundlePath', '--db': 'dbPath', '--documents': 'documentsPath' }[token]] = path.resolve(args[++i]);
    } else throw new Error(`Unknown option: ${token}`);
  }
  if (command === 'backup' && !options.destination) throw new Error('backup requires --destination');
  if (command === 'restore' && !options.bundlePath) throw new Error('restore requires --bundle');
  if (command === 'restore' && options.preview) throw new Error('Use the preview command');
  if (command === 'restore' && !options.replace) throw new Error('restore requires --replace');
  if (command === 'restore' && !options.confirm) throw new Error('restore requires --confirm with --replace');
  if (!['backup', 'preview', 'restore', 'help', '--help', '-h'].includes(command)) throw new Error(`Unknown command: ${command || '(missing)'}`);
  if (command === 'preview' && !options.bundlePath) throw new Error('preview requires --bundle');
  return { command, options };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parse(argv);
    if (command === 'help' || command === '--help' || command === '-h') console.log(usage());
    else if (command === 'backup') {
      const manifest = await createBackup(options);
      console.log(`Backup created at ${options.destination}\n${manifest.documents.length} document file(s); SQLite SHA-256 ${manifest.database.sha256}`);
    } else if (command === 'preview') console.log(JSON.stringify(previewBackup(options.bundlePath), null, 2));
    else {
      const result = restoreBackup(options);
      console.log(`Restore completed. Preserved current target(s): ${result.preserved.length ? result.preserved.join(', ') : 'none'}`);
    }
  } catch (error) {
    console.error(`Backup/restore failed: ${error.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
