# Visual bot builder — Phases 1–3 delivery record

Status: **implemented locally; release gates remain**, not deployed. Audited 2026-09-17 against
`codex/live-visual-builder` at `a8b68388` plus the working changes described below.
This is the customized deployment branch, not a claim about upstream or live state.

## Scope

Establish a compatible, tenant-isolated foundation for the visual conversation
builder and integrations gallery. Do not enable new customer-facing automations,
replace published graphs, migrate customer records, or connect provider accounts
as part of this initial audit. The pre-existing uncommitted canvas-delete work
is separate from this phase.

## Confirmed by source inspection

| Area | Existing source | Reuse / limitation |
| --- | --- | --- |
| Drafts and publication | `lib/followup/api-schemas.ts`, `publish.ts`, `rascunho.ts` | Draft graph and active immutable-version pointer already exist; do not create another independent publishing system. |
| Builder access | `app/api/v1/ai/followup-flows/[id]/route.ts` | Viewer read; manager write/delete; organization comes from `requireRole`, queries filter it explicitly. |
| Graph compatibility | `lib/followup/graph-schema.ts` | Stable branch IDs coexist with legacy conditions; additions must retain parsing/routing of existing graphs. |
| Enrollment | `lib/followup/enroll.ts` | Reads pointer, contact and version with organization filters; captures service boundary and version. This is a scheduled-follow-up enrollment, not yet a general typed-answer session. |
| Execution | `lib/followup/engine.ts` | Global queue claim is intentional; jobs carry organization context. Each subsequent read/write must preserve it. |
| AI credentials | `lib/ai/credentials.ts`, `lib/crypto/aes_gcm.ts` | AES-GCM ciphertext and just-in-time decryption exist. The loader previously filtered ID only, then checked ownership before decrypting. |
| Calendar OAuth precedent | `app/api/v1/agenda/google/callback/route.ts` | Signed state, browser binding and consumed nonce precede token exchange. A generic connection framework must not omit these protections. |
| Conversation uploads | `app/api/v1/conversations/[id]/media/route.ts` | Validates conversation ownership and prefixes storage path with organization. Builder assets cannot simply use an arbitrary customer's conversation as an upload container. |

These are scoped observations, **not** a completed security audit of every route,
provider, worker or storage policy.

## First implemented hardening

`loadCredential` now filters by both credential ID and trusted organization before
fetching encrypted values. Its defensive post-read ownership check remains.
Database and decryption diagnostics are replaced with controlled error text so
unknown driver errors cannot propagate secrets to callers. Existing typed failure
reasons are preserved. No schema change or key re-encryption is required.

`lib/ai/credentials.test.ts` covers own-organization success, foreign-organization
refusal, a backend returning an unexpected foreign row, inactive/unvalidated
credentials, and diagnostic redaction. Four tests failed before the hardening.
This finding is not evidence that a foreign key was previously decrypted or leaked.

## Foundation contract and scope

The implemented consumers and the future-only contracts are separated in
[`bot-builder-session-contract.md`](bot-builder-session-contract.md). In particular,
the current follow-up enrollment and mapped text answers are reused and hardened;
arbitrary typed question variables and generic OAuth connectors are later phases,
not unused scaffolding counted as completed functionality.

### Identity and permissions

- Resolve organization and actor at the authenticated entry point, never from a
  caller-supplied organization field. Preserve canonical `getUser`/`requireRole`.
- Pass that context through execution; reject cross-organization references before
  decrypting, signing a download URL, dispatching a job, or calling a provider.
- Preserve existing viewer/manager builder permissions. Connection management must
  receive an explicit permission policy before its endpoints are introduced; do
  not assume every builder editor may read or change account credentials.

### Session, answers and versions

- Pin every running conversation to its published flow version. Draft edits do
  not alter an in-flight session. Publishing never silently enrolls customers.
- Bind session identity to organization, conversation, channel and service
  boundary. Do not model sessions solely by phone number or contact ID.
- Define versioned, validated variable declarations (type, required, destination)
  and session-local answer values. CRM field writes require explicit mapping and
  authorization. No plaintext API keys in graphs, answers or event payloads.
- Define waiting-for-input, timeout, human-paused, completion and failure transitions
  before adding question nodes. Deduplicate inbound events and outgoing actions.
