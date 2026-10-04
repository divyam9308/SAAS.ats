# Local configurable ATS factory

This repository contains a company configurator, a local ATS platform, and a generator for standalone company workspaces. The current development runtime uses SQLite, local file storage, and clearly labelled mock users. It does not require Supabase, Vercel, Google OAuth, or a paid integration.

## Start the configurator and local ATS

Requires Node.js 22.13 or newer and npm (Node.js 24 is recommended).

```bash
npm run setup
npm run local
```

Open the configurator at `http://127.0.0.1:4177` and the ATS at `http://127.0.0.1:5173/platform`. The local API listens at `http://127.0.0.1:4000/api/platform`. The ATS offers development-only mock-user switching to test roles and permissions. Its SQLite database and uploaded files live under `server/data/` unless overridden with `ATS_PLATFORM_DB` and `ATS_PLATFORM_DATA_DIR`.

The guided builder walks a buyer through company/preset, modules, branding and terminology, regional settings, hiring workflow, and review. It supports save/resume, import/export, section reset, complete reset and an optional advanced JSON editor. A valid schemaV2 configuration can generate a separate standalone package at `generated/<slug>/workspace/` and `generated/<slug>-ats-platform.tar.gz`; selecting the apply option also activates the configuration in the current local ATS. Generated workspaces set `seedDemo:false`, so their first launch creates empty operational data rather than sample jobs, candidates, and other demo records.

Settings protect unsaved edits with in-app navigation and browser-unload warnings. Preset changes, module changes, and version rollback ask for confirmation. Before activation, the review screen shows a readable item-by-item configuration diff and requires acknowledgment. Activation and rollback validate on the server and check draft/version concurrency so a stale edit cannot silently overwrite a newer configuration. Careers presentation uses configured company identity, branding, logo, colors, copy, terminology, and regional date/salary formatting.

## Run a generated company ATS

```bash
cd generated/<slug>/workspace
npm run setup
npm run local
```

Open `http://127.0.0.1:5173/platform`. The first launch creates a local database from `config/platform.config.json`; generated workspaces do not seed demo operational records. Run one generated workspace at a time on the default ports, or override its ports and database path for parallel testing. `npm run setup` installs from the checked-in lockfiles with `npm ci`.

Generated packages include `backup:create`, `backup:preview`, and `backup:restore` commands. Stop the ATS before backup or restore; restore requires `--confirm`. See [docs/LOCAL_BACKUP_RESTORE.md](docs/LOCAL_BACKUP_RESTORE.md) for commands and safeguards.

## Verify changes

```bash
npm run test:platform
npm --prefix server test
npm run lint
npm run build
npm run config:validate
```

The [2026-10-04 product audit](docs/PRODUCT_AUDIT_2026-10-04.md) records the final results, implemented fixes, actual browser workflows, models and remaining limits. The [50-area configuration trace](docs/CONFIGURATION_TRACEABILITY_2026-10-04.md) distinguishes working consumers from stored settings. Historical runs remain in [the acceptance ledger](docs/ATS_ACCEPTANCE.md).

The Builder preserves pipeline/stage identities and supports explicit stage moves and approval modes. Settings has dedicated pipeline, approval, application-form and scorecard editors. Public application visibility uses the same evaluator in the browser and API; invalid identity/consent/upload definitions are rejected before activation. The runtime groups required/additional form fields and record details and includes a scoped operational work queue.

Install browser engines once, then run the integrated platform, performance and browser gate:

```bash
npx playwright install chromium firefox webkit
npm run test:quality
npm test
npm run test:generated
```

`npm run test:browser` runs Chromium; `npm run test:browser:all` runs Chromium, Firefox and WebKit. Browser acceptance includes 1440, 1280, 768 and 390 pixel widths. `npm run test:generated` installs, builds and tests corporate, agency, startup, campus and basic workspaces, then checks restart isolation and offline backup/restore. `npm run test:soak` runs the separate five-minute local performance soak. Use the latest report when citing measured results.

External email, calendar, payment, and identity providers are mock/local interfaces in this development phase. This checkout is a local testing platform and must not be represented as a deployed production service.
