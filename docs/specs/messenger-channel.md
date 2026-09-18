# Messenger channel — implementation checkpoint

Status: **credential setup implemented locally; messaging runtime not activated or released**.
The integrations gallery supports credential preparation, testing, rotation and
disconnection. It explicitly says messaging activation is unavailable and labels
a successful identity test “Credentials verified,” never “Connected.” No send
action is exposed in the builder. This does not make Messenger messaging usable.

## Confirmed by code

- `lib/channels/messenger/protocol.ts` verifies SHA-256 signatures over raw bytes
  before JSON parsing. Missing secrets and malformed signatures fail closed.
- Inbound identities are Page-scoped IDs, never phone numbers. Both the outer
  Page and inner recipient must match the Page selected from trusted storage.
  A mixed-Page batch is rejected; a future shared-app router must partition it
  using trusted connection ownership before handing it to this parser.
- Echoes and delivery/read events do not become customer messages. Stable message
  IDs are mandatory for later deduplication; postbacks without IDs are not accepted.
- Quick-reply and postback payloads remain selection identities. Their labels are
  not substituted for those identities. Attachment URLs are not returned or fetched.
- `outbound.ts` translates text and image/video/audio/document attachments into
  RESPONSE payloads. It refuses missing/mismatched conversation identities,
  unsupported interactive/template messages, unsafe URLs, and captions that would
  otherwise be silently lost or require an untracked second send.
- No network request, credential read, customer message or database write occurs
  in either format helper. These are format/security boundaries, not authorization gates.
- `transport.ts` resolves credentials using an explicit organization/Page scope,
  verifies that the returned connection matches, and sends only to the fixed Graph
  host with bearer credentials in headers. It reuses bounded, DNS-pinned HTTP and
  never retries uncertain delivery. Provider errors are not copied into local errors.
- The existing send handler, legacy agent runtime and typing indicator now pass
  `provider_conversation_id` to the channel recipient resolver. Existing phone-based
  adapters ignore this optional field and retain their previous addressing.
- The canonical messaging-window gate only honors a template exception when the
  channel declares approved-template support. Otherwise it stops without suggesting
  a template that the channel cannot send.
- `connection.ts` validates Page credentials and tests `/me` against the configured
  Page ID, using bearer headers. It does not claim that identity verification proves
  messaging permissions, app approval, an app secret, or webhook delivery.
- `/api/v1/integration-connections` accepts Page credentials only for the current
  organization administrator. The existing vault seals them with organization,
  connection and revision authenticated context; rotation/test/disconnect use the
  existing actor-checked database mutation. No new plaintext storage or schema.
- `IntegrationsGallery` renders masked token, app-secret and verification-token
  fields. Secrets are cleared after saving and never loaded back into the form.
- The scoped resolver checks provider, active state, Page identity and the current
  revision again after decrypting. Native channel binding remains unimplemented;
  callers must not take a connection ID from untrusted customer content.

## Required before activation

1. Bind the existing organization-owned encrypted connection to a native channel
   with database-enforced ownership and disconnect/rotation propagation.
2. Native channel registration, capabilities, Page session reference and scoped
   conversation recipient propagation through every canonical send path.
3. Raw-body webhook route with bounded reads, trusted connection resolution,
   atomic deduplicated ingestion and canonical post-entry effects.
4. Register the channel capabilities and verify the window guard on actual native
   channel conversations, including the human-send path and publication checks.
5. Wire the transport to a database-backed credential resolver, revision checks and
   connection testing; persist definite rejection versus uncertain delivery visibly.
6. Add activation and webhook-receipt states to the credential setup UI. Provider
   approval and messaging permissions still need checks beyond Page identity.
7. Database isolation tests, authenticated browser tests, and a controlled Page
   pilot before the gallery is enabled. Incoming media ingestion remains separate
   from basic message parsing and must not fetch arbitrary webhook URLs.

## Evidence

2026-09-18: the combined focused run passed 93 tests in seven files covering
protocol, translation, mocked transport, existing message handlers, typing and the
window guard. The test-inclusive typecheck exposed two unchecked test array
accesses, subsequently corrected and rechecked successfully before the window-gate
increment. Targeted lint had zero errors (one pre-existing test import warning).
Tests use synthetic IDs and secrets; no real Page was contacted.
This is not evidence of a working end-to-end Messenger connection.

The next credential-management increment passed 129 tests across 15 files,
including the connection API, gallery form, scoped resolver, transport and shared
integration suites. Targeted ESLint and diff checks passed. A local synthetic
Chromium fixture verified masked fields, desktop/mobile layout and the visible
save control at 390px without horizontal overflow. No form was submitted to a real
provider. This is not authenticated E2E or proof of live persistence.

Protocol reference: [Meta's official Messenger Platform API collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api).

## Living System review

Classification: shared connection authority, credential and channel boundaries
are core; no niche checkout table is introduced. The existing gallery → connection
API → encrypted vault → lifecycle test/disconnect path is now a real consumer.
Lifecycle changes emit the existing integration audit actions, visible in the
audit viewer. Credential test failures keep the connection inactive and allow
rotation/retest. The architecture map is `integration-execution.architecture.json`.
Do not enable messaging until ingress → canonical dispatch → guarded transport →
persisted outcome and operator-visible failures all have real callers. There are
no automated customer sends, so no new follow-up or human-handoff behavior yet.
