# Messenger channel — implementation checkpoint

Status: **native binding, ingress and activation UI implemented locally; not released**.
The integrations gallery supports credential preparation, testing, rotation,
disconnection and explicit activation. Page identity verification remains separate
from webhook verification and signed-message receipt. Production is unchanged.

2026-09-18 increment: migration 0279 adds organization-owned Page/session binding,
server-only Page-scoped contact identities and atomic deduplicated ingestion.
Rotation suspends the channel. Native capabilities, recipient resolution, guarded
transport and health checks are registered. Admin setup exposes the callback URL
without returning stored secrets. Five database tests pass, including concurrent
ingestion and cross-organization rejection; baseline INSTALL and UPDATE pass.
Incoming media persistence and durable dispatch recovery are implemented in the
increment below. Authenticated end-to-end testing and a controlled real-Page pilot
remain release requirements.

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
  not substituted for those identities. Supported attachment URLs are validated,
  persisted through the private media worker and never treated as instructions.
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
  revision again after decrypting. Native channel binding uses the actor-checked
  database function; callers never take a connection ID from customer content.
- Health checks may recheck a failed binding, but a valid Page token alone leaves
  the channel starting until a signed inbound message has actually been received.

## Remaining release gates

1. Durable recovery between atomic message insertion and post-entry dispatch.
2. Safe incoming-media persistence and privacy export/redaction for Page identities.
3. Verify actual native conversations through human send, bot dispatch, window
   policy and operator-visible definite/uncertain delivery outcomes.
4. Authenticated browser testing and a controlled Page pilot. Provider approval
   and messaging permissions still need checks beyond Page identity.

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

2026-09-18 follow-up: four native adapter health tests pass alongside fifteen
transport tests. This proves mocked status handling, not a live Page connection.

Recovery increment: signed ingress commits messages, media-persistence work and
post-ingress work in the same transaction. A protected dispatch receipt prevents
duplicate agent turns even when media workers replace message metadata. Opt-out
is committed before workers can respond. Supported image/video/audio/file URLs
use HTTPS, pinned public DNS, no redirects or tenant bearer headers, a 50MB stream
limit and a MIME allowlist. Existing private-storage and derivation workers handle
the bytes. Raw attachment contents are never invented by the bot.

Anonymization removes clear Page identity and preserves an organization/session-
specific suppression hash, so delivery retries do not recreate the customer.
Identity exports remain organization-scoped. Focused database tests cover replay,
privacy suppression, tenant boundaries, rotation and opt-out; a real Page pilot
and the complete release gates are still required before a live-success claim.
