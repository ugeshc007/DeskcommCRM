# Native checkout — implementation contract

Status: development, not released. The existing store installer creates a draft
enquiry flow, not a checkout. No payment or stock claim may be made from that draft.

## Boundaries

- Organization, customer and conversation ownership are resolved server-side.
- Product SKU, variant, quantity, destination and currency are inputs. Prices,
  inventory and delivery rates are read from that organization's catalogue.
- Missing stock, currency prices, delivery rates or required policy configuration
  stop checkout for human review. They are never filled in by an AI model.
- A quote is not a reservation. Confirmation must re-read and lock inventory,
  reprice the cart, and compare the customer's confirmed quote fingerprint.
- Orders, stock reservations and an idempotency receipt must commit atomically.
- The payment session must belong to the configured organization connection.
  Provider timeouts remain uncertain; do not create a second payment session.
- Neither browser redirects nor customer screenshots establish payment. Only a
  verified provider event matching organization, order, session, amount and currency
  may mark an order paid. Replays cannot deduct stock or fulfill twice.
- Expiration must be confirmed at the payment provider before releasing a payable
  reservation. A clock timeout alone is insufficient when payment is uncertain.
- Card details and secrets never enter chat, logs or catalogue data.

## Implementation evidence

`lib/ecommerce/checkout.ts` implements deterministic server-data quote calculation
and exact payment identity matching. Tests cover duplicate lines, missing stock,
foreign currency, unsupported delivery, changed-price fingerprints and overflow.
`orders.ts` previews and atomically reserves stock under current administrator
authority; idempotency and quote fingerprints prevent duplicate or stale orders.
The optional fixed provisioner creates module tables only when explicitly invoked.
`order-payment.ts` prepares a durable attempt and uses a stable Stripe idempotency
key; ambiguous attempts remain for reconciliation. Signed integration webhooks now
route native checkout events to exact order/session/amount checks and transactional
stock settlement. Browser redirects are static and never establish payment.

Database tests cover concurrent reservations, foreign actors/customers, replay,
unpaid completion and late payment after verified expiry. Provider transport is
mocked in unit tests; no real Stripe account was contacted.

Module installation/activation, catalogue editing and reviewed order/payment
screens are implemented locally. The catalogue includes media links; each
purchasable variant currently uses a separate SKU. Organization settings expose
delivery coverage, country-specific courier rules, manual quotes, free-delivery
thresholds and product/payment/delivery/return/warranty policies. The native
catalogue search tool is registered for draft store agents.

Payment URLs are not returned by the order-list endpoint. Copying a link rechecks
current administrator membership, connection ownership/revision, retained stock
and expiry. Expired or disconnected orders cannot issue another payment session.
Stock is not released merely because the local clock passed the deadline.

Customer-confirmed checkout is now wired through native inbound MCP tools. The
organization must explicitly enable automatic checkout; external MCP callers,
stale jobs, human takeover, blocked/anonymized customers and foreign proposals are
rejected. Quotes are bound to a customer, conversation and source message. A later
real inbound must exactly match the random confirmation text. Prices and stock
are recalculated before reservation; replay uses the same proposal/order.

The installed agent draft includes quote/confirmation/status capabilities. The
separate enquiry flow still only gathers requirements; it does not itself charge
or reserve. Neither template installation nor deployment publishes the agent.

Every reservation emits durable reconciliation work. Never-attempted expired
reservations can release stock; payable sessions require provider-confirmed
expiry. Unknown create outcomes remain payment_review with stock held and a
visible worker failure. Retrying must use the existing order/idempotency key.
No automatic replacement session is created. Privacy export includes proposals
and orders; anonymization removes proposal details and payable URLs.

For an unknown creation response, administrators can recover the existing session
from the Store order-review form. The server retrieves it using the organization's
current credential and verifies immutable client reference, session ID, metadata,
amount and currency before attaching it. The form cannot mark an order paid or
release stock on an operator's assertion alone.

Release status remains unverified and not deployed until the full regression,
authenticated checkout journey, provider pilot and deployment gates pass.

Focused evidence: seventeen checkout unit tests, six checkout API tests, five
store-screen component tests, and fifteen database tests across native orders,
Page ingestion and the draft installer passed. Baseline INSTALL and UPDATE passed.
Component tests are not visual or authenticated end-to-end proof.

The local production build passed. An authenticated Chromium test then installed
the optional module in the disposable database, saved a synthetic catalogue item,
reloaded and verified persistence, and captured desktop/mobile screenshots. The
390px viewport had no page-level horizontal overflow; the item was archived by
the same organization API afterwards. Screenshots were visually reviewed. This
tests catalogue setup, not customer checkout or a real payment.

Provider contract: [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create).
