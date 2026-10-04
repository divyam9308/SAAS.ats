# SAAS.ats product audit and implementation — 2026-10-04

The local Builder and configured ATS received an integrated audit, implementation and UI upgrade. The reviewed corporate and agency workflows operate through real browser forms and persisted records. Five distinct generated presets install, build, test and retain isolated data. This is suitable for evaluating the documented local pilot workflows; it is not a hosted SaaS launch or proof that every original customization is commercially complete.

The audit began on 2026-10-04 and final verification/delivery continued on 2026-10-05 in Asia/Kolkata (still 2026-10-04 UTC).

Repository: `https://github.com/divyam9308/SAAS.ats`, branch `main`. Work began after a clean fast-forward to `38722eec694453a7dd18fbd1e69b283e9dd663fb` in `/Users/divyamaggarwal/Desktop/files/ATS PUBLIC VERSION/SAAS.ats`. The user explicitly authorized logical commits and a push for this task. The original `divyam9308/fyndbridge-ats` repository was not modified. SQLite, local documents, mock identity and mock integrations remain the intentional runtime.

## Product and architecture findings

The three product layers remain separate: shared UI/API/workflow code, validated company configuration, and operational SQLite/document data. `shared/ats-config.cjs` is the schemaV2 contract used by Builder, generator and configuration activation. Generated workspaces have their own config/database/document paths and `seedDemo:false`; company variation is configuration, not customer-specific source branches.

The existing product already had substantial workflow, data administration, reporting, agency and privacy services. This pass addressed broken configuration-to-runtime paths and usability gaps instead of treating stored schema fields as feature completion. [CONFIGURATION_TRACEABILITY_2026-10-04.md](CONFIGURATION_TRACEABILITY_2026-10-04.md) maps all 50 buyer areas to controls, configuration, consumers, evidence and limits.

| Finding | Change and resulting behavior |
| --- | --- |
| Visiting/editing the guided workflow could replace pipeline identities, other pipelines and approval references | Stable stage cards, selected-pipeline editing, explicit moves and role/entry rules now preserve IDs, other pipelines and thresholds. Reordering leaves edges intact; removal prunes incident edges. |
| A “none” approval choice could still fall back to an existing workflow | Explicit disabled policy references disable fallback. Requests without effective approval can create a job; configured approval paths and wrong-module rejection remain enforced. Module/global administrator roles are eligible approvers. |
| Settings collection edits could create numeric wrapper keys rather than edit the chosen row | Collection path updates now target the actual item. Dedicated pipeline, approval, application-form and scorecard editors replace generic controls for those domains. Legacy nested conditions and object choices retain their shape. |
| Browser and API application visibility could disagree | A shared typed condition evaluator governs visible questions, validation, persisted answers, uploads and knockout rules. Hidden answers are dropped. Required identity/consent and a single upload are validated before activation. |
| Configured interview assessment selection, labels and optional fields could differ across forms and API | Both feedback surfaces follow effective scorecard selection, actual rating bounds/labels, interviewer criteria and required-field policy. Job assessment IDs are projected without private job details. Submitted numeric answers, weighted scoring and locks are verified. |
| Removing every pipeline edge left sequential fallback open | An explicit empty graph now closes moves in both UI and API. Legacy configurations with no graph retain sequential behavior. Client and placement stage requirements inspect actual active linked records. |
| Document version/download visibility did not consistently match ownership and readable parent policy | Shared document access enforces team/public parent scope and additional owner/admin restrictions for private/restricted documents. Version metadata and exact downloaded bytes have negative authorization coverage. |
| Non-admin runtime forms lacked configured source/document/task/decision choices | Bootstrap projects an allowlist of authorized runtime definitions without integration secrets. Rejection/withdrawal categories are validated before writes and persisted with audit history; optional category clearing remains valid. |
| Bootstrap totals could ignore module-specific scope or disclose inaccessible module totals | Counts use module/permission and the same record predicate as list routes. Only an unrestricted administrator gets the aggregate fast path; saved-view privacy is still filtered. |
| Overview was not sufficiently oriented to real daily work | Corporate/agency summaries, shortcuts and an actionable scoped work queue now use stored approval/task/interview/submission/invoice data, with loading, retry, error and empty states. User switches discard obsolete queue results. Derived approval capabilities match API gates. |
| Forms/drawers were visually dense; mobile menus/focus and tablet overflow had defects | Required/additional form groups, contact/workflow/terms drawer groups, tablet navigation, mobile sheets, sticky actions, topmost-dialog focus containment/restoration and current-page menu close behavior were added. The table contains its screen-reader labels within horizontal scrolling. |
| Dates/money and preview copy could bypass company policy | Date-only values do not shift calendar days across timezones; timestamps still convert. Money uses configured locale/currency. Builder careers preview uses the real presentation helpers and labels sample content explicitly. |
| Builder progress and imported configuration could be misleading/unusable | Progress counts actual reviewed steps, navigation validates, imports/advanced JSON migrate and validate before adoption, async failures surface, disabled features render disabled, and local typography/spacing/focus styles improve readability. |

