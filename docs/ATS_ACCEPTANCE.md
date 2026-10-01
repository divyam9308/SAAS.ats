# Configurable ATS acceptance ledger

This ledger tracks the requested local SaaS platform expansion. A configuration field or an API returning success is not evidence of a working feature. Completion requires a persisted behavior, authorization where applicable, usable UI, and a meaningful verification result.

## Scope and safety

- Work directory: `/workspace/scratch/a4e1d83b502e`.
- This directory has no Git metadata. No original FyndBridge repository may be changed.
- Runtime: localhost, SQLite, local files, explicitly labelled mock user switching.
- External email, calendars, payments and identity providers must remain mock adapters.
- Platform capabilities, company configuration and operational records must remain separate.

## Baseline audit

Existing reusable assets include the React/Vite application, Express API, company branding, legacy agency screens, configuration editor, package generator, and local SQLite storage. Existing local permissions, notifications, duplicate checks and document handling contain placeholders and cannot satisfy the expanded requirements. The legacy backend regression suite does not verify new platform behavior.

## Acceptance groups

| Requirements | Required evidence | Status |
| --- | --- | --- |
| 1–3, 26: organisation, branding, terminology, region | Changes affect operational forms, navigation, ownership, filtering and display | In progress |
| 4–7: requisitions, jobs, fields, pipelines | Request approval creates a job; configured field and transition rules enforced server-side | In progress |
| 8–10, 20: forms, candidates, ownership, careers | Published job accepts a configured public application and creates linked records | In progress |
| 11–12, 47: RBAC, sensitive data, exports | Negative authorization tests for routes, actions, records, nested data and exports | In progress |
| 13, 42: approvals and delegation | Sequential and threshold decisions, rejection and backups affect domain state | In progress |
| 14–15, 41: interviews, scorecards, plans | Schedule, reschedule, feedback submission, required criteria and locks work | In progress |
| 16–17, 29–30, 43: communication, automation, notifications, tasks, SLA | Events create persistent outbox/tasks/notifications and bounded automation logs | In progress |
| 18–19: offers and onboarding | Approved offer can be accepted/rejected; acceptance creates configured onboarding | In progress |
| 21–22, 32, 45: referrals, CRM, saved views, sources | Persisted and permission-aware workflows and attribution | In progress |
| 23, 44: reports and workforce targets | Metrics derive from stored records and respect actor scope | In progress |
| 24: integration adapters | Explicit local adapters with inspectable results; no paid service required | In progress |
| 25, 33–34, 37: data operations, bulk actions, duplicates, privacy | Validated import, safe merge, archive/restore, consent and privacy requests | In progress |
| 28, 35–36, 46: audit, timeline, notes, documents | Authored chronological history and real local attachment persistence | In progress |
| 27: agency mode | Client → mandate → submission → placement → fee/invoice/guarantee flow | In progress |
| 38–40, 48–50: configuration lifecycle, lists, templates, modules, admin, presets | Draft validation, activation, rollback and editable corporate/agency/startup presets | In progress |
| Generator | Three independent generated organisations install, start and behave differently | Verified by package tests/build/runtime matrix |
| Browser acceptance | User-operated corporate and agency flows, restriction checks and console inspection | Blocked by managed-browser localhost access |

## Verification rules

Record exact test commands and results when available. Do not mark browser verification complete from HTTP requests alone. Do not mark integrations as live when they use mock adapters. Remaining scope gaps must be disclosed rather than relabelled as future external-service work.

## Buyer review (2026-09-24)

The current platform is a substantial local scaffold, not yet a complete product against the 50 requested buyer areas. In particular, generic record forms do not currently make all HR and agency workflows usable, several related records need stricter record-level authorization, and some configured settings still lack operational behavior. The estimated overall progress was revised from 44% to 35% after this review; this is an engineering estimate, not measured requirement coverage.

Current priority workstreams are privacy and write-boundary enforcement, scoped authorization for linked records, correct settings editing and activation, operable workflow forms, and persisted stage history for reporting. Remaining acceptance work includes complete notes/timeline/documents, saved views/CRM/referrals, privacy retention and request handling, more specific reports and agency flows, and full browser interaction testing. Do not mark these complete based on config fields or generic CRUD alone.

## Current verified checkpoints

### Split-screen live configuration preview — 2026-09-28

