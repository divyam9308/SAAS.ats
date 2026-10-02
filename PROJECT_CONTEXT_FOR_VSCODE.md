# SaaS ATS / ATS Generator — Complete Project Context and Handoff

**Latest verified readiness pass:** 2026-10-02 — read `docs/READINESS_2026-10-02.md` first. It supersedes the paused verification status in `docs/CHECKPOINT_2026-10-02.md` and older sections below. The user explicitly authorized committing and pushing this pass to `divyam9308/SAAS.ats` on 2026-10-02. Verify the current Git state when resuming; these changes have not been installed on the user's Mac.
**Current cloud working directory:** `/workspace/SAAS.ats` (Git `main`, base `c65d2c8`; readiness changes are uncommitted).
**Purpose of this file:** Give a new VS Code/Codex/AI session enough accurate context to continue this project without relying on the old chat history.

---

## 1. Read this first

This repository is being turned into a configurable ATS product and ATS generator that can eventually be sold to many different companies. It is not meant to be one hard-coded Fyndbridge installation and it is not merely a form that downloads JSON.

The intended product lets a company buyer—typically a CEO, HR Head, recruitment operations lead, or agency owner—configure how their ATS works. The resulting local ATS must actually use those choices in its navigation, terminology, modules, forms, permissions, workflows, pipelines, careers site, reports, automations, branding, and operational records.

The current phase is deliberately local:

- Run on localhost.
- Use SQLite and local document storage.
- Use clearly labelled development/sample authentication and user switching.
- Do not require real Google OAuth.
- Do not require Supabase.
- Do not require Vercel.
- Do not require paid email, calendar, payments, job board, e-signature, or other integrations.
- Keep clean interfaces around persistence, authentication, communications, calendars, storage, and integrations so hosted providers can replace local adapters later.

This checkout contains a working isolated local platform, but it must **not** be described as a fully production-deployed SaaS. The final readiness run passed 271 platform tests, 912 server tests, 30 frontend tests, 21 actual Chromium browser checks, and the corporate/agency/startup generated matrix (259 tests each). Lint, build, config validation and root/server audits passed. Older checkpoints below are historical; the latest readiness report is authoritative. Browser coverage is representative, not exhaustive coverage of all 50 original buyer areas.

---

## 2. Non-negotiable repository safety

1. **Never modify, commit to, push to, or otherwise alter the original Fyndbridge ATS repository** (`divyam9308/fyndbridge-ats`). It may only be used as a reference.
2. All implementation belongs in the SaaS ATS/generator project (`divyam9308/SAAS.ats`) or this current extracted working directory.
3. Before editing, run `pwd` and inspect for Git metadata so the active repository is unambiguous.
4. The current cloud directory is a Git worktree cloned from `divyam9308/SAAS.ats`, branch `main`, base commit `c65d2c8`. Readiness changes are uncommitted and unpushed. The user's Mac checkout and its unrelated changes are not accessible from this environment.
5. Do not push automatically. The user must explicitly request a push.
6. Do not commit dependency caches, build output, local databases, uploaded test files, browser artifacts, secrets, or generated junk.
7. Preserve unrelated user changes. Avoid destructive Git or filesystem operations.

Latest preserved source checkpoint:

```text
checkpoints/ats-saas-source-checkpoint-2026-09-29-macos-proxy-fix.tar.gz
```

Other checkpoints:

```text
checkpoints/ats-saas-source-checkpoint-2026-09-28-live-preview.tar.gz
checkpoints/ats-saas-source-checkpoint-2026-09-24.tar.gz
```

---

## 3. What the user is building

The user is building a reusable B2B SaaS product/factory with two connected experiences:

1. **Buyer configurator / generator**
   - A business-friendly guided setup experience.
   - Starts from presets but remains fully editable.
   - Supports saving, resuming, importing, exporting, validating, previewing, applying, and generating configurations.
   - Shows a live split-screen preview: configuration controls on the left and the affected ATS page on the right.

2. **Configured operational ATS**
   - The actual day-to-day recruitment system.
   - Uses the active company configuration at runtime.
   - Persists operational data locally.
   - Behaves differently for different companies and user roles.
   - Supports internal/corporate recruiting and recruitment-agency mode.