## Verification

Tests use synthetic records, isolated temporary databases and uniquely named generated outputs. The browser harness starts its own local API/UI/Builder. The recorded suites overlap, so their counts are not summed as a unique-test total.

| Command | Final result |
| --- | --- |
| `npm test` | 50 passed; 0 failed/skipped |
| `npm run test:platform` (also first stage of quality gate) | 309 passed; 0 failed/skipped |
| `npm --prefix server test` | 928 passed; 0 failed/skipped |
| `npm run lint` | Passed |
| `npm run build` | Passed; no emitted build warning |
| `npm run config:validate` | Default corporate schemaV2 valid |
| `npm audit --json` | 0 vulnerabilities, including development dependencies |
| `npm --prefix server audit --json` | 0 vulnerabilities, including development dependencies |
| `npm run test:generated` | Five presets × 326 passed tests (0 failed/skipped each); 10 clean installs, 5 builds, 11 API starts, 181 runtime/backup assertions and 15 backup CLI commands |
| `npm run test:quality` | Passed: 309 platform tests, local performance/30-second soak, and 28 real browser checks in each of Chromium, Firefox and WebKit |
| `git diff --check` | Passed |

Environment: Apple Silicon macOS, Node 26.4.0, npm 11.17.0, Vite 8.3.2 and Playwright 1.63.0. Browser results: chromium 153.0.8010.12, firefox 155.0, webkit 26.6; 28 checks passed per engine (84 engine/check executions), no captured page/console errors.

Performance results: 20,000 candidates; list 148.1 ms; 60 concurrent reads p95 47.5 ms; 60 concurrent writes p95 33.9 ms; 30-second soak with 26,360 requests, p99 15.4 ms and memory growth 144.7 MB. These are local synthetic measurements, with their test's bounded workload and assertions, not a production capacity or leak-free endurance guarantee. `npm run test:soak` remains available for a separate five-minute soak; the final quality gate uses 30 seconds.

The generated matrix covers corporate, agency, startup, campus and basic. It checks preset identity, mode, terminology, modules, pipelines, roles/users, forms, initially empty data, denied interviewer creation and seven module routes. Each workspace retains its own unique candidate after a restart and contains none of the other four markers. Backup/restore checks compare all offline stored records and the restored unique candidate; dashboard totals are intentionally permission/module filtered. Corporate/campus use corporate mode; startup/basic use startup mode; agency retains its distinct operational mode.

Actual browser coverage includes:

- Builder immediate preview, validated Apply, package generation, and regeneration preserving an existing candidate/document.
- Settings dirty navigation cancellation, saved draft reload, stage rename through domain controls with ID/edge preservation, review acknowledgment, activation and confirmed rollback.
- Public careers detail/form, configured branding/copy, consent/resume submission and internal exact-byte download/replacement.
- Corporate request → approvers → published job → public applicant → stage move → interview → scorecard → offer approvals → acceptance/onboarding, plus tasks, notifications and persisted audit.
- Application rejection with a configured category and withdrawal after choosing then clearing an optional category, with stored outcome and audit verification.
- Agency client/contract/mandate → submission → placement → invoice/payment tracking → guarantee review/replacement.
- Mock-role navigation/service denial, restricted-route reload, all five presets' module navigation, captured console/page-error gate.
- 1440×960, 1280×900, 768×1024 and 390×844: Builder, ATS list/drawer/action modal and Careers, overflow checks, keyboard Tab/Shift+Tab containment, Escape and restored focus. macOS WebKit uses its native Option+Tab / Option+Shift+Tab traversal to include buttons; the reachability and containment assertions remain the same.
- Representative WCAG 2/2.1 A/AA axe scans on Builder, overview, careers/application and Settings pipeline/form/approval/scorecard surfaces; no critical or serious violations on those scanned states. This is not an exhaustive accessibility certification.

