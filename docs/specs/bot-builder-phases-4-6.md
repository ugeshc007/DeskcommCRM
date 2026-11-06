# Bot builder — phases 4–6

Confirmed scope: the operator approved this sequence. This is an implementation
plan, not a claim that these capabilities are deployed. Earlier work and release
gaps are recorded in `bot-builder-phase-1.md`.

## Phase 4 — choices and validated questions

- Reuse the existing reply node, named outputs, enrollment engine and guarded
  message sink. Add explicit answer formats and an invalid-answer output before
  any answer is persisted. Keep existing published graphs compatible.
- Add question presets and visible configuration for text, name, email, number,
  international phone and ISO date. File answers need a separate authenticated
  inbound-media contract; never treat a customer URL as an uploaded file.
- Add native reply buttons and lists through channel capabilities, outbound
  schema, transport adapters and inbound selection normalization. Unsupported
  channels must not silently send a different interaction.
- Verify save/reload, invalid/valid/no-reply paths, stale selections, opt-out,
  handoff, delivery replay and cross-organization isolation.

## Phase 5 — logic and human continuity

- Extend the session contract with typed, bounded variables and explicit scope;
  configuration and runtime share the same schema.
- Add set-field, comparisons, safe formulas (no eval/JavaScript execution),
  keyword routing, reusable flow calls with bounded recursion, goals and scoring.
- Connect business hours, inactivity and human handoff to existing queues and
  service ownership. Supply context, pause automation, and provide an explicit
  resume path; never let a formula or integration bypass a send guard.
- Verify boundary values, cycles, retry/idempotency, missing data and handoff.

## Earlier delivery record — question increment (superseded by progress below)

Implemented locally: `answer_format` on `match_reply`; shared pure validator;
explicit `invalid_answer` output covered by publish validation; normalization before
the existing organization-scoped answer writer. No database schema change. Existing
graphs without the new field retain their behavior, including legacy branch names.

Six searchable, draggable question presets add a connected text prompt and reply
node. The operator chooses the save destination explicitly. Values remain strings
in the existing field contract; these are not yet typed session variables. Numbers
use a decimal point, phones require an international + prefix (format validation,
not proof the number exists), dates use YYYY-MM-DD. File answers are not included.

Living-system checklist: input is the enrollment's pinned graph and inbound body;
output is routing plus the existing scoped answer writer. Existing enrollment-step
events feed the dossie timeline without copying the answer into event payloads.
Configuration lives in `MatchReplyForm`, reached through the builder palette.
The no-reply branch handles timeout, invalid answers need a connected correction
or help path, and missing invalid paths fail closed rather than silently accepting.
Existing service-boundary/handoff checks remain in `engine.ts`; this increment does
not create a new handoff implementation. Operators repair the invalid route in the
draft, test and explicitly publish; no automatic learning or publication.
Architecture map: `followup-dossie.architecture.json` records engine → validation →
engine, with existing timeline consumers unchanged.

Still pending in phase 4: native reply buttons/lists, inbound file answers and
authenticated end-to-end/provider checks. Phase 5 and phase 6 are not implemented
by this increment. Nothing has been deployed or published to a customer flow.

Verification so far: 400 focused tests passed (question contracts, runtime,
publication, presets, palette, translation coverage and architecture map).
Disposable PostgreSQL engine/reactivity run: 22 passed plus one existing expected
failure; baseline install and repeat application both passed, container removed.
TypeScript and targeted ESLint passed. Local component-preview checks exercised
adding a connected email question, changing its format, showing all three output
paths and successful synthetic draft save. These checks do not prove authenticated
API persistence or live delivery; the preview intentionally uses synthetic state.

The production build passed before the final automatic-placement adjustment;
that adjustment was visually retested at 1440×900 (page width 1440, palette 288,
no page horizontal overflow). New pairs are placed below existing blocks rather
than overlapping them. Narrow-screen drawer and format selection were checked too.
A deliberate temporary bypass of email validation made two runtime tests fail;
after restoring validation, the question/runtime/palette rerun passed all 45 tests.
No sabotage remains in source. Earlier global-suite and authenticated-E2E gaps
listed in `bot-builder-phase-1.md` remain release blockers.