The current distribution model is closest to **one generated workspace/deployment per customer**, with a validated configuration and isolated data path. It is not yet a hosted multi-tenant SaaS control plane with subscriptions, tenant provisioning, production identity, backups, and fleet operations. That hosted layer is later work; do not introduce it during the current local-only phase unless the user changes the requirement.

---

## 4. Core product principle

Always keep these layers separate:

| Layer | Example | Where it belongs |
| --- | --- | --- |
| Platform capability | The product supports configurable pipelines | Shared frontend/backend code |
| Company configuration | Acme uses Applied → Screen → Technical → Offer → Hired | Versioned validated configuration |
| Operational data | Candidate Jane is currently in Technical | SQLite/local documents |

Never solve company differences with code such as:

```js
if (company === 'ABC') {
  // customer-specific behavior
}
```

Represent differences through configuration or operational data. Use stable internal IDs/keys and configurable display terminology.

---

## 5. Current architecture

| Area | Main location | Responsibility |
| --- | --- | --- |
| Guided builder | `builder/` | Buyer setup, presets, validation, save/resume, import/export, live preview, generation |
| Shared configuration contract | `shared/ats-config.cjs` | schemaV2 defaults, validation, migration, normalization |
| Presets | `config/presets/` and builder preset APIs | Corporate/agency/startup/campus/minimal starting points |
| Factory configuration | `config/company.config.json` and active config in SQLite | Current factory/default company settings |
| Operational React ATS | `src/platform/` | Config-driven ATS UI, mock user switching, settings, operational screens |
| Careers UI | Platform routes/components under `src/platform/` | Public jobs and configured application forms |
| Express platform API | `server/src/platform/index.js` | Routes, service boundary, persistence integration, authorization |
| Domain/policy services | `server/src/platform/*.js` | Authorization, workflows, automation, retention, reports, tasks, referrals, CRM, documents, agency rules |
| Local database | `server/src/platform/database.js` | SQLite bootstrap, persistence, seed/sample data |
| Local data | `server/data/` | SQLite files and local document storage |
| Generator | `builder/generate.mjs` | Creates standalone workspace and archive from validated configuration |
| Generated company ATS | `generated/<slug>/workspace/` | Independent runnable company workspace/config/database path |
| Acceptance suite | `tests/platform.acceptance.test.cjs` | Cross-module and route-level behavior |
| Unit tests | `server/src/platform/*.test.js`, `shared/*.test.cjs`, `builder/*.test.cjs`, `src/platform/*.test.js` | Engines, policies, schema, builder, formatting |
| Acceptance history | `docs/ATS_ACCEPTANCE.md` | Exact prior checkpoints, results, and limitations |
| Runtime guide | `docs/SAAS_ATS_BUILDER.md` | Local builder/generated-workspace instructions |

### Runtime processes

`npm run local` starts the local stack through `scripts/platform-dev.mjs`:

- Builder: `http://127.0.0.1:4177`
- ATS: `http://127.0.0.1:5173/platform`
- Careers: `http://127.0.0.1:5173/careers-platform`
- API: `http://127.0.0.1:4000/api/platform`

Vite proxies platform API calls to `http://127.0.0.1:4000`. The explicit IPv4 address is intentional. A previous `localhost` proxy target could resolve to IPv6 on macOS while the API listened on IPv4, making buttons fail with “page could not be displayed.” The regression is covered by a builder test.

### Local persistence

Factory runtime defaults:

```text
server/data/platform-local.sqlite
server/data/platform-documents/
```

The paths can be overridden with:

```text
ATS_PLATFORM_DB
ATS_PLATFORM_DATA_DIR
```

Each generated workspace uses its own `config/platform.config.json`, SQLite database, and document directory. Do not point multiple test organizations at the same database when behavior isolation matters.

### Legacy code warning

The repository still contains the older ATS application and some Supabase/Vercel dependencies and directories. The new local platform lives primarily in `src/platform/` and `server/src/platform/`. The presence of legacy dependencies does **not** mean the new platform requires Supabase or Vercel. Generated packages select/copy the local platform files they require. Be careful not to confuse a passing legacy test with proof of the new configurable platform, or to remove legacy files casually without checking generator/build dependencies.

