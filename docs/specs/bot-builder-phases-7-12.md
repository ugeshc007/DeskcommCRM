# Bot builder — approved phases 7–12

Source: operator-provided scope in this task. This is the approved implementation
sequence, **not a record of completed or deployed capabilities**. The integration
work previously grouped under phase 6 is expanded into phases 7–9 here; it is one
framework, not two competing connection stores or execution engines.

## Phase 7 — integrations gallery and connection management

- App cards with icons, descriptions and setup instructions.
- Organization-owned API keys or OAuth accounts.
- Test, reconnect, disconnect and rotate credentials.
- Permissions and connection ownership checks at every boundary.
- Redacted execution history and readable failures.
- Builder blocks select a connection, action and field mappings.
- Success/error branches, safe retries and duplicate-action protection.

Result: a shared secure framework for connectors. A saved credential is not a
verified connection; an available gallery card is not proof of a working adapter.

## Phase 8 — data and automation connectors

- Google Sheets and Airtable: read data and save leads.
- Webhook and custom API blocks; n8n and Zapier connections.
- Trigger automation and Dynamic data blocks.
- Signed inbound webhooks and protected outbound requests.

Result: flows exchange data with organization-connected systems.

## Phase 9 — sales, payment and communication connectors

- HubSpot / Salesforce: documented supported contact and deal actions.
- Calendly booking integration.
- Stripe payment links and verified payment updates.
- Slack and email notifications; SendGrid and Mailchimp.
- Dialogflow, Segment and Facebook Messenger.

Result: independently tested connectors with documented actions. Provider app
registration, OAuth approval and test accounts can be release prerequisites; their
absence must not be represented as a successful connection or hidden fallback.
Customer-facing messaging must reuse the existing channel send safeguards.

## Carry-over checkpoint — after Phase 9, before Phase 10

Complete the remaining earlier-phase work: reusable flows with bounded recursion,
global keyword routing, dedicated human-handoff blocks with explicit resumption,
and any unfinished gallery/provider connection work. Explicit goal/scoring
consumers remain on the earlier checklist; generic variables alone are not them.
Do not silently drop these items when advancing the phase number.

## Phase 10 — reusable e-commerce template

- Catalogue: SKU, name, category, description, price, currency, stock, variants,
  media and links; flexible categories across business types.
- Sales agent prompt and Sales pipeline.
- Organization country, time zone, default and additional selling currencies.
- Domestic-only or domestic/international delivery with configurable courier
  charges and delivery information.
- Product, payment, delivery, return and warranty FAQs.
- Abandoned-cart/payment follow-ups and human handoff.
- Interactive product messages where the connected channel supports them.

Result: each organization installs and customizes its own store template.
Example: Welcome → Categories → Product → Quantity → Delivery → Payment → Confirmation.
No invented prices, stock, courier rates, payment success or business policies.

## Phase 11 — simulator and publication controls

- Sample-answer conversations, step/branch/variable inspection.
- Mock external actions without real sends, bookings or payments.
- Detect missing settings, invalid flows and broken connections.
- Separate draft/published versions, execution history and failure diagnostics.
- End-to-end and cross-organization security tests.

Result: users can verify a bot before publication. Focused development checks run
during implementation; full release verification is scheduled here, as requested.

## Phase 12 — live rollout and documentation

- Backups and rollback preparation; controlled pilot with one organization.
- Real-channel delivery, English wording and desktop/mobile usability checks.
- Preserve existing flows, customer data and other hosted applications.
- Setup guides, example templates and connector instructions.
- Broader release only after pilot checks pass.

Result: a verified live release. Deploying code does **not** automatically publish
customer bots. No live writes or deployment are part of the current development pass.

## Phase 7 implementation decisions

Proposed implementation safeguards (not claims of current production behavior):

- Resolve organization/user through existing server authentication. Never trust an
  organization ID or credential in a builder graph, field mapping or callback body.
- Connection metadata is separate from encrypted server-only credentials. Bind
  ciphertext to organization, connection and credential revision. Rotation or
  disconnect invalidates queued work carrying an older revision.
- OAuth uses expiring, single-use state bound to organization, initiating user,
  provider and browser; re-check current permission before saving the exchange.
