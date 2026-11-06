# Builder foundation: session, variable and connection contracts

Scope: builder development on the customized deployment branch. **CONFIRMED** below means
source + named tests, not that production has been upgraded. Integrations gallery
accounts, payment execution and interactive catalogues remain
later-phase work; none is advertised as working by these contracts.

## Execution identity — reuse the current runtime

The current session is `followup_enrollments`, not a second competing bot runner.
Its identity is `(organization_id, id)` with a pinned `version_id`, `pointer_id`,
`contact_id`, current node and service boundary. The boundary binds organization,
contact, conversation, service revision and optional case/revision. A phone number
alone is never an execution identity. Enrollment rejects a supplied boundary for
another organization/contact. Source: `enroll.ts`, `atendimento/fronteira.ts`.

Every event read carries both enrollment and organization IDs (Supabase + PostgreSQL
adapters). Global queue claiming is intentional; subsequent reads/writes are scoped.
The worker verifies the current boundary and conversation/channel before sending.
Draft edits do not mutate a published version or enroll a customer. Publication is
the existing atomic `fn_publish_followup_flow_version`, with a rollback pointer.

| Existing state/event | Contract |
| --- | --- |
| `active` | Evaluate the pinned node; time-based waits retain the same enrollment. |
| `waiting_reply` | Consume the existing inbound-event bridge or take the explicit timeout branch. |
| `paused_handoff` | Preserve progress; the configured existing handoff policy controls continuation. |
| `completed` / `cancelled` / `dead` | Terminal result, cancellation or visible failure; do not treat a delivery failure as success. |
| Duplicate event/job | Existing idempotency key / send ledger prevents a second logical action. |

**Known existing debt:** `followup-reactivity.test.ts` records an expected failure:
STOP does not immediately cancel an enrollment already `paused_manual`. The outbound
opt-out guard still applies. This increment does not claim that debt is solved.

## Variables and answers — supported contract, not an invented new database

Current graph readers accept existing v1/v2 branch representations. Stable branch
IDs are independent of their displayed labels. New media is an additional action
mode, not a rewrite of existing nodes. Existing `match_reply` configuration remains:

| Field | Meaning / validation |
| --- | --- |
| `save_to.kind=contact_name` | Explicit mapping to this enrollment's contact name. |
| `save_to.kind=lead_custom` | Explicit mapping to a validated custom-field key on this contact's latest lead. |
| `save_to.key` | Existing 1–60-character key syntax; `{{volta}}` resolves from this enrollment's scoped repeat events. |
| `if_exists` | Existing `skip`, `overwrite`, `confirm` behavior; absent retains the legacy overwrite behavior. |
| answer value | Trimmed text, maximum 2,000 characters; empty answers do not write. |
| loop values | Existing `{{volta}}` / `{{voltas}}`, resolved within the pinned execution. |

Both persistence adapters now revalidate destinations at the write boundary. Both
filter organization and contact; PostgreSQL's outer update also has an explicit
organization filter. Supabase diagnostics are not exposed as answer values/log text.
Tests: `persistir-resposta.test.ts`, graph schema, enrollment and reactivity suites.

Phase 4/5 extension, implemented locally: typed string/number/boolean variables
live in `followup_enrollments.variables`. The migration 0265 triplet adds an atomic
server-only set-and-advance function guarded by organization, service boundary,
revision, current node and connected next node. Session variables are not shared
with another enrollment. Session answer destinations require a validated format.
Email/phone/date/number/file question formats have explicit invalid-answer paths.
File answers store `attachment:<message UUID>`, not a client-supplied URL.

Formulas are a bounded expression tree, without eval, environment access or arbitrary
property access. The condition editor supports typed comparisons. Text messages,
interactive bodies and media captions support explicit `{{session.name}}` references;
missing values and oversized expansion fail closed. Expansion is single-pass and
does not reinterpret customer content. Internal attachment references cannot become
outgoing text. AI prompts and saved-message templates do not use this interpolation.
Variable-step timeline events contain the key/type only, never the value. Bounds:
50 variables, 2,000 characters per string, 32 KiB database state.
Evidence: `expression.test.ts`, `render-session-text.test.ts`,
`tests/invariants/followup-variables.test.ts`. Full release verification is pending.

## Files — real consumers in Phase 3

`action.mode=media` stores immutable references and metadata only:
`<org>/flow-media/<flow>/<asset>.<ext>`. It never stores provider credentials or
preview URLs. Upload requires manager authority + support-write permission;
preview requires viewer authority + flow ownership. Both resolve the organization
from authentication and filter flow ownership before touching service-role storage.
Draft save and publication reject cross-flow or cross-organization references.

The private `whatsapp-media` bucket already exists; no new RLS table is introduced.
There is no authenticated bucket policy granting direct access to these objects:
server routes perform authorization before short-lived signing. The media sender
checks asset ownership and conversation ownership, validates downloaded bytes,
materializes into a conversation-owned path and reuses the canonical message sink.
Per-file ledger identities survive worker retry and sending-window deferral.
Uploading/removing a draft reference does not delete a published version's media.

Limits are application limits: JPEG/PNG 5 MB, MP4/MP3/OGG 16 MB, PDF 50 MB;
multiple-image blocks have at most ten files delivered individually. Codec
requirements remain explicit in the editor. Magic-byte checks are **not malware
scanning or full codec validation**. Unreferenced immutable uploads currently follow
the bucket's existing retention; automated orphan cleanup is not implemented.

## Connections and OAuth — reuse evidence and gate future integrations

CONFIRMED: AI credential loader filters ID + organization before decrypting, checks
ownership defensively and returns controlled errors. Credential API uses explicit
safe columns, not encrypted or plaintext keys. Google Calendar OAuth binds a signed
organization/user/nonce/expiry to the browser; callback validates the binding,
support-session authority and consumes the nonce before exchange and encrypted
upsert. Existing callback tests cover replay, foreign browser binding and failure.

This is **not** a generic OAuth framework. The later integrations phase must add
organization-owned connections with safe public projections, encrypted server-only
secrets bound to organization + connection, current role checks at callback time,
provider-bound state and one-time nonce, rotation/disconnect, and queued-job checks
for ownership and revocation. Webhooks derive ownership from the verified connection,
not a caller-supplied organization field. Formulas/goals/triggers remain builder
features, not pretend external integrations. Do not enable a gallery tile until
its actual authorization, executor, failure history and isolation tests exist.

## Compatibility and rollout

Deploying media-capable web code without a media-capable worker would be unsafe.
Older workers must not execute media jobs as AI replies. Upgrade and verify the
worker before enabling publication of media flows; retain the existing deployment's
Meta session-credential fix. No customer flows are automatically published or tested.
Verification evidence and remaining gates are recorded in `bot-builder-phase-1.md`.