---

## 6. What has been implemented

The following are real implemented foundations with tests, persisted behavior, or both. “Implemented” here does not mean every screen has final commercial polish.

### Configuration and generator

- schemaV2 company configuration with defaults, validation, migration, and backward-compatible normalization.
- Corporate, recruitment agency, startup, campus-heavy, and minimal/basic presets.
- Guided buyer setup instead of a raw JSON-only console.
- Save/resume in browser storage.
- Import and export configuration.
- Section reset and full reset.
- Contradiction warnings and validation before generation/activation.
- Review stage and optional advanced JSON editor.
- Draft/active configuration lifecycle, history, activation, and rollback.
- Standalone generated workspace and `.tar.gz` output.
- Option to apply a valid builder configuration to the factory’s local ATS.
- Generated corporate, agency, and startup workspaces have been proven to differ in module/route behavior.

### Split-screen live preview

- Builder controls are on the left and a sticky draft ATS preview is on the right.
- Preview updates while typing; generation/activation is not required.
- Preview can follow the current setup section or switch among dashboard, jobs, candidates, pipeline, and careers.
- Preview navigation reflects module switches, including agency clients/invoices.
- Company/product names, colors, theme mode, typography, terminology, regional formatting, pipeline stages, and approval counts affect the preview.
- Responsive layout stacks editor and preview on narrower screens.
- Preview is explicitly a draft and does not create operational records.

### Branding, terminology, regional settings, and modules

- Config-driven company/product naming, colors, light/dark theme, typography, logo-related fields, careers branding, and document/email branding foundations.
- Central terminology helpers for major entities such as jobs, candidates, clients, applications, recruiters/consultants, and placements/hires.
- Module/feature gating changes navigation and backend access; agency is not merely hidden in the UI.
- Currency, date, time, timezone, working-day/hour, and related regional format foundations are consumed in platform displays and policies.

### Local users, RBAC, and sensitive data

- Clearly labelled development-only sample users and user switching.
- Sample personas include admin/leadership/recruitment/hiring/interviewer/finance/employee/agency roles where enabled.
- Configurable role and permission foundations.
- Module/action permissions and record-scope checks at the service/API layer.
- Sensitive candidate contact, compensation, offer, and document information can be masked or denied.
- Export permissions are enforced and exports are audited.
- Restricted users are tested against protected routes and records.

### Hiring, jobs, candidates, and pipelines

- Hiring request records and approve/reject/create-job workflow foundations.
- Configurable job fields and required custom-field enforcement at the write boundary.
- Job publication controls.
- Candidate/application creation and linked-record validation.
- Reusable custom-field rendering/validation foundations, including conditional form behavior.
- Configured application form selection and public application validation.
- Pipeline stages, transition graph enforcement, stage requirements, rejection/withdrawal/hire paths, and stage history.
- Invalid stage skips are rejected server-side.
- Ownership fields and authorization scopes for recruiter/hiring manager/team use cases.
- Candidate duplicate detection and transactional merge with relinking and archive behavior.
- Bulk assignment/tagging/archive/stage actions validate the entire selection and run transactionally.

### Careers site

- Public careers route with configured branding/content.
- Public jobs projection avoids exposing internal data.
- Configured forms, custom fields, required fields, conditional fields, consent, and source attribution feed real candidate/application records.
- Failed resume/application writes are atomic and do not leave orphan records.
- Careers capability is gated by configuration.

### Approvals and delegation

- Reusable sequential, parallel, and threshold approval behaviors.
- Approve/reject state and history.
- Offer/requisition/invoice and other approval foundations.
- Temporary backup/delegated approvers with inclusive date handling.
- Invalid, disabled, missing, or expired delegations are denied.

### Interviews and scorecards

- Interview creation, scheduling, rescheduling, cancellation, status, meeting type, panel, duration, and configured type checks.
- Timezone-aware timestamp validation.
- Shared interviewer/panel and room conflict detection.
- Local mock calendar metadata.
- Configured weighted scorecards, required feedback, aggregate behavior, and submission locking.
- Local reminder scheduler creates idempotent notifications/outbox messages according to configuration.