- Keep existing follow-up behavior unchanged; specify how interactive input and
  follow-up cancellation/continuation coordinate before wiring the two runtimes.

### Connections, files and OAuth

- Graphs reference organization-owned connection/asset IDs, not credentials or
  temporary signed URLs. Public connection responses are explicit safe projections.
- Generic secrets must use authenticated encryption bound to organization and
  connection identity; use a versioned envelope for future key rotation. Existing
  credential formats are not silently rewritten by this phase.
- OAuth state binds organization, actor, provider, expiry and single-use nonce;
  validate browser/session binding and current authority before exchanging a code.
- Webhook routing derives organization from a verified connection/signature, not
  an untrusted JSON field. Jobs recheck connection ownership/status on execution.
- File references must be tenant-owned and authorized on upload, read, replacement
  and deletion. Signing a URL is a privileged operation, not an ownership check.
- Disconnect must prevent queued actions from using revoked credentials. Generic
  connectors must not fall back to another organization's account.

### Observability and rollback

- Record actor, organization, flow version, node and controlled result/error codes;
  exclude credentials and raw provider responses. Execution history will consume
  these events in the later builder phases.
- Every asynchronous action needs a retry/failure owner and visible terminal state.
- All schema changes require migration + idempotent baseline append + MANIFEST and
  real two-organization DB tests. No destructive replacement of legacy tables.

## Phase 1 acceptance evidence

- [x] Initial source inventory and first credential hardening.
- [x] Focused existing flow API/schema/enrollment compatibility tests.
- [x] Fresh baseline install and repeat-apply check in disposable PostgreSQL.
- [x] Scoped review of worker event reads, private storage, AI secret projections
  and Google OAuth callbacks. Event adapters now filter organization explicitly.
- [x] Specify session/variable/connection contracts; validate existing mapped-answer
  destinations at both write adapters, bind enrollment boundaries to organization
  and contact, and enforce real media-reference ownership at save/publish/send.
- [x] Relevant two-organization DB invariants and RBAC tests pass. No new tables,
  foreign keys or storage policies were introduced, so no migration is required.
- [x] Credential loader diagnostic redaction and explicit safe API projections
  reviewed; new media graphs and audit payloads contain no credentials. This is
  scoped evidence, not a guarantee about every future connector.
- [x] Run relevant security/regression suites and repository-wide unit tests;
  record failures separately rather than treating a partial green as a release.
- [ ] Approve compatibility evidence before proceeding to customer-facing rollout.

## Phase 2 — visual workspace

Implemented: searchable Messages/Media/Logic/Template library with related icons,
click/drag creation, connected ready-made starter flows, node settings/previews,
duplicate, confirmed draft deletion, undo/redo, unsaved-change warning and English
save feedback. Newly added/duplicated nodes are brought into view. Existing graph
edges, branch IDs, publication/versioning and rollback are retained.

The local visual harness uses the actual `FlowCanvas` with synthetic API responses.
Desktop and 390 × 844 mobile checks exercised creation, settings, duplicate,
delete confirmation, undo/redo and search. Mobile document width equalled viewport
width (390 pixels), with no horizontal page overflow. This is **component-level
visual proof**, not authenticated production E2E or provider delivery proof.

## Phase 3 — media blocks

Implemented: single image, up to ten ordered images, MP4 video, MP3/OGG audio and
PDF blocks; file picker, progress, safe error state, preview, captions, ordering
and removal of draft references. Empty media blocks cannot publish. Upload and
preview require organization/flow ownership; draft save/publish reject foreign
references. Worker uses the canonical channel sink, with guarded per-file ledger
identities, audio text sent separately, and same-job retry after window deferral.

Tests cover MIME/size/content checks, foreign organizations/flows/conversations,
role/support restrictions, partial upload failure, ordered sending, replay skips,
handoff, failed delivery and deferred albums. Interactive product carousels,
arbitrary file formats, full codec validation, malware scanning and orphan-file
garbage collection are **not** included or advertised as working.

Release requires a coordinated worker/web upgrade (worker first), preserving the
deployed Meta session-credential fix, followed by authenticated upload/save/reload
and a controlled WhatsApp test. No customer flow is published automatically.

## Living-system check for this increment

