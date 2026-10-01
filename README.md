# Local configurable ATS factory

This repository contains a company configurator, a local ATS platform, and a generator for standalone company workspaces. The current development runtime uses SQLite, local file storage, and clearly labelled sample users. It does not require Supabase, Vercel, Google OAuth, or a paid integration.

## Start the configurator and local ATS

Requires Node.js 22.5 or newer and npm.

```bash
npm run setup
npm run local
```

Open the configurator at `http://127.0.0.1:4177` and the ATS at `http://127.0.0.1:5173/platform`. The local API listens at `http://127.0.0.1:4000/api/platform`. The ATS offers development-only user switching to test roles and permissions. Its SQLite database and uploaded files live under `server/data/` unless overridden with `ATS_PLATFORM_DB` and `ATS_PLATFORM_DATA_DIR`.

The guided builder walks a buyer through company/preset, modules, branding and terminology, regional settings, hiring workflow, and review. It supports save/resume, import/export, section reset, complete reset and an optional advanced JSON editor. A valid schemaV2 configuration can generate a separate standalone package at `generated/<slug>/workspace/` and `generated/<slug>-ats-platform.tar.gz`; selecting the apply option also activates the configuration in the current local ATS.

## Run a generated company ATS

```bash
cd generated/<slug>/workspace
npm run setup
npm run local
```

Open `http://127.0.0.1:5173/platform`. The first launch seeds a local database from `config/platform.config.json`. Run one generated workspace at a time on the default ports, or override its ports and database path for parallel testing.

## Verify changes

```bash
npm run test:platform
npm --prefix server test
npm run lint
npm run build
```

The platform test suite covers configuration, core workflows, RBAC, local automation, privacy approvals, saved views, retention preview, invoice documents, and corporate/agency/startup behavior. See [docs/ATS_ACCEPTANCE.md](docs/ATS_ACCEPTANCE.md) for verified checkpoints and unfinished buyer requirements. Browser interaction acceptance is still pending because this environment cannot reach its localhost dev server from the browser service.

External email, calendar, payment, identity, and deployment providers are mock/local interfaces in this development phase. This checkout is a local testing platform and must not be represented as a deployed production service.