### Communications, tasks, notifications, SLA, and automation

- Persistent in-app notifications with read/unread behavior and preferences.
- Persistent tasks with owners, priorities, due dates, status, notes, and overdue behavior.
- Local/mock communication outbox.
- Configurable/localized templates, sender identity, variables, aliases, and approval-before-send state.
- Rule-based automation triggers/actions with execution history and loop protection.
- Manual automation execution is guarded by permissions, configured rule identity, target scope, and audit.
- Application/stage/interview-feedback/offer-approval SLA aging and overdue overview.
- Working-day/hour-aware SLA evaluation foundations.

### Offers and onboarding

- Offer records, compensation fields, approval, rejection, acceptance/decline/withdrawal, expiry/version foundations.
- Permission-gated local HTML offer preview with escaping and sensitive-field checks.
- Accepted offers can start configured onboarding once, idempotently.
- Onboarding checklist records, required-item blockers, ownership/tasks, due dates, and completion.

### Reporting, workforce planning, search, and saved views

- Dashboard/report catalog derives metrics from stored records rather than decorative fake numbers.
- Permission- and scope-aware reporting.
- Pipeline, applications, SLA, source, workforce, and other report foundations.
- Workforce targets by period/department/location/role and target-versus-actual report.
- Global search across permitted records.
- Saved views/filters with bounded safe queries and aging conditions.

### Data administration, privacy, documents, notes, and audit

- CSV/data import foundations with field mapping, validation, reserved-key protection, and duplicate detection.
- Archive/restore, with duplicate safety on restore.
- Candidate merge review and transactional merge.
- Data exports with permission checks, scope, and audit logging.
- Consent fields and consent-scoped talent pool behavior.
- Anonymization requires a persisted approval from a second authorized user.
- Retention preview is read-only; retention execution is guarded and defaults to dry-run.
- Local categorized document storage, visibility, size policies, replacement/version history, and permission-gated download.
- Notes with authorship, team/private visibility, and related-record authorization.
- Allowlisted chronological activity timeline foundations.
- Admin audit viewer with record-scope filtering.

### Referrals and talent CRM

- Employee referral records and dedicated strict milestone/payout actions.
- Referral actions are scoped, audited, and idempotent.
- Talent pools, consent-aware membership, follow-up dates, tags, and rediscovery foundations.

### Agency mode

- Agency module can be disabled completely for internal corporate/startup ATS configurations.
- Clients and contacts.
- Client contracts with versioned terms.
- Client mandates/jobs and submissions.
- Placement workflow.
- Fees and invoice generation/status actions.
- Invoice document rendering locally.
- Replacement guarantee state, expiry, and audited dedicated actions.
- Active contract fee/guarantee terms affect placement and invoice outcomes.
- Agency consultant sample role/user and agency-specific navigation.
- Automated checks prove client access is disabled/enabled/disabled for corporate/agency/startup configurations.

---

## 7. Requested buyer scope and current maturity

The original product brief contains 50 buyer areas. Most now have an engine, route, UI foundation, configuration section, or test coverage, but the whole list has **not** received final browser acceptance and buyer-grade polish. Use these labels carefully:

- **Strong foundation:** substantial persisted behavior plus tests.
- **Partial:** important behavior exists, but configurator breadth, UI polish, or complete workflow coverage remains.
- **Mock/local by design:** works through a local adapter; no live external provider.
- **Future hosted layer:** intentionally outside the current local phase.

The table is the earlier full-scope maturity inventory, retained to avoid implying that representative acceptance proves every deep customization. Later corporate/agency browser coverage supersedes its browser-pending notes; consult the final readiness report for exact evidence.