Root independently inspected desktop/tablet/mobile screenshots, including Builder, candidate list/drawer and action sheet, and reviewed the component changes against the React checklist. Retained per-engine screenshots and logs are under ignored `.browser/product-audit-20261004/`. They are local review artifacts, not tracked customer data.

Navigation-aborted requests are logged separately; final acceptance requires no captured page or console errors.

Failures during verification were fixed and rerun: Settings contrast and primary text overrides; the scorecard harness's old input interaction; current-page menu close; a positioned screen-reader table label causing tablet overflow; disabled approval requests in the work queue; Builder favicon loading; WebKit keyboard traversal using the observed native modifier; and a backup test that incorrectly treated permission-filtered totals as full database counts. Assertions were updated to match the supported interaction while preserving persistence/authorization checks.

## Delegation and independent acceptance

| Workstream | Actual assigned native model | Ownership / root acceptance |
| --- | --- | --- |
| Buyer audit and domain editors | Luna Medium (`gpt-6-luna`, medium) | Settings and editor helpers/tests; root reviewed diffs and extended legacy/identity/consent/scorecard handling and contrast. |
| Runtime audit and UI | Luna Medium (`gpt-6-luna`, medium) | Platform forms/drawers/overview/regional formats; root reviewed integration, queue races/gates, focus, responsive behavior and backend parity. |
| Backend configuration audit | Luna Medium (`gpt-6-luna`, medium) | Public condition handling, document policy and decision taxonomy; root reviewed permissions, transactions and generator copies, added scope counts and assessment projection. |
| Safety review | Luna Medium (`gpt-6-luna`, medium) | Read-only security/workflow review; root implemented and tested approval/stage requirement corrections. |
| Preset/browser matrix | Luna Low (`gpt-6-luna`, low) | Five-preset generation, isolation and UI coverage; root reviewed harness changes, strengthened feedback/decision/backup assertions and ran real engines. |
| Configuration traceability | Luna Low (`gpt-6-luna`, low) | Initial source trace; root replaced the final document with the complete 50-area evidence/limit inventory after integration. |

No Ollama-backed or substitute models were used. The requested native Sol 6.1 Max root selection could not be changed from the already-running root session; this limitation was disclosed at the start. Root retained architecture, integration, security review, conflict resolution and final acceptance responsibility. Subagent completion messages were not treated as verification, and no agents edited overlapping owned files concurrently.

## Remaining product boundaries

The following limitations are explicit, rather than represented as working features by configuration exposure:

- Some advanced administration still uses schema/general collection editors, including automations, organizational hierarchies, communications, interview plans and job templates. Dedicated business editors exist for pipelines, approvals, forms and scorecards.
- Stored tags/skills taxonomy catalogs and legacy taxonomy sources have no traced operational consumer. Top-level sources and canonical document categories do. Complete job-template reuse is not demonstrated by schema/bootstrap exposure.
- The Builder preview represents selected configured screens with labelled sample data. It is not an exact live rendering of every runtime surface.
- Public application transport supports one upload question and canonical visible full-name/email identity. Additional internal documents use document management.
- Complete UI translation, workload-balancing assignment, a general report designer and full mentions/chat are not implemented.
- Browser engine coverage is not native Safari/iOS/Android hardware certification or every action × role × configuration combination. Load evidence is local and bounded; larger datasets, every restricted-user performance path and long endurance runs need separate validation.
- Production authentication/SSO, tenant control plane, hosted storage/backup/observability, live integrations, subscription billing and commercial/legal readiness are outside the authorized local phase. Production mode fails closed without a real authentication adapter.

## Local operation and delivery

```bash
npm run setup
npm run local
# Builder: http://127.0.0.1:4177
# ATS:     http://127.0.0.1:5173/platform
# Careers: http://127.0.0.1:5173/careers-platform

npx playwright install chromium firefox webkit
npm run test:quality
npm run test:generated
```

Generated workspace commands and offline backup/restore safeguards are documented in [SAAS_ATS_BUILDER.md](SAAS_ATS_BUILDER.md) and [LOCAL_BACKUP_RESTORE.md](LOCAL_BACKUP_RESTORE.md).

Delivery commits and the verified pushed HEAD are listed in the task's final response and can be checked with `git log` / `git ls-remote origin refs/heads/main`. Build timestamps, dependencies, databases, uploaded files, generated packages and browser artifacts are excluded from the source commits.
