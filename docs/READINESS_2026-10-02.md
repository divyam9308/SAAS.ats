# Local ATS readiness report — 2026-10-02

The requested local readiness pass is complete. This report supersedes the paused `CHECKPOINT_2026-10-02.md`. Source: `/workspace/SAAS.ats`, branch `main`, base `c65d2c899d9684175225bfe07c0972338fd2d753`. Verification completed before publication; the user explicitly authorized committing and pushing this pass on 2026-10-02. The user's Mac checkout was not accessed, and the original Fyndbridge repository was not modified.

## Delivered changes

- Settings protect dirty edits during navigation, user switching and browser unload. Presets, module changes, activation and rollback require appropriate confirmation. Activation presents a readable item-level diff and acknowledgment, validates server-side and rejects stale draft/version writes. Rollback uses the same transactional activation boundary.
- Careers consume configured company identity, logo/favicon, typography, colors, terminology, regional salary/date formatting and allowlisted copy. Unsafe asset URLs and credential-bearing URLs are rejected. Private login copy is excluded from public company payloads. SLA dates/times use regional formatting.
- Isolated deployments have checksum-validated SQLite/document backup, preview and explicit offline restore. Restore preserves prior data, validates paths and refuses unsafe targets. Runtime locks prevent conflicting restore/regeneration. Generation is staged, preserves existing records/documents, creates reproducible lockfiles and produces code-only download archives.
- Browser-discovered issues were fixed: restricted-user dashboard refresh/navigation, optional blank form values, document upload event lifetime, attachment linkage, readable permission-aware relationship labels, timeline capabilities, and guarantee-review action ordering. Labels never bypass linked-record authorization. Timeline requests are supported only for appropriate record kinds.
- Unavailable external integrations have clear local/mock handling rather than implying live service delivery. Generated customer workspaces default to `seedDemo: false`; configuration-derived mock users remain available without fake operational records.

## Architecture and persistence

React/Vite provides the operational ATS and Settings; the existing Builder provides company setup, split-screen draft preview and generation. Express services/routes enforce authorization, module gates, sensitive-field projection and workflow rules. Shared versioned schema v2 provides defaults, normalization, validation and migration compatibility. Configuration lifecycle, approvals, pipeline, automation, custom fields and templates remain reusable platform capabilities rather than company-name conditionals.

Company configuration and its versions are separate from operational records. Each generated company has its own SQLite database and local document directory. Factory defaults are `server/data/platform-local.sqlite` and `server/data/platform-documents`; generated defaults are `server/data/platform.sqlite` and `server/data/documents`. Environment overrides remain supported. Resume/document bytes live in document storage; operational JSON stores references/metadata, not duplicated `contentBase64` payloads. Backup includes the database and documents; downloadable code archives do not.

Major company settings include organization, branding, terminology, modules, roles, hiring/forms/fields, pipelines, interviews, approvals, communications, automation, offers/onboarding, careers, reporting, regional settings, privacy and agency mode. Some advanced configuration still uses schema editing; the representative acceptance suite does not establish polished dedicated editors for every original setting.

## Verification

Node 24.19.0 was used; Node >=22.13 is required and Node 24 is recommended. All commands exited 0. Test suites overlap; do not sum them as unique coverage.