| # | Buyer area | Earlier full-scope maturity |
| --- | --- | --- |
| 1 | Company structure | Partial; organization units/locations feed configuration, filters, ownership and workforce behavior, but hierarchy editing and every downstream surface need browser review |
| 2 | Branding | Strong foundation; runtime and live-preview propagation exist, asset-upload polish remains |
| 3 | Terminology | Strong foundation for major entities; audit all remaining legacy/hard-coded strings |
| 4 | Hiring requests | Strong workflow foundation; final end-to-end form/approval/job-creation UX review needed |
| 5 | Job types | Partial/configurable; verify enable/disable/rename consistently in all forms and reports |
| 6 | Job fields/custom fields | Strong foundation; deepen file-field and visibility UX where needed |
| 7 | Hiring pipelines | Strong foundation with server transition enforcement |
| 8 | Application forms | Strong foundation; richer form-builder ergonomics and multilingual authoring remain |
| 9 | Candidate profiles | Partial/strong operational foundation; full section-by-section profile UX needs polish |
| 10 | Recruitment ownership | Partial/strong; reassignment and scopes work, workload-aware assignment remains a placeholder/config |
| 11 | Roles and permissions | Strong foundation; needs exhaustive browser negative-path acceptance |
| 12 | Sensitive information | Strong foundation; continue field-by-field audit as new fields are added |
| 13 | Approval workflows | Strong engine foundation |
| 14 | Interviews | Strong local foundation; external calendar remains mock |
| 15 | Scorecards | Strong foundation |
| 16 | Communication | Mock/local by design with templates/outbox; no live delivery |
| 17 | Automation | Strong local foundation; advanced visual rule-builder polish remains |
| 18 | Offers | Strong foundation; production PDF/e-signature remain external/future |
| 19 | Joining/onboarding | Strong foundation; buyer-facing template authoring can be improved |
| 20 | Careers website | Strong local foundation; full accessibility/mobile/browser audit pending |
| 21 | Employee referrals | Strong foundation; real payouts intentionally absent |
| 22 | Talent pool/CRM | Strong foundation; saved-search and relationship UX can be deepened |
| 23 | Reporting | Partial/strong; named real-data reports exist, broader buyer report composition remains |
| 24 | Integrations | Mock/local/provider-interface foundation; live providers intentionally absent |
| 25 | Data administration | Strong foundation; large-file/import UX and production backup/restore remain |
| 26 | Regional settings | Strong foundation; complete UI string internationalization is not finished |
| 27 | Agency-specific mode | Strong functional foundation; complete agency browser journey pending |
| 28 | Audit logs | Strong foundation |
| 29 | Notification center | Strong foundation |
| 30 | Tasks/follow-ups | Strong foundation |
| 31 | Search | Strong permission-aware foundation |
| 32 | Saved views/filters | Strong foundation |
| 33 | Bulk actions | Strong transactional foundation |
| 34 | Duplicate management | Strong foundation with merge review |
| 35 | Activity timeline | Partial/strong; key events exist, continue completeness audit |
| 36 | Notes/collaboration | Strong local foundation; mentions are limited/not a full collaboration system |
| 37 | Privacy/consent | Strong configurable mechanisms; the product must not claim automatic legal compliance |
| 38 | Configuration change management | Strong foundation with draft/active/history/rollback |
| 39 | Statuses/tags/taxonomies | Partial/strong config foundation; continue removing hard-coded lists |
| 40 | Job templates | Partial; configuration/data foundations exist, buyer CRUD/reuse UX needs focused acceptance |
| 41 | Interview plans | Strong foundation; template authoring polish remains |
| 42 | Approval delegation/backup | Strong foundation |
| 43 | SLA/aging rules | Strong foundation |
| 44 | Hiring targets/workforce plan | Strong foundation |
| 45 | Source management | Strong foundation; configured IDs/labels drive public and internal attribution |
| 46 | Document management | Strong local foundation |
| 47 | Export controls | Strong foundation |
| 48 | Feature toggles/modules | Strong foundation; audit every cross-module dependency in browser |
| 49 | Admin/settings | Broad categorized schema editor exists; buyer-friendly deep editors need ongoing polish |
| 50 | Setup wizard/presets | Strong foundation with five presets and live preview |

This table is intentionally conservative. A configuration field alone is not proof of completion. A feature is commercially complete only when configuration, persistence, authorization, operational behavior, usable UI, and end-to-end verification all agree.

---

## 8. Current verified test state

The following was rerun in this exact workspace on **2026-10-01**:

```bash
npm run test:platform
```

Result:

```text
233 passed
0 failed
0 skipped
```

```bash
npm --prefix server test
```

Result:

```text
884 passed
0 failed
1 intentional existing skip
```

```bash
npm run lint
```

Result: passed with exit code 0.

```bash
npm run build
```

Result: passed. The build still reports a known mixed static/dynamic import warning around the legacy Supabase client; it is not a build failure.

```bash
npm run config:validate
```

Result: passed; the default corporate schemaV2 configuration is valid.

The last complete generated-workspace matrix, before the later live-preview/macOS proxy-only changes, verified corporate, agency, and startup workspaces independently. Each passed its copied platform suite and Vite build. Runtime client access differed as expected:

```text
corporate: 403
agency:    200
startup:   403
```

Do not silently treat that older matrix as a newly rerun result. Rerun the generated matrix when modifying generator, config-copy, startup, or platform runtime behavior.

---

## 9. Browser acceptance status

**Representative local Chromium acceptance passed on 2026-10-02: 21 checks.** See `docs/READINESS_2026-10-02.md` for exercised routes and workflows. Corporate and agency journeys ran through the real UI; three independently generated presets passed install/build/API/backup checks. Safari, the user's Mac, exhaustive accessibility and every original buyer setting have not been browser-tested.

The earlier managed-browser localhost block and broken binaries are historical. A functioning local Playwright/Chromium harness now starts the UI, API and Builder together and exercises actual navigation, forms, downloads and mock-user permissions. API tests and builds remain separate evidence.

The macOS “buttons/page could not be displayed” issue was traced to the Vite proxy using `localhost:4000` while the API was bound to IPv4. The default proxy now uses `http://127.0.0.1:4000`, and a regression test proves it. This fix still needs real user-machine browser confirmation.

The original interactive acceptance checklist (consult the latest report for exact coverage; do not infer every variation was exercised):

1. Configure a corporate company in the builder.
2. Confirm live preview changes immediately on the right.
3. Validate, apply, and launch the local ATS.
4. Switch mock users and verify navigation/permissions change.
5. Create a hiring request and approve it.
6. Create/publish a job.
7. Submit an application through the careers site.
8. Review and move a candidate through only valid pipeline transitions.
9. Schedule/reschedule/cancel an interview.
10. Submit and lock a scorecard.
11. Create/approve/accept or reject an offer.
12. Start and complete onboarding tasks.
13. Verify notifications, tasks, SLA indicators, reports, timeline, documents, audit, and persistence after reload.
14. Verify a restricted employee/interviewer cannot open protected pages, fields, downloads, exports, or actions.
15. Repeat agency mode: client → contract/mandate → submission → placement → fee/invoice → guarantee.
16. Inspect browser console and network panel for runtime errors or failed API calls.
17. Test responsive/mobile layouts and keyboard/accessibility fundamentals.

`scripts/browser-acceptance.mjs` is the current verified entry point (`npm run test:browser`). Install Chromium with `npx playwright install chromium` first. `scripts/browser-check.mjs` is an older helper.

---

## 10. What remains

### Highest priority

1. **Maintain and broaden the passing browser suite.** The requested local readiness flows now pass. Confirm the patch on the user's Mac and extend cross-browser, keyboard/accessibility and less common workflow variants without claiming the current representative suite covers every original requirement.
2. **Finish buyer-grade configurator depth.** The guided top-level flow is polished and progressive, but many advanced settings still depend on the in-app Settings/schema editing experience. Build focused business-friendly editors for the important deep areas instead of exposing raw JSON or giant generic forms.
3. **Make the live preview cover more of the ATS.** It currently demonstrates key pages/settings. Extend it so a buyer can preview the exact page/feature being configured—forms, candidate profile, scorecards, communications, offers, careers detail/application, agency screens, etc.—without pretending draft preview writes operational data.
4. **Perform a hard-coded-string/list audit.** Centralize remaining terminology, statuses, taxonomies, employment types, sources, document categories, priorities, and reasons wherever company configuration should control them.
5. **Perform module dependency acceptance.** Disabling a module must remove navigation and block related backend routes/actions without leaving dead links, orphan buttons, or contradictory settings.
6. **Complete three full organization journeys.** Corporate, agency, and startup must differ operationally, not only by theme and visible menu.
7. **Polish deep operational UI.** Replace generic record-form behavior where a workflow deserves a purpose-built guided experience. Ensure loading, empty, validation, error, confirmation, and success states are clear.

