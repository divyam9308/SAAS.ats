# ATS Builder local runtime guide

## Architecture

This repository is a local deployment factory. Product capability, company configuration and operational records are separate layers.

| Layer | Source of truth | Responsibility |
| --- | --- | --- |
| Shared product | `src/platform/`, `server/src/platform/` | UI, APIs, workflows, authorization, reports and local adapters |
| Company configuration | schemaV2 JSON plus active configuration in SQLite | Branding, terminology, modules, roles, forms, policies and workflow definitions |
| Operational data | SQLite and local document storage | Jobs, candidates, applications, approvals, interviews, offers, tasks and audit records |
| Builder | `builder/` | Guided setup, validation, import/export, draft resume and package generation |
| Generated package | `generated/<slug>/workspace/` | Standalone company ATS with isolated configuration and database path |

Generated workspaces do not contain customer-specific source branches. Company differences are represented by validated configuration and operational data.

## Guided builder

Use Node.js 22.13 or newer (Node.js 24 is recommended) and npm. Run the configurator and local ATS together:

```bash
npm run setup
npm run local
```

Open:

- Builder: `http://127.0.0.1:4177`
- ATS: `http://127.0.0.1:5173/platform`
- Careers site: `http://127.0.0.1:5173/careers-platform`

The buyer-facing builder uses progressive setup rather than requiring raw JSON:

1. Company and starting preset
2. Enabled modules
3. Brand and terminology
4. Regional formats and working time
5. Default pipeline and approval approach
6. Review, validation and generation

Corporate, recruitment-agency, startup, campus-heavy and minimal presets initialize the draft without locking any setting. The builder supports save/resume in the browser, configuration import/export, section reset, complete reset, contradiction warnings and an optional advanced JSON editor on the review step. Settings warn before in-app navigation or browser unload can discard dirty edits. Preset changes and module changes are confirmed before applying; rollback also requires confirmation.

The hiring step edits one selected pipeline at a time and preserves other pipelines, stable IDs and approval thresholds. Renaming/reordering a stage retains its edges; removal prunes incident edges. Explicit stage moves are independent of display order, and an explicit empty graph permits no moves. Hiring-request and offer approval modes include no approval, one approver, sequential and parallel approvers. Roles with configured approval or administrator access are available.

Progress counts the five setup sections actually reviewed. Imported and advanced JSON configurations migrate and validate before they replace the draft. The split preview uses configured navigation/branding/regional/workflow/form labels and actual careers presentation helpers; records/counts are labelled sample content. It represents selected draft screens rather than every exact runtime page.

Before activation, the review step presents a readable item-level diff against the active configuration and requires acknowledgment. Server validation plus draft/version concurrency checks protect activation and rollback from stale or invalid updates. Generate with **Apply this configuration** enabled to make the same configuration active in the factory’s local ATS. The downloadable archive always contains an isolated workspace.

## Deeper administration

The generated/local ATS Settings area exposes the complete schemaV2 configuration in categorized sections, including organization structure, roles and sensitive data, pipelines, custom fields, application forms, scorecards, communications, automations, offers, onboarding, careers, privacy, integrations and agency settings.

Pipelines, approvals, application forms and scorecards have dedicated business editors. Entry checks, permitted roles, explicit transitions, approver order/thresholds, form sections/questions/conditional rules, screening answers, rating scales/competencies and privacy notices are editable through labelled controls. Other advanced areas retain categorized general collection editing.

Public forms must keep visible required questions with canonical `fullName` and `email` answer keys. Required privacy consent cannot be hidden by conditions. One file-upload question per application form is supported; additional internal attachments use document management. Conditions use the shared browser/API evaluator and typed boolean/numeric answers. Validation rejects dangling references, conflicting answer keys and unusable scorecard scales before generation or activation.

Draft changes are validated before activation. Active configuration history can be reviewed and rolled back with confirmation and concurrency checks. Imported older configurations are migrated where supported. Careers presentation reads configured company identity, logo, colors, careers copy, terminology, and regional date/salary formats, including when there are no published jobs.

## Run a generated workspace

```bash
cd generated/<slug>/workspace
npm run setup
npm run local
```

Open `http://127.0.0.1:5173/platform`. The first launch creates the workspace’s SQLite database using `config/platform.config.json`. Generated workspaces set `seedDemo:false`, so operational records start empty; local mock-user switching remains available for development and role checks. `npm run setup` uses the checked-in lockfiles via `npm ci` for reproducible installs.

Generated workspaces include backup scripts:

```bash
npm run backup:create -- --destination /absolute/path/to/ats-backup
npm run backup:preview -- --bundle /absolute/path/to/ats-backup
npm run backup:restore -- --bundle /absolute/path/to/ats-backup --confirm
```

Stop the ATS before backup or restore. Restore validates the bundle and retains replaced data for rollback. See [LOCAL_BACKUP_RESTORE.md](LOCAL_BACKUP_RESTORE.md) for options, safety behavior, and factory-repository commands.

## Local authentication and integrations

This development phase intentionally uses:

- development-only sample-user switching;
- SQLite persistence;
- local document storage;
- mock email/outbox delivery;
- a mock calendar adapter;
- configuration placeholders/adapters for future hosted providers.

No Google OAuth, Supabase project, Vercel deployment or paid integration is required. Authentication is local mock authentication; do not present it as production identity or claim a hosted production deployment.

## Verification

```bash
npm run test:platform
npm --prefix server test
npm run lint
npm run build
npm run config:validate
npm run test:generated
```

The platform suite includes Builder/configuration behavior, workflow engines, RBAC, privacy/data administration and route-level acceptance. `npm test` covers frontend helpers; the broader server suite also protects legacy code. For the integrated platform/performance/browser gate:

```bash
npx playwright install chromium firefox webkit
npm run test:quality
```

The browser harness starts isolated services, runs corporate and agency journeys, scans representative accessibility states and verifies Builder/ATS/Careers at 1440, 1280, 768 and 390 pixel widths. WebKit is engine coverage, not native Safari/device certification. The generated matrix covers corporate, agency, startup, campus and basic with clean installs, builds, workspace tests, denied actions, restart isolation and independent backup/restore.

See [PRODUCT_AUDIT_2026-10-04.md](PRODUCT_AUDIT_2026-10-04.md), [CONFIGURATION_TRACEABILITY_2026-10-04.md](CONFIGURATION_TRACEABILITY_2026-10-04.md) and [ATS_ACCEPTANCE.md](ATS_ACCEPTANCE.md) for exact executed evidence and limits. These checks establish the documented local workflows; they do not establish hosted production readiness.