- The buyer builder now presents configuration controls on the left and a sticky live ATS preview on the right. Draft edits render immediately while typing; generation or activation is not required.
- The preview follows the current setup section by default and can be switched manually between dashboard, jobs, candidates, pipeline and careers. Its own navigation is interactive and reflects enabled modules, including agency clients and invoices.
- Company/product names, primary/accent colours, light/dark mode, typography, business terminology, enabled-module navigation, regional date/time/currency formatting, pipeline stages and approval-workflow counts are driven directly by the in-memory draft.
- The split view becomes a stacked editor/preview layout on smaller screens. The preview is labelled as a draft and does not write operational records.
- `node --test builder/builder-ui.test.cjs`: **3 passed, 0 failed**. `npm run test:platform`: **232 passed, 0 failed**. `npm run lint` and `npm run build` passed. The production build retains the known local-font and mixed dynamic-import warnings.
- Managed-browser localhost access remains blocked with `ERR_BLOCKED_BY_CLIENT`; interactive cloud-browser acceptance is still not being claimed.

### Guided buyer setup and policy hardening — 2026-09-26

- The standalone builder is now a progressive buyer-facing setup flow rather than a raw JSON console. It guides company/preset, enabled modules, branding and terminology, regional formats, pipeline/approvals, and review/generation. It includes corporate, agency, startup, campus-heavy and minimal presets; save/resume; import/export; section/full reset; contradiction warnings; a brand/terminology preview; and an optional advanced JSON escape hatch.
- Builder tests prove the guided surface is primary and all five presets load and validate through the builder API. Raw JSON is no longer required for normal generation.
- Temporary approval delegations now honor inclusive start/end dates both when assigned and when used; disabled, missing and expired rules cannot be bypassed through a persisted delegate assignment.
- Communication automations and interview reminders select localized templates with fallback, render configured variables and aliases, preserve sender identity, honor approval-before-send state, respect per-user notification preferences and remain explicitly mock/local delivery.
- Import mapping rejects ambiguous duplicate destinations and reserved/prototype targets. Candidate restore refuses to reactivate an archived candidate when a matching active identity appeared after archive.
- Platform navigation, global search and notification shortcuts now share permission/module visibility checks. Retry state is explicit and rejected retries are surfaced instead of silently ignored. Settings can now author choices for newly created select custom fields.
- `npm run test:platform`: **231 passed, 0 failed**. `npm --prefix server test`: **884 passed, 1 intentional existing skip, 0 failed**. `npm run lint`, `npm run build`, and `npm run config:validate` passed.
- Fresh corporate, agency and startup packages each passed **229/229** generated-workspace tests and a Vite production build. Runtime smoke resolved corporate/agency/startup modes and enforced client access as **403/200/403**. The generated test count omits the factory-only builder tests by design.
- Browser interaction remains unverified because the managed browser rejects both `127.0.0.1` and `localhost` before a request reaches the Vite server. This environmental limitation is not being relabelled as a passing browser journey.

### Privacy, operational controls and route-mutation verification — 2026-09-25

- Candidate contact authorization now treats alternate email/phone, profile URLs, LinkedIn, portfolio and address as protected contact data across nested projections, while preserving the candidate name for users who can read the candidate record.
- Interview reminders now honor configured notification modules, channels and categories. Disabling in-app notifications suppresses reminder notifications; disabling integrations suppresses the local mock outbox without changing legacy configurations that omit those flags.
- The record drawer supports first-time local document uploads as well as replacement/version history. Configured categories, visibility and file-size limits drive the form and the existing service-layer permission checks remain authoritative.
- Referral milestones and payout states are updated through dedicated, strict, scoped and audited actions rather than generic field edits. The drawer exposes those actions only to users with referral edit permission. Onboarding plans expose required-item blockers and can be completed only after configured required items are finished.
- Privacy retention has one operational authority (`privacy.retentionDays`). Older `data.retentionDays` values remain import-compatible, are identified as inactive when the canonical setting exists, and can still be edited for genuinely legacy configurations. The legacy `publicRoles` careers alias is no longer presented as a conflicting second module toggle when `careers` is present.
- Route acceptance now verifies candidate merge relinking/archive/atomic failure, workforce-target create/edit/import normalization, and restricted document version/download authorization.
- `npm run test:platform`: **222 passed, 0 failed**. `npm --prefix server test`: **878 passed, 1 intentional existing skip, 0 failed**. `npm run lint`, `npm run build`, and `npm run config:validate` passed.
- Fresh corporate, agency and startup packages generated from the current source each passed **222/222** copied platform tests and a Vite production build. Runtime bootstrap returned **200** for all three, resolved the expected corporate/agency/startup modes, and enforced agency client access as **403/200/403**. Module assertions also confirmed corporate workforce planning enabled and agency features disabled/enabled/disabled respectively.
- Browser automation connected to the managed browser, but navigation to the local Vite application was blocked with `ERR_BLOCKED_BY_CLIENT`. Browser acceptance therefore remains **not passed** and is not being inferred from API tests or the production build.

