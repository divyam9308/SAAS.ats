# Local ATS backup and restore

The local backup command writes a portable directory bundle containing a consistent SQLite snapshot, the local document files, and a SHA-256 manifest. The active company configuration, its draft, and configuration history are stored in SQLite and are included with the database snapshot. Backups contain sensitive candidate and company data; store and transfer them accordingly.

Use Node.js 22.13 or newer (the application itself uses Node's built-in `node:sqlite`). In the factory repository, run commands from the workspace root:

```sh
node scripts/deployment-backup.mjs backup --destination ../ats-backup-2026-10-01
node scripts/deployment-backup.mjs preview --bundle ../ats-backup-2026-10-01
```

The CLI honors `ATS_PLATFORM_DB` and `ATS_PLATFORM_DATA_DIR` first. Without overrides, it detects the workspace layout: the factory repository uses `server/data/platform-local.sqlite` and `server/data/platform-documents` (matching `npm run local`); a generated workspace with `config/platform.config.json` uses `server/data/platform.sqlite` and `server/data/documents`. Override these with `--db <file>` and `--documents <directory>` for a custom layout. A missing documents directory is backed up as an empty set. The output directory must be new; a backup never overwrites an existing destination.

Restore preview validates the whole bundle and its database and reports record, company-config, and document counts. To install it, stop the local ATS server and run:

```sh
node scripts/deployment-backup.mjs restore --bundle ../ats-backup-2026-10-01 --replace --confirm
```

Restore refuses existing targets unless `--replace` is present. Replacement first moves each current target to a unique `.pre-restore-*` sibling and retains it after a successful restore. Existing SQLite `-wal`, `-shm`, and `-journal` sidecars are preserved beside the previous database so none can be replayed against the restored database. If installation fails, it rolls the database, sidecars, and documents back. Never delete the preserved siblings until you have checked the restored ATS. Validate and preview before replacing anything.

The ATS runtime and offline commands coordinate through a per-database runtime lock. Backup and restore fail while a cooperating local ATS process is running. If a lock is malformed, belongs to a different host, or remains after a crash, the tool fails closed. For a stale lock, first verify that no ATS process is using the database, then remove the exact lock file named by the error. The lock coordinates local program starts, so close any other process that opens or edits this SQLite database directly as well.

The bundle validator rejects checksum mismatches, unsafe relative paths, symlinks, unexpected bundle entries, and databases that do not have the local ATS schema. It validates all bundle contents before changing restore targets. Existing document targets must resemble the ATS's flat UUID-named local document storage; broad directories and unrelated contents are refused. Keep the entire bundle directory together; do not edit files inside it.

For a generated customer workspace, use its package commands so its own SQLite and document paths are selected automatically:

```sh
npm run backup:create -- --destination /absolute/path/to/ats-backup
npm run backup:preview -- --bundle /absolute/path/to/ats-backup
npm run backup:restore -- --bundle /absolute/path/to/ats-backup --replace --confirm
```

The root `package.json` exposes those commands as `backup:create`, `backup:preview`, and `backup:restore`; generated workspace packages should keep the same scripts when copied. They map to `node scripts/deployment-backup.mjs backup`, `preview`, and `restore` respectively.