### Production hardening after local product acceptance

These are necessary before selling a hosted production service, but they are not reasons to add Supabase/Vercel/OAuth during the current phase:

- Decide between one isolated deployment per customer and a true multi-tenant hosted control plane.
- Production authentication/SSO, session security, account recovery, invitations, and user lifecycle.
- Hosted database/storage migration strategy, encryption, backups, restore drills, disaster recovery, and tenant isolation.
- Secrets/key management.
- Rate limits, CSRF/session protections as appropriate, upload scanning, file-type verification, and security review.
- Background job/queue infrastructure and reliable delivery semantics.
- Production email/calendar/job-board/HRIS/e-sign/evaluation/background-check adapters.
- Observability, structured logs, traces, error reporting, health monitoring, and support tooling.
- Subscription/billing/plan entitlements if sold as hosted SaaS.
- Tenant provisioning, upgrades, schema/config migrations, fleet rollback, and support access policies.
- Legal documents and company-specific privacy/legal review. Do not claim GDPR or other legal compliance merely because mechanisms exist.
- Accessibility audit, performance/load testing, large-data pagination/search/indexing, and cross-browser testing.

---

## 11. Exact local setup commands

Prerequisite: Node.js 22.13 or newer and npm (Node.js 24 is recommended).

From this workspace:

```bash
cd /workspace/scratch/a4e1d83b502e
npm run setup
npm run local
```

Keep that terminal running. Open:

```text
http://127.0.0.1:4177
http://127.0.0.1:5173/platform
http://127.0.0.1:5173/careers-platform
```

If `/workspace/scratch/a4e1d83b502e` does not exist on the user’s Mac, that is expected: it is a cloud-workspace path, not a folder that automatically exists locally. Extract the checkpoint first:

```bash
mkdir -p "$HOME/SAAS-ats"
tar -xzf "$HOME/Downloads/ats-saas-source-checkpoint-2026-09-29-macos-proxy-fix.tar.gz" -C "$HOME/SAAS-ats"
cd "$HOME/SAAS-ats"
npm run setup
npm run local
```

Use the actual extraction folder if the archive contains an extra top-level directory. Confirm `package.json` is present before running npm commands:

```bash
pwd
ls package.json
```

Use `127.0.0.1`, not a cloud `/workspace/...` path and preferably not `localhost`, when opening the URLs on macOS.

### Run a generated organization

Generate from the builder, then either use the generated directory in the factory:

```bash
cd generated/<company-slug>/workspace
npm run setup
npm run local
```

Or extract the downloaded generated archive, enter its `workspace` directory, verify `package.json` exists, then run the same two commands.

Only run one workspace on the default ports at a time. For parallel work, override ports and database paths deliberately.

---

## 12. Standard verification commands

Run after meaningful changes:

```bash
npm run test:platform
npm --prefix server test
npm run lint
npm run build
npm run config:validate
```

For focused changes, run the nearest unit test first, then the full gates. For changes to generation/config/startup, also generate and independently test at least corporate, agency, and startup packages.

Do not declare completion from compilation alone. Completion requires runtime/browser evidence, data persistence after reload, authorization negative paths, and configuration-driven behavioral differences.

---

## 13. Instructions for the next coding agent

1. Read this file, `README.md`, `docs/SAAS_ATS_BUILDER.md`, and the latest part of `docs/ATS_ACCEPTANCE.md`.
2. Verify `pwd`, repository identity, Git status/metadata, and that this is not the original Fyndbridge repository.
3. Run the existing verification suite before broad edits.
4. Start the app and inspect the current UI before replacing working modules.
5. Preserve the separation between platform capability, company configuration, and operational data.
6. Do not add customer-name conditionals.
7. Put authorization in services/routes, not only in hidden buttons.
8. Keep business logic out of random React components.
9. Prefer shared engines for permissions, fields, pipelines, approvals, automations, templates, terminology, regional formatting, and feature flags.
10. Treat integrations as adapter interfaces with explicit local/mock implementations during this phase.
11. Every visible button must work or be clearly labelled as an intentional mock/external-provider placeholder.
12. Add focused tests for every bug or policy change and update the acceptance ledger with exact commands/results.
13. Never claim browser acceptance unless a real browser navigated and exercised the flows.
14. Do not silently reduce the 50-area scope to configuration fields or TODO comments.
15. When reporting progress, give an honest percentage/bar as an engineering estimate and separately state what is actually verified.