### Workforce and operational UI verification — 2026-09-25

- Candidate duplicate review now has an explicit, permission-aware UI: an authorized user can scan a candidate, see the configured matching evidence, choose a distinct readable primary record, and enter the existing transactional merge workflow. Empty, loading and error states are explicit.
- Document drawers now show only the latest attachment version by default, expose authorized immutable version history and downloads, and allow configured replacement uploads for candidates, jobs, applications, offers, onboarding records and agency clients. Replacement metadata never persists submitted base64 content in SQLite.
- Workforce planning entry now uses bounded month/quarter choices, configured organization-unit and location choices, optional role/category and positive integer headcount. The write and import boundaries validate supported periods and configured dimensions; edit normalization returns only the requested patch and cannot reintroduce server-managed fields.
- The reports surface compares persisted workforce targets with scoped, dated corporate hires or agency placements. Saved searches retain their bounded safe query; interview scheduling and local reminder behavior remain operational from the preceding checkpoint.
- `npm run test:platform`: **215 passed, 0 failed**. `npm --prefix server test`: **875 passed, 1 existing skip, 0 failed**. Focused workforce tests: **9 passed, 0 failed**. `npm run lint`, `npm run build`, and `npm run config:validate` passed. The build retains the previously known missing local-font resolution and mixed dynamic-import warnings.
- Browser interaction is still **not** counted as passed because this environment has no working browser binary/localhost bridge. API acceptance and a production React build are not substitutes for the requested end-to-end browser flows.
- Fresh corporate, agency and startup workspaces generated from this source each passed **215/215** copied platform tests and a Vite production build. Same-process runtime smoke returned health/bootstrap **200/200** for all three; mode resolved to corporate/agency/startup, and clients access resolved to **403/200/403**. The corporate verification configuration also exposed its enabled workforce-planning module. Temporary verification packages were moved outside the workspace afterward.
- Overall progress is an engineering estimate, not literal measured coverage of the 50 buyer areas. Remaining acceptance still includes browser-driven corporate and agency user journeys plus buyer-facing polish discovered through those journeys.

### Restored checkpoint verification — 2026-09-25

- Candidate merge is now operable in the platform UI: the duplicate record cannot be merged without choosing a distinct readable primary candidate, and the server continues to relink related records and archive the duplicate transactionally.
- Configured document categories, visibility and replacement policy now govern actual uploads. Versions persist monotonic ancestry, every version remains locally downloadable, authorization applies to history, and SQLite stores metadata rather than submitted base64 file bodies.
- Interview creation, editing, rescheduling and cancellation now validate explicit-offset ISO timestamps, configured interview types, positive durations and the workspace IANA timezone. Shared interviewer/panel and room overlaps are rejected. Calendar metadata is server-owned and provided by the explicitly local mock adapter.
- The local reminder scheduler is enabled only in the local/generated runtime (disabled by default in tests), runs immediately and every 60 seconds, queues idempotent in-app notifications and optional mock outbox messages, and stops before SQLite closes.
- Saved views can persist a bounded text query. Server filtering searches safe primitive display fields and arrays without traversing sensitive or nested objects.
- `npm run test:platform`: **211 passed, 0 failed**. `npm --prefix server test`: **871 passed, 1 existing skip, 0 failed**. `npm run lint`, `npm run build`, `npm run config:validate`, and changed-file syntax checks passed. The build retains the previously known missing local-font resolution and mixed dynamic-import warnings.
- Fresh corporate, agency and startup packages each passed **211/211** copied platform tests and built successfully. Same-process runtime smoke returned health 200 for all; clients returned **403 / 200 / 403**, proving agency capability is disabled for corporate/startup and enabled for agency. Temporary verification outputs were removed from the workspace afterward.
- Browser interaction has **not** been counted as passed. This environment still lacks a functioning browser binary/localhost browser bridge, so the API/runtime smoke and React build are not a substitute for the requested browser acceptance flows.
- Overall progress remains an engineering estimate rather than measured requirement coverage. The highest-value remaining product work is a buyer-facing duplicate-review surface, document replacement/history controls in the drawer, stronger workforce-target entry ergonomics, and full browser acceptance.