| Command | Result |
| --- | --- |
| `npm run test:platform` | 271 passed; 0 failed/skipped |
| `npm --prefix server test` | 912 passed; 0 failed/skipped |
| `npm test` | 30 passed; 0 failed/skipped |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run config:validate` | Default corporate schema v2 valid |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm --prefix server audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 0 vulnerabilities |
| `npm --prefix server audit` | 0 vulnerabilities |
| `npm run test:generated` | Three presets passed 259 tests each; 6 root/server installs, 3 builds, 4 API starts, 31 runtime/backup assertions and 9 backup CLI commands |
| `ATS_BROWSER_EXECUTABLE=/tmp/ats-chromium npm run test:browser` | 21 real Chromium browser checks passed; no captured page/console errors |
| `git diff --check` | Passed |

The production build emits one nonblocking legacy Supabase mixed static/dynamic import warning. No Supabase service is required for the configured local platform. The environment also emits an npm proxy configuration warning; it did not fail installation or audits.

### Actual browser acceptance

Playwright navigated Chromium 153.0.8010.0 with desktop 1440×960 and mobile 390×844 viewports. The harness starts its own isolated API, UI and Builder, uses synthetic records, and cleans its own generated workspaces. `/tmp/ats-chromium` is this environment's installed browser; local users should use `npx playwright install chromium` then `npm run test:browser`.

The 21 passing checks exercised:

1. Mock sign-in and dashboard at `/platform`.
2. Builder split-screen live preview, generation and Apply at the Builder root.
3. Builder regeneration preserving an existing customer record/document; downloaded archive excludes operational data.
4. Settings dirty-navigation cancellation and saved draft after reload.
5. Readable activation diff and acknowledgment.
6. Version-history rollback confirmation.
7. Configured careers job detail/application form at `/careers-platform`.
8. Public application with consent/resume; persisted answers contain no resume bytes, downloaded bytes match.
9. Candidate document upload, replacement/version and download.
10. Corporate hiring request through manager/HR/CEO approval, job creation and publication.
11. Candidate pipeline movement and persisted stage history.
12. Interview scheduling, scorecard submission and locked feedback.
13. Sequential offer approval, acceptance and generated onboarding checklist.
14. Persisted workflow tasks and notifications.
15. Reports, tasks, notifications and audit navigation.
16. Mock interviewer restrictions, including service-layer settings/export denial.
17. Restricted-route reload and return to admin remain usable.
18. Preset cancellation, module confirmation, terminology and careers copy/branding activation.
19. Agency preset navigation and client creation.
20. Agency mandate, candidate submission, placement, invoice HTML preview and replacement guarantee request/review/approval.
21. Mobile workspace menu and careers layout without horizontal overflow.

The corporate and agency UI journeys use the shared platform with activated configurations. Separately, independently generated corporate/agency/startup workspaces were installed, built and tested through their API/runtime/backup paths. Agency client access differed 403/200/403, terminology/pipelines/modules differed, and generated data remained empty with `seedDemo: false`. A production-mode API without a real authentication adapter returned fail-closed 503. These are distinct checks, not a claim that every generated package was separately browser-tested.

### Regression coverage added

Focused tests cover configuration review/concurrency and diff presentation; public projection/URL safety/regional formatting; optional form payloads; permission-aware relationship labels; timeline capability and scope/sensitive-data boundaries; SQLite/document backup/restore, tampering, paths and locks; CLI behavior; generation assets, data preservation and archive safety. `scripts/generated-matrix.mjs` and the browser harness add integrated organization/workflow acceptance.

## Native subagent workstreams

Root inspected and integrated the changes, reran tests and actual browser flows, and fixed issues rather than accepting agent completion messages as proof. No Ollama models were used.

| Workstream | Model | Ownership |
| --- | --- | --- |
| Settings/configuration review | Native Luna medium | Settings UI/CSS and diff helper/tests |
| Careers presentation | Native Luna low | Careers presentation helper/public tests |
| Backup/restore | Native Luna medium | Backup service, CLI, runtime lock and tests |
| Generator safety | Native Luna medium | Generator and generation safety tests |
| Generated matrix | Native Luna low | Isolated preset matrix harness |
| Corporate browser | Native Luna medium | Corporate browser flow helper |
| Agency browser | Native Luna medium | Agency browser flow helper |
| Record labels | Native Luna medium | Relationship presentation helper/tests |
| Timeline tests | Native Luna low | Timeline capability integration tests |
| Safety review | Native Luna low | Read-only privacy/security inspection |
| Readiness documentation | Native Luna low | README and Builder guide |

## Final review and limitations

Buyer review: tested company differences apply to navigation, terminology, branding, careers and operational workflow configuration without source edits. HR review: the corporate request-to-onboarding and agency client-to-placement/invoice/guarantee journeys are operable in the UI. Administrator review: draft/active separation, stale-write checks, confirmations, role restrictions, audit, safe regeneration and offline backup/restore are tested.

Source inspection found no tracked/pending database, upload, generated-output or dependency-cache artifacts; no credential-pattern matches or persisted resume-byte duplication were found. Public login-copy exposure identified during review was removed and regression-tested. This targeted review is not an independent penetration test or legal-compliance certification.

Engineering estimate: approximately **95% readiness for this isolated local development/testing product**, not a measured completion percentage across all 50 original buyer areas. The requested readiness pass is complete; deeper business-friendly advanced editors and exact-page previews, uncommon workflow variants, Safari/Firefox, exhaustive accessibility, performance/load and large-data behavior remain areas for further product validation. The user's Mac has not been tested from this environment.

Authentication/user switching, email/outbox, calendar behavior and external payment/provider behavior are intentionally mocked. Integration categories without adapters are explicitly unavailable. EICAR handling is a local scanner mock, not production antivirus. A real hosted offering still needs decisions and implementation for identity/session lifecycle, provider credentials and delivery reliability, tenancy/fleet provisioning, billing, hosted storage/backups/disaster recovery, operations/security review and legal requirements. No Supabase, Vercel, paid providers or real OAuth were added.

## Apply and start locally

After the authorized GitHub publication, update your Mac checkout with `git pull --ff-only origin main`, then run `npm run setup` and `npm run local`. Preserve any local work first; do not reset or force conflicting changes. The downloadable patch remains an alternative for the original base commit: extract it and check before applying. Do not apply that patch after pulling the same changes.

```bash
cd "/Users/divyamaggarwal/Desktop/files/ATS PUBLIC VERSION/SAAS.ats"
git status --short
git rev-parse HEAD
git apply --check /absolute/path/to/ATS_READINESS_PATCH.patch
git apply /absolute/path/to/ATS_READINESS_PATCH.patch
npm run setup
npm run local
```

Factory Builder: `http://localhost:4177`. ATS: `http://localhost:5173/platform`. Careers: `http://localhost:5173/careers-platform`. Development-only mock user switching is visibly labelled. To rerun acceptance:

```bash
npx playwright install chromium
npm run test:browser
npm run test:generated
```

After generating a company, stop the factory process to free its ports and run:

```bash
cd generated/<company-slug>/workspace
npm run setup
npm run local
```

Stop that deployment before offline backup/restore. From its workspace:

```bash
npm run backup:create -- --destination /absolute/path/to/new-backup-directory
npm run backup:preview -- --bundle /absolute/path/to/new-backup-directory
npm run backup:restore -- --bundle /absolute/path/to/new-backup-directory --confirm
```

The restore script supplies `--replace`; explicit `--confirm` is still required. Existing recognized data is preserved beside its targets. See `LOCAL_BACKUP_RESTORE.md` before using real customer backups. Backups contain sensitive company data and should be stored appropriately.

## Exact changed files

The portable patch's `CHANGED_FILES.txt` contains the same exact diff inventory against the base commit (45 files):

```text
.gitignore
PROJECT_CONTEXT_FOR_VSCODE.md
README.md
builder/generate.mjs
builder/generation-safety.test.cjs
docs/ATS_ACCEPTANCE.md
docs/BACKEND.md
docs/CHECKPOINT_2026-10-02.md
docs/FULL_PROJECT.md
docs/LOCAL_BACKUP_RESTORE.md
docs/READINESS_2026-10-02.md
docs/SAAS_ATS_BUILDER.md
package-lock.json
package.json
scripts/browser-acceptance.mjs
scripts/browser-agency-flows.mjs
scripts/browser-corporate-flows.mjs
scripts/deployment-backup.mjs
scripts/generated-matrix.mjs
server/package-lock.json
server/package.json
server/src/platform/config-lifecycle.js
server/src/platform/config-review-safety.test.js
server/src/platform/deployment-backup-cli.test.js
server/src/platform/deployment-backup.js
server/src/platform/deployment-backup.test.js
server/src/platform/index.js
server/src/platform/public-presentation.test.js
server/src/platform/record-presentation.js
server/src/platform/record-presentation.test.js
server/src/platform/runtime-lock.js
server/src/platform/runtime-lock.test.js
server/src/platform/timeline-capabilities.test.js
shared/ats-config.cjs
src/main.jsx
src/platform/PlatformApp.jsx
src/platform/Settings.css
src/platform/Settings.jsx
src/platform/careers-presentation.js
src/platform/careers-presentation.test.js
src/platform/careers-theme.css
src/platform/config-review.js
src/platform/config-review.test.js
src/platform/form-payload.js
src/platform/form-payload.test.js
```