Input: trusted organization plus credential ID from `lib/ai/runtime/agent.ts`.
Output: authorized in-memory key or controlled `CredentialUnavailableError`.
Audit: no new mutation; credential reads must not emit secret-bearing audit data.
UI/entry: existing agent runtime; no new screen in this increment.
Failure owner: existing caller handles the typed unavailable-credential result.
Configuration: existing AI credential settings; no new environment variable.
Continuity: no change to AI/human handoff or scheduled flows.
Feedback: failure tests prevent regression; no new autonomous learning behavior.
Architecture: existing runtime -> credential loader -> scoped storage/decryption;
this increment hardens that path rather than adding an independent subsystem.

## Verification recorded for the first increment

- `node node_modules/vitest/vitest.mjs run lib/ai/credentials.test.ts
  tests/api/followup-flows.test.ts lib/followup/graph-schema.test.ts
  lib/followup/enroll.test.ts`: **166 passed**, four files.
- Disposable `scripts/test-db.sh` runs covering `followup-schema`,
  `agent-no-credential`, `credenciais-de-ia-sao-lidas-por-manager` and
  `rbac-config-ia-canais`: **35 passed**, four files. Both runs applied the
  baseline successfully in install and update mode. Temporary containers removed
  by the runner. Permission-denied output in negative credential tests is expected.
- TypeScript `--noEmit`, targeted ESLint for the credential loader/test and
  `git diff --check`: passed.
- Before the fix, the new credential suite had exactly **4 failed / 3 passed**;
  after the fix all seven passed. No actual customer secrets used by these tests.
- Later checks: relevant event/answer/OAuth/service-boundary tests passed (63 tests),
  and disposable engine/reactivity/service-boundary DB suites passed (36 tests plus
  one existing expected failure for STOP during `paused_manual`).
- Production Next.js build, including TypeScript and route generation: passed.
- Media/schema/route/vocabulary checks: 57 passed; subsequent route hardening added
  a passing MIME prototype-key refusal test. Media editor/palette/answer tests:
  18 passed. Local desktop/mobile visual checks passed as scoped above.
- Fresh focused regression: **591 passed**, covering follow-up contracts/engine,
  flow API, media API/worker/editor, graph history, tenant boundaries, OAuth and
  translation/audit gates. Final streamed-body and multipart-request additions:
  **28 passed** across the affected API/editor/translation suites (overlapping,
  not an additional 28 unique regression cases).
- Final expanded run on unchanged code: **592 passed / 1 failed** out of 593.
  The one failure was the full-repository translation AST scan (16.5 seconds,
  above the suite's 15-second limit while the production build was running).
  Its isolated rerun passed all six translation tests in 7.7 seconds of test time.
  Thus every focused test passed, but not all in a single concurrent run.
- Final production rebuild after streamed-body protection and English copy fixes:
  passed, including TypeScript and all route/static-page generation. Missing local
  AI-key/branding-database warnings are not proof of live configuration health.
- Final changed-file ESLint with zero warnings and TypeScript `--noEmit`: passed.
- Repository-wide run: **8,235 passed / 269 failed**. That run overlapped development
  and is diagnostic, not a frozen-tree release verdict. The subsequent focused
  run above proves the changed behavior on a stable tree. Failures included
  legacy Portuguese-label expectations while committed `IDIOMA_PADRAO` is English,
  Windows/WSL shell assumptions, unchanged baseline drift, and a malformed existing
  `meta-waba-subscription.md` release fragment. Builder-specific audit, translation,
  media-preset and answer-persistence findings pass after correction. Not every
  repository-wide failure was classified or fixed; the global suite is not green.
- Authenticated E2E and real provider delivery have not run: `.env.e2e` and the
  seeded authentication fixture are absent. A shared local Supabase stack exists;
  it was not reset or seeded because its data belongs to the user. An isolated
  E2E stack or confirmed disposable test tenant is required for this release gate.
- Full database suite and production deployment have not run.
- Tool limitations: `graphify` unavailable; traced source references directly.
  Windows default `bash` unavailable; database tests ran with Git Bash instead.
- Working tree contains pre-existing canvas changes; no upstream merge attempted
  over that dirty customized deployment branch. No commit, push or live mutation
  performed for this increment.