- Configured source IDs/labels now control internal candidate/application creates and edits and public careers attribution. Disabled/unknown choices fail validation, while unchanged historical labels survive edits; legacy configs without a source list remain usable. Regional timezone and 12/24-hour preferences now affect platform timestamp displays, with formatter tests. `npm run test:platform`: **186 passed, 0 failed**; `npm --prefix server test`: **849 passed, 1 existing skip, 0 failed**; `npm run lint` and `npm run build` passed. Estimated operational buyer scope ~64%; browser acceptance is still blocked by browser availability.
- Linked notes now require a readable parent, preserve authorship and private-note scope, and expose an allowlisted timeline; the drawer consumes the scoped timeline. SLA aging evaluates applications, stages, interview feedback and offer approvals against configured thresholds including older flat preset keys, working days/hours where set; `/sla/overview` filters by module, permission and record scope, and the dashboard shows stored-record aging. `npm run test:platform`: **183 passed, 0 failed**; `npm --prefix server test`: **846 passed, 1 existing skip, 0 failed** (before final SLA UI polish); `npm run lint` and `npm run build` passed. Estimated operational buyer scope ~61%. Browser acceptance remains blocked by the available browser environment.
- Resumed after a transient scratch reset that discarded an earlier unpersisted 53% work session. The recovered source was the 111-test checkpoint. Rebuilt critical generic write/import guards, onboarding checklist routing/UI, employee referrals, public applicant isolation, privacy document cleanup and report catalog. `npm run test:platform`: 122 passed, 0 failed; `npm --prefix server test`: 796 passed, 1 existing skip, 0 failed; `npm run lint` and `npm run build` passed on 2026-09-24. This is approximately 42% of the full operational buyer scope. The source excluding dependency caches, browser binaries, generated outputs and data has a persistent archive named `ats-saas-source-checkpoint-2026-09-24.tar.gz`.
- Subsequent rebuilt checkpoint: agency replacement guarantee, consent-scoped talent pool membership and rediscovery, configured weighted interview scorecards, permission-gated offer HTML preview, independently approved/dry-run retention processing, and workforce target vs actual reports have API paths, UI controls and focused tests. `npm run test:platform`: **153 passed, 0 failed**; `npm --prefix server test`: **825 passed, 1 existing skip, 0 failed**; `npm run lint` and `npm run build` passed. Single-process localhost smoke returned 200 for UI, builder, health and platform bootstrap. Three independently generated corporate, agency, startup workspaces built, passed 147 platform tests each at that earlier sub-checkpoint, and differed in agency client access (403/200/403). Temporary outputs removed. Estimated operational buyer scope ~53%; full browser interaction is still blocked (`ERR_BLOCKED_BY_CLIENT` in cloud browser, bundled Chromium binaries crash on `--version`).
- Bulk assignment/tagging/archive/application stage actions now validate every selected record and execute transactionally, with UI selection/confirmations and negative rollback tests. Agency client contracts now version nested terms, enforce scoped admin edits, and apply active fee/guarantee terms to placement and invoice outcomes. `npm run test:platform`: **169 passed, 0 failed**; `npm --prefix server test`: **836 passed, 1 existing skip, 0 failed**; lint/build passed. Estimated operational buyer scope ~57%. Browser acceptance remains blocked.

