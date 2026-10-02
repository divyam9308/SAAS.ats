# ATS readiness checkpoint — 2026-10-02

Paused because the user asked to stop at a safe checkpoint. All subagents have stopped. No commit or push was made. Changes are in the cloud Git checkout `/workspace/SAAS.ats`, remote `https://github.com/divyam9308/SAAS.ats.git`, branch `main`, base commit `c65d2c899d9684175225bfe07c0972338fd2d753`. The user's Mac checkout was not accessible. The original Fyndbridge repository was never accessed or modified.

## What is saved

- Settings dirty-navigation and unload protection, preset/module/rollback confirmations, readable item-level configuration diff and review acknowledgment.
- Server-side configuration validation and transactional activation/rollback, with optimistic draft/version conflict checks.
- Careers allowlisted company presentation even without published jobs; configured logo, colours, copy, terminology, regional dates/salary; safe asset URL handling. SLA dates use company regional settings.
- Offline SQLite/document backup, manifest validation, preview and rollback-safe restore. Runtime locks prevent cooperating servers from racing restore or regeneration. Node.js 22.13+ required; 24 recommended.
- Reproducible generated lockfiles, atomic regeneration, preserved customer data, code-only archives, shipped backup tools and validated local branding assets.
- Browser-discovered fixes: list-page initialization crash; restricted-user route/request loops; unavailable report requests; asynchronous upload form reset; optional empty create fields; disabled external SpeedInsights requests in local platform mode; public resumes visible in candidate document drawers.
- Real Chromium acceptance harness; isolated corporate/agency/startup generation matrix; regression tests. Browser extensions described below are unfinished verification work.

## Verification evidence

| Command/check | Observed result | Freshness |
| --- | --- | --- |
| `npm run test:platform` | 264 passed, 0 failed | Latest full platform run at this checkpoint |
| `npm --prefix server test` | 905 passed, 0 failed, 0 skipped | Latest full server run |
| `npm test` | 30 passed, 0 failed | Before final credential-URL assertion and label polish |
| `node --test builder/generation-safety.test.cjs builder/builder-ui.test.cjs` | 12 passed | Includes generator asset and lock safety |
| `npm run lint` | Passed earlier integrated run | Checkpoint rerun recorded separately in handoff bundle |
| `npm run build` | Passed earlier readiness run | Rerun on final integrated tree remains required |
| Root/server `npm audit --omit=dev` | Both 0 vulnerabilities earlier | Final rerun remains required |
| `npm run test:generated` | 3 presets; 6 installs; 3 builds; 3 test runs; 4 API starts; 31 assertions; 9 backup CLI commands passed | Before last branding/engine/label edits; rerun required |
| Core browser harness | 14 checks passed, no captured runtime/console errors | Before integrating extended agency helper |
| Latest extended browser run | Failed at agency test selector after mandate creation | Full browser gate NOT passed |
| Browser helper syntax checks and `git diff --check` | Passed | Checkpoint checks |

Logs were captured in `/tmp/ats-final-platform.log`, `/tmp/ats-final-server.log`, `/tmp/ats-final-root.log`, `/tmp/ats-matrix.log`, `/tmp/ats-build.log`, `/tmp/ats-browser.log`, and `/tmp/ats-checkpoint-lint.log`. These paths are transient; the downloaded handoff bundle contains the relevant log tails.

Core browser coverage already exercised: mock entry/dashboard; Builder live preview, generation and Apply; unsaved navigation cancellation; saved draft/reload; activation diff/acknowledgment; version rollback; careers job/form; public application with consent and resume; persisted answers free of resume bytes; resume/attachment downloads with byte comparisons; replacement version; reports/tasks/notifications/audit navigation; interviewer negative authorization; restricted route reload; module dependency/preset confirmations; terminology/careers copy activation; agency client creation/navigation; mobile menu and careers overflow.

## Exact resume sequence