- Each action has a typed input/output schema and an explicit retry class:
  read-only, provider-idempotent or non-retryable. An ambiguous mutating request
  must become visible work, not an automatic second charge/message/deal.
- An atomic organization-scoped ledger claims execution before external action.
  Its key identifies the flow enrollment/node visit. Completed actions return
  their safe result; simultaneous claims do not execute twice. A timeout after a
  mutating call is indeterminate until reconciled, not proof of failure.
- Store controlled status/failure codes and safe field projections, not raw
  headers, tokens, credentials or provider response bodies. Operational errors
  route to the builder error branch and execution history, never customer text.

Implementation status: roadmap recorded. `lib/integrations/execution.ts` implements
the shared action execution contract with strict action input/output, organization
and revision checks, claim/result replay handling and sanitized failure codes.
`execution.test.ts` exercises the contract with synthetic adapters/store, including
foreign organization, rotation, ambiguous effects and secret-bearing responses.
These unit tests do not prove a real provider.

`postgres-store.ts` now implements that port against migration 0275. Connections
have organization-scoped metadata, while encrypted credentials and execution
results are server-only (explicit ACL revocation as well as RLS). `vault.ts` binds
AES-GCM authenticated context to organization, connection and revision. Existing
AES-GCM callers without authenticated context remain compatible.

The atomic claim records connection/action/revision and permits only one winner for
an organization/execution key. Completed and definitively failed results replay;
conflicting input and forged leases are rejected. Indeterminate or abandoned work
is never automatically reclaimed, even for read-only actions. Provider-specific
reconciliation and safe retry policies are still pending, not silently inferred
from elapsed time. A disconnect cannot cancel a network request already in flight.

Evidence on 2026-09-17: 23 focused unit tests, 8 PostgreSQL invariants, baseline
fresh install and repeat update, TypeScript and targeted ESLint passed. The database
tests exercise the actual executor/store with synthetic adapters (no provider calls):
concurrent claims, replay, wrong organizations, row-level visibility, secret ACLs,
revoked revisions and ambiguous outcomes. No production credentials or data used.

Classification: shared authority/credential/execution **core**, not provider-specific
business data. No account is activated by the schema. The branch is dirty with
ongoing earlier phases, so upstream was fetched but not merged. Migration number
0275 follows the freshly checked upstream maximum 0274; reconcile upstream changes
before release. Generated database types still require regeneration.

Phase 7 implementation update (CONFIRMED by code, not live deployment):
`/app/integrations` is linked in navigation with app cards, setup instructions,
organization connections, test/rotate/reconnect/disconnect and redacted history.
Migration 0278 guards lifecycle mutations with current administrator membership
and revision CAS. OAuth uses browser-bound single-use state, PKCE, fixed callback,
encrypted verifier/token storage and current membership checks. Google connection
testing refreshes expired tokens server-side and persists them through revision CAS.
The builder offers an Integration action, selected connection revision and field
mappings, with Success/Error outputs. The follow-up worker calls the shared ledger;
uncertain delivery stops for review without blind resends. Publish checks reject
inactive, stale or foreign connections. Signed HTTPS webhook is the first usable
action. Google account authorization is implemented; spreadsheet actions remain
Phase 8. Other app cards are explicitly Planned, not simulated connectors.

Living System checklist: executor → PostgreSQL claim → credential callback →
terminal result are concrete edges, mapped in `integration-execution.architecture.json`.
Ledger status, operator history, navigation and management audit now have concrete
consumers. Human handoff is unchanged. Provider-specific reconciliation is manual:
check the remote receiver before arranging any new action. There is no force-retry
button that could duplicate an uncertain effect. Final authenticated end-to-end,
real OAuth consent/provider delivery and release verification remain Phase 11/12;
no production configuration, credentials, customer bots or live data were changed.

Development evidence for the management increment: 69 focused unit tests, 12
PostgreSQL tests, TypeScript and targeted ESLint passed. Baseline fresh install
and repeat update passed. Local synthetic desktop gallery and desktop/mobile
credential dialog rendered and were visually inspected. This is not a claim of
full authenticated E2E or Google consent verification.
The local builder also added an Integration action, selected the synthetic
organization connection and displayed the action, field mappings and two outputs.