- `node --test shared/ats-config.test.cjs`: 6/6 passed. Corporate, agency, startup, campus and basic defaults validate; version migration is idempotent; consent is required.
- `node --test tests/platform.acceptance.test.cjs`: 17/17 passed as of the last run. Passing checks cover distinct presets, disabled agency routes, RBAC revocation, sensitive masking and exports, immutable workflow fields, corporate approval → job → careers application, agency placement → invoice, config activation/rollback, pipeline stage requirements, configured public application validation, offer → onboarding, required custom job fields, audit viewing, and restricted employee bootstrap.
- `node --test server/src/platform/workflows.test.js`: 8/8 passed; configured stage transitions and requirements, sequential/parallel/threshold approvals and delegation, scorecard locks, idempotent hire and offer onboarding, agency placement/invoice/payment.
- `npm run test:platform`: 32/32 passed, including six shared schema tests, nine workflow unit tests and seventeen API acceptance assertions/subtests.
- After the final automation service integration, `npm run test:platform` was rerun at 36/36 passed. The legacy server suite was then rerun and exposed two automation unit regressions in `server/src/platform/automation.test.js` (template interpolation of nested record fields and configured stage-action execution); this is the exact safe resume point.
- The automation regressions were fixed. `npm --prefix server test` on 2026-09-24: 746 passed, 1 skipped, 0 failed. `npm run test:platform` now includes all `server/src/platform/*.test.js` and passed 50/50. These results precede the in-progress buyer-review fixes.
- After buyer-review fixes, `npm run test:platform`: 68 passed, 0 failed. `npm --prefix server test`: 759 passed, 1 existing skip, 0 failed. `npm run lint` and `npm run build` passed. The browser service connected but blocked `http://127.0.0.1:5173/platform` with `ERR_BLOCKED_BY_CLIENT`; browser acceptance still has not run. These checks cover new record-reference validation, privacy approval separation, invoice permissions/idempotency, audit record scope, public projection, linked authorization, module gating, stage history and reporting.
- With saved views, retention preview, invoice document, and atomic public application writes, the platform suite reached 93/93 passed. Independently generated corporate, agency, and startup workspaces each passed their copied 93-test platform suite, built with Vite, and booted from their own configuration/SQLite path. Corporate and startup returned 403 for clients; agency returned 200 and exposed a configured consultant user. Only the three temporary acceptance output packages were removed afterward; existing generated customer-named artifacts were not changed.
- Safe checkpoint on 2026-09-24 at user request: `npm run test:platform` 111/111 passed; `npm --prefix server test` 789 passed, one existing skip, zero failed; `npm run lint` passed; `npm run build` passed. The API now has a guarded manual automation run and a named report catalog. The onboarding checklist and referral services have focused tests but are **not yet wired into the operational routes/UI**. Agency UI edits were handed off with their own passing build/lint check. Browser testing remains blocked by browser localhost access.
- `npm --prefix server test`: 732/733 passed with one existing OCR-related skip; zero failures.
- `node --check builder/generate.mjs`, `node --check builder/server.mjs`, `node --check server/src/platform/index.js`, `node --check server/src/platform/workflows.js`: all syntax checks passed.
- `PLATFORM_MODE=true LOCAL_DEMO_MODE=true ATS_PLATFORM_DB=/tmp/ats-server-smoke.sqlite PORT=4143 node server/server.js` (same-process HTTP smoke): `/api/health` returned 200 platform-local and `/api/platform/bootstrap` returned 200 schema version 2.
- `npm run build`: passed after operational UI and CSS integration. `npm run lint` initially found three errors in the newly added builder/platform UI; fixes are in progress.
- Three independently generated schema-v2 workspaces booted with isolated SQLite files. Corporate/client=403, agency/client=200, startup/client=403. Vite production build passed for each; temporary verification artifacts are being removed.
- `PORT=4144 ATS_BUILDER_PORT=4188 ATS_PLATFORM_DB=/tmp/ats-platform-local-smoke.sqlite npm run local` in one HTTP smoke returned 200 from API health, builder root and Vite `/platform`.
- Settings isolated API smoke: config GET 200, draft PUT 200, activation 200/version 2, history 200. Builder from localhost Vite origin: validate 200/valid, generate 201, archive 200/gzip. The temporary generated smoke files were removed by the workstream owner.
- Browser automation has **not** run: the available Chrome and headless shell binaries are truncated and crash; Playwright download produced an invalid archive in this environment. A browser test harness is being prepared and cannot substitute for actual navigation.

These checkpoints are partial and do not establish whole-product completion. The operational frontend, generator startup checks, agency flow and wider module workflows are still in integration.
