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

Run the configurator and local ATS together:

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

Corporate, recruitment-agency, startup, campus-heavy and minimal presets initialize the draft without locking any setting. The builder supports save/resume in the browser, configuration import/export, section reset, complete reset, contradiction warnings and an optional advanced JSON editor on the review step.

Generate with **Apply this configuration** enabled to make the same configuration active in the factory’s local ATS. The downloadable archive always contains an isolated workspace.

## Deeper administration

The generated/local ATS Settings area exposes the complete schemaV2 configuration in categorized sections, including organization structure, roles and sensitive data, pipelines, custom fields, application forms, scorecards, communications, automations, offers, onboarding, careers, privacy, integrations and agency settings.

Draft changes are validated before activation. Active configuration history can be reviewed and rolled back. Imported older configurations are migrated where supported.

## Run a generated workspace

```bash
cd generated/<slug>/workspace
npm run setup
npm run local
```

Open `http://127.0.0.1:5173/platform`. The first launch creates and seeds the workspace’s SQLite database from `config/platform.config.json`.

## Local authentication and integrations

This development phase intentionally uses:

- development-only sample-user switching;
- SQLite persistence;
- local document storage;
- mock email/outbox delivery;
- a mock calendar adapter;
- configuration placeholders/adapters for future hosted providers.

No Google OAuth, Supabase project, Vercel deployment or paid integration is required. Do not expose the sample authentication mode as production authentication.

## Verification

```bash
npm run test:platform
npm --prefix server test
npm run lint
npm run build
npm run config:validate
```

The platform suite includes builder preset validation, configuration behavior, workflow engines, RBAC, privacy/data administration and route-level acceptance. See `docs/ATS_ACCEPTANCE.md` for exact verified checkpoints and the remaining browser-environment limitation.
