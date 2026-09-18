# Phase 8–9 implementation status

Local development only. No deployment, real provider authorization or payment was performed.

## Implemented adapters (mock-tested, not live-provider verified)

| Provider | Actions | Authentication / limitations |
|---|---|---|
| Google Sheets | Read a single cell; append a RAW row | Existing Google OAuth connection |
| Airtable | Read one record field; create a record | Personal token; administrator-fixed base and table |
| Custom API | GET/POST and extract a scalar top-level field | Fixed HTTPS endpoint, method and bearer token |
| n8n / Zapier | Trigger an external workflow | Fixed secret endpoint; n8n header authentication |
| HubSpot | Create contact; create deal | Private app token; internal pipeline/stage IDs |
| Salesforce | Create Contact; create Opportunity | Access token; fixed My Domain; manual token rotation |
| Calendly | Create single-use booking link | Personal token and fixed event type; not appointment confirmation |
| Stripe | Create payment link for existing price | Restricted key; stable idempotency key; NOT proof of payment |
| Slack | Staff notification | Fixed channel in connection, not flow-controlled |
| SendGrid | Plain-text staff notification | Fixed verified sender and staff recipient |
| Mailchimp | Read subscription status | Fixed audience; no subscription or campaign writes |
| Dialogflow ES | Detect intent, return a suggested reply | Project-scoped access token; isolated single-turn session; manual rotation |
| Segment | Anonymous track event | Source write key; stable message ID; synthetic test can trigger destinations |
| Signed inbound | Receive signed events; read one field by event ID | Timestamped HMAC; fail-closed, connection-scoped deduplication |
| Stripe updates | Receive signed checkout snapshots; read one field by event ID | Requires a link created by this organization connection; no automatic fulfillment |

Builder blocks map input expressions and optionally save one returned scalar into a session variable. Credentials stay in the existing organization-scoped encrypted vault. Execution uses the existing organization/key ledger; ambiguous writes require review, not automatic retries. A successful webhook response means receipt, not downstream workflow completion.

Custom POST, n8n and Zapier connection tests can trigger external effects. The confirmation dialog warns administrators to use a test endpoint. Other authentication tests do not prove all action-specific permissions.

## Remaining — phases are not complete

- Facebook Messenger channel implementation. Its card remains disabled; it must use the customer-channel policy boundary rather than bypass it.
- Provider-specific OAuth lifecycles beyond Google where needed (Salesforce and Dialogflow currently accept manually rotated access tokens).
- Additional engine output-persistence tests, provider failure/transport coverage, full UI checks, and live-provider sandbox tests.
- Final cross-organization tests, publication checks, rollout and documentation in the scheduled release phase.

Google worker refresh now persists encrypted renewed credentials with a compare-and-set on the previous authentication tag, without changing the administrator revision. A concurrent refresh/rotation conflict stops execution before the external action.

Inbound callback: `/api/v1/webhooks/integrations/{connection_id}`. Generic JSON is `{id,event,data}` with up to 30 scalar fields. Header `X-Integration-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` signs `<timestamp>.<exact raw body>`; tolerance is five minutes. A connection must be active and its signing secret present. The existing server-only execution ledger stores the bounded projection. The gallery shows redacted receipt status; a builder block reads an exact event ID. Receiving does not automatically enroll a customer or advance a payment/order.

Stripe verifies `Stripe-Signature` and handles `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. It rejects payment links not found in this connection's successful creation ledger. An unpaid completed checkout stays unpaid. Event snapshots are immutable rather than overwriting order status on out-of-order delivery. Before fulfillment, application-specific code must still associate the checkout session with the correct order/customer and check amount/currency; this increment does not invent that association.

## Provider references

- Google Sheets: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
- Airtable: https://www.airtable.com/guides/scale/using-airtable-api
- HubSpot: https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/create-contact
- Salesforce: https://developer.salesforce.com/docs/platform/api-rest/guide/resources-sobject-basic-info-post.html
- Calendly: https://developer.calendly.com/api-docs/calendly-api/scheduling-links/create-scheduling-link
- Stripe: https://docs.stripe.com/api/payment-link/create
- Slack: https://docs.slack.dev/reference/methods/chat.postMessage/
- SendGrid: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- Mailchimp: https://mailchimp.com/developer/marketing/api/list-members/get-member-info/
- Dialogflow: https://docs.cloud.google.com/dialogflow/es/docs/reference/rest/v2/projects.agent.sessions/detectIntent
- Stripe signatures: https://docs.stripe.com/webhooks/signature

## Development checkpoint — 2026-09-18

71 focused integration/route unit tests passed. The PostgreSQL ledger/management run passed 13 tests, including received-event cross-organization isolation, and baseline install plus repeat-update passed. No remote provider account, credential or production database was used. These are not live-provider or authenticated visual E2E results.

Living System checklist: input is the authenticated builder or a signed webhook; output is the scoped execution ledger and selected session variable. Mutations emit `integration.event_received` or existing management audit actions. The gallery exposes callback paths, setup instructions, redacted execution history and failure status. Its navigation entry remains `/app/integrations`. Ambiguous operations stop for operator reconciliation rather than blind resend. Handoff behavior is unchanged; Dialogflow has no direct customer-send path. Configuration lives in the gallery credential dialog. Errors return controlled codes and require correction/reconnection. The architecture map includes inbound→ledger and vault→inbound edges. Full UI verification and Messenger channel work remain open; Phases 10–11 have not been implemented by this checkpoint.