## Phase 6 — organization-isolated integrations

- Gallery plus real connection lifecycle: connect, test, rotate, disconnect,
  visible health and sanitized failure history. Not a gallery of pretend-ready
  connectors. Formulas/goals/triggers are builder features, not providers.
- Requested connector families: Google Sheets, Airtable, HubSpot, Salesforce,
  Calendly, Stripe, Slack, SendGrid/email, Mailchimp, Segment, Dialogflow,
  Facebook Messenger, WhatsApp Business, webhooks, n8n and Zapier. API Agent,
  Platform API and dynamic data need explicit operation contracts, not arbitrary
  privileged code execution. Existing channels are reused, not duplicate credentials.
- Separate provider adapters from flow actions. Each provider needs its own
  supported operations, authentication contract and verification before enabled.
- Credentials encrypted server-side; metadata-only browser responses. Bind OAuth
  state to initiating user, organization and provider, expire and consume once.
  Resolve organization from trusted auth, never from an untrusted request body.
- Scope database policies, file access, queue work, caches and webhook ownership.
  Re-check connection ownership and revocation at execution, not only flow save.
  Webhooks require verified signatures/replay protection; outgoing custom URLs
  require the existing SSRF defenses, bounded responses and redacted errors.
- Tests must demonstrate two organizations cannot access each other's credentials,
  connections, data, callbacks, execution histories or queued actions.

## Release gates

Typecheck, lint, relevant unit/API tests, disposable database invariants, production
build and authenticated frontend evidence. Real connector/WhatsApp checks need
test accounts and controlled recipients, not customer side effects. Coordinate
worker-before-web rollout; retain the existing session-credential fix. No automatic
deployment or publication of customer flows is authorized by this implementation plan.

## Current development record — 2026-09-17 (not deployed)

Phase 4 implementation now includes native buttons/lists, paired stable reply
routes and inbound file references. Interactive replies must quote the latest
outbound prompt in the same organization, conversation, enrollment and source node.
Unsupported transports reject native choices rather than silently downgrading.
File answers are references to ingested attachments, not malware-scan assertions.
Authenticated end-to-end/provider verification is still reserved for the final gate.

Phase 5 implemented: typed bounded session variables, atomic set-and-advance SQL,
validated answer-to-session mapping, safe formulas, typed comparisons, explicit
session substitution into fixed messages/captions, and business-hours conditions
using the existing timezone-aware schedule evaluator. Schedule configuration is
per block and does not change staff availability. Same-day intervals only;
overnight schedules require separate conditions. Existing inactivity and handoff
mechanisms remain in place, not replaced by a second runner.

Phase 5 remaining: reusable flow calls with bounded recursion, global keyword
interrupt routing, explicit goal/scoring consumers and dedicated human-handoff
blocks wired to service ownership/resumption. Generic variables alone do not mean
these product features are complete.

Phase 6 started with the existing webhook execution path: reject foreign event or
context organization, fail closed when a configured signing secret cannot decrypt,
validate DNS in the socket lookup (preserving TLS hostname), reject URL credentials,
bound request payload, do not follow redirects/read response bodies, and store only
controlled failure codes. This is security groundwork, **not** completion of the
gallery, API-key/OAuth lifecycle or provider connectors. Those remain unimplemented.

Focused evidence this development pass: the latest combined run passed 277 tests
across graph/runtime, formulas, message rendering, business hours, webhook execution
and address validation. Disposable database baseline install and repeat application
passed with all 7 session-variable invariants (including edge and size checks).
TypeScript and ESLint on changed TypeScript files passed. These are development
checks, not production verification or completion of all phases. Nothing has been
pushed or deployed.

Architecture map checks passed. The release-fragment suite still reports two
failures from the pre-existing `.changes/meta-waba-subscription.md` frontmatter;
the new fragments parse successfully. This remains a final-release cleanup item.