### User’s orchestration preference

When model-specific delegation is available and subagents are appropriate:

- Root architecture/review/integration: **Sol high**.
- Implementation/repetitive bounded subagents: **Luna light/low only**, not medium or high.
- State the model beside every subagent/workstream name in progress updates.
- Assign non-overlapping file/module ownership before parallel edits.
- Root must inspect, integrate, test, and fix subagent work; a subagent saying “done” is not acceptance.

If those exact model labels are unavailable in the current tool, use the closest available capability without pretending the requested model was used.

---

## 14. Product review lenses

Before calling the project finished, review it from all three perspectives.

### CEO / buyer

- Can I configure this for my organization without asking a developer to edit source code?
- Can I understand the setup language without knowing the schema?
- Does the preview accurately show the impact of my choices?
- Are presets useful starting points rather than locked templates?
- Can I safely change and roll back configuration?

### HR / recruiter / agency consultant

- Can I operate recruitment daily from request to hire/onboarding?
- Are forms, queues, ownership, follow-ups, interviews, feedback, offers, and reports usable?
- Do careers/referrals/talent pools create real connected data?
- In agency mode, can I manage client, mandate, submission, placement, invoice, and guarantee without fake buttons?

### Technical/company administrator

- Can I control roles, sensitive data, exports, modules, workflows, templates, taxonomies, retention, and integrations without inconsistent states?
- Are backend boundaries authoritative?
- Are configuration changes versioned, validated, audited, previewed, and recoverable?
- Is local data isolated and durable?

Fix weaknesses found through these lenses when they fall within the local product scope.

---

## 15. Definition of done for the current local phase

The local product is genuinely ready for handoff only when all of the following are true:

- Builder and ATS start on a clean machine using documented commands.
- Corporate, agency, and startup generation/install/start succeed independently.
- All unit, platform, server, lint, build, and config-validation gates pass.
- A real browser completes the corporate and agency journeys.
- No important console/network errors remain.
- Navigation has no broken destinations.
- Primary buttons and forms work and validate.
- Operational records persist after reload.
- RBAC denies unauthorized pages, routes, records, sensitive fields, files, exports, and actions.
- Configuration changes actual behavior, not only stored JSON.
- Terminology and regional formats propagate consistently.
- Feature toggles cleanly hide and block disabled modules.
- Careers forms create actual linked candidate/application records.
- Reports use persisted data and actor scope.
- Audit logs record material actions.
- Mock/external integrations are honestly labelled.
- The original Fyndbridge repository remains untouched.
- Remaining limitations are only genuine hosted/external-service work, not unfinished local workflows hidden behind “future” labels.

---

## 16. Short prompt to paste into a new coding session

```text
Read PROJECT_CONTEXT_FOR_VSCODE.md completely before acting. Continue the configurable local ATS SaaS/generator from its verified checkpoint. Never touch the original divyam9308/fyndbridge-ats repository. Keep localhost + SQLite/local files + mock auth/integrations; no Supabase, Vercel, or real Google OAuth in this phase. Preserve platform capability vs company configuration vs operational-data separation. Audit the current runtime first, then work through the highest-priority remaining items, especially real browser acceptance, broken/dead UI behavior, buyer-friendly advanced configuration editors, deeper page-specific live preview, hard-coded terminology/taxonomy cleanup, module dependency checks, and full corporate/agency/startup journeys. Authorization must be enforced server-side. Run and report exact tests, lint, build, config validation, generated-package checks, and browser flows. Do not call a field or mock screen a completed feature. Update docs/ATS_ACCEPTANCE.md with evidence and keep this context file accurate.
```