1. Verify `pwd`, Git branch/status/remote and HEAD before editing. Read this file and `PROJECT_CONTEXT_FOR_VSCODE.md`. Preserve unrelated user changes. Do not commit/push unless asked.
2. Review `scripts/browser-corporate-flows.mjs` (native Luna medium). It exports `verifyCorporateWorkflow({page, api, check})` but is not imported/called by the main harness. It covers recruitment, interview, feedback, offer and onboarding UI actions. Correct offer row selection: an ID is not visible table text. Remove unused `detail`. Tasks/notifications currently only read surfaces; assert specific generated records. Insert its call after the document check, before restricted-user checks and agency activation.
3. Fix `scripts/browser-agency-flows.mjs` (native Luna medium). Latest failure is `/Add submission/i` versus actual `Add candidate submission`; the Create button similarly uses configured terminology. Use scoped locators based on actual rendered text. Earlier ambiguous Client/Client-contact selection and a premature popup await have been corrected. Continue through submission, placement, invoice preview, guarantee claim/review; inspect every persisted assertion and wait for UI writes before querying APIs.
4. Run real Chromium acceptance. The agent-browser CLI is unavailable; cloud CUA blocks localhost. Working alternative is Playwright in the same process tree as the servers. `npm run test:browser` starts its own isolated API/Vite/Builder and cleans its own temporary database/packages. On this cloud runtime: `ATS_BROWSER_EXECUTABLE=/tmp/ats-chromium npm run test:browser`. The `/tmp/ats-chromium` binary was unpacked from the official npm `@sparticuz/chromium` package; it may disappear between sessions. On the Mac: `npx playwright install chromium`, then `npm run test:browser`. Do not use API smoke tests as browser evidence. Individual shell executions have separate local network namespaces; server and Playwright must share the harness process tree.
5. Fix product issues discovered by the new flows and add regression tests. In particular inspect remaining unauthorized dashboard refreshes after restricted-user actions; two create/action refreshes now pass current bootstrap to the permission guard.
6. Final gates: `npm run test:platform`, `npm test`, `npm --prefix server test`, `npm run lint`, `npm run build`, `npm audit --omit=dev`, `npm --prefix server audit --omit=dev`, `npm run test:generated`, and complete real browser acceptance. The matrix installs dependencies only in its uniquely named generated workspaces; do not run root `npm ci` concurrently with browser tests.
7. Update README and `docs/SAAS_ATS_BUILDER.md`: current browser-pending statements are stale; document settings safeguards, backup commands and generated `seedDemo:false` behavior without claiming the final gate passed. Update acceptance results only from completed checks. Restore incidental `public/version.json` build timestamp changes to HEAD before packaging; it is already restored at this checkpoint.
8. Repeat privacy/security artifact review. Earlier inspection found no tracked databases/uploads/output artifacts or credential patterns. Two old live deployment URL examples were replaced with localhost. Synthetic provider URLs in tests are fixtures, not credentials. Production auth still intentionally fails closed without a real adapter. EICAR detection is a local test scanner, not a production antivirus service.

## Workstream ownership and models

- Settings: `settings_luna_medium` — native `gpt-6-luna`, medium.
- Careers presentation: `careers_luna_low` — native `gpt-6-luna`, low.
- Backup/restore: `backup_luna_medium` — native `gpt-6-luna`, medium.
- Generation safety: `generator_luna_medium` — native `gpt-6-luna`, medium.
- Generated matrix: `matrix_luna_low` — native `gpt-6-luna`, low.
- Agency browser helper: `agency_browser_luna_medium` — native `gpt-6-luna`, medium.
- Corporate browser helper: `corporate_browser_luna_medium` — native `gpt-6-luna`, medium.

Root reviewed/integrated implementations and ran the checks. The two extended browser helpers are not accepted merely because their agents delivered files. Use non-overlapping ownership on resume, native Luna only; report unavailability rather than silently substituting another model or Ollama.

## Scope and remaining limitations

Current progress estimate was 94% of this local readiness pass; it is not measured coverage of all 50 buyer areas or hosted SaaS readiness. Extended browser acceptance, final integrated verification and documentation remain. Current product remains isolated localhost per-company SQLite and local documents with clearly labelled mock users/outbox/calendar. Real auth, paid integrations, production malware scanning, hosted multi-tenant control plane, provisioning/billing/fleet backups and deployment are outside the authorized phase. No legal-compliance, load-testing or independent penetration-test claims.

## Start commands

Factory: `npm run setup`, then `npm run local`. Builder `http://127.0.0.1:4177`; ATS `http://127.0.0.1:5173/platform`; careers `/careers-platform`.

Generated customer: `cd generated/<slug>/workspace`, `npm run setup`, `npm run local`. For backup instructions read `docs/LOCAL_BACKUP_RESTORE.md`; stop the ATS first. Restores require explicit `--confirm` and retain pre-restore data. No Supabase, Vercel, real OAuth or paid provider is required.
