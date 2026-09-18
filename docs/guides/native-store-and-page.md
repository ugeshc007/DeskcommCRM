# Configure native store checkout and Page messaging

Deployment does not publish customer bots, activate stores, send messages or
charge cards. Each organization supplies its own accounts and policies.

## Store setup

1. A full platform administrator opens **Administration → Store module** and
   confirms installation. Re-running preserves existing module data.
2. The organization administrator opens **Integrations → Stripe**, saves its own
   credential and webhook signing secret, and tests the connection. Configure
   the signed webhook endpoint shown by the connection. Never paste secrets into
   prompts, catalogue fields or chat.
3. Open **Store → Store and delivery settings**. Select the payment connection,
   configure card payment and destination-specific courier rules, and confirm
   whether catalogue/courier prices include all applicable taxes. This checkout
   does not calculate additional taxes. Missing or ambiguous rates stop checkout.
4. Add products with a distinct SKU per purchasable variant, exact minor-unit
   price, currency and known stock. Product media are public HTTPS links; customer
   inbound media is stored privately. Unknown stock is not treated as available.
5. Enable reviewed checkout. To allow the bot to reserve after customer consent,
   separately select **Allow the published sales agent to prepare checkout**.
6. Install the store template from the follow-up template installer. Review the
   generated draft agent, Sales pipeline and enquiry flow. The agent's native
   capabilities are product search, verified quote, confirmed checkout and order
   status. Existing agent drafts need these capabilities selected explicitly.
7. Test before publishing. The separate enquiry flow gathers requirements; the
   published sales agent performs customer-confirmed checkout through its tools.

## Customer journey

Product/SKU → quantity → destination country and currency → verified quote →
customer sends the exact `CONFIRM …` text → stock reservation → secure payment
link → provider-verified payment status.

The secure payment page collects delivery address and card details. The bot must
never request card numbers, security codes or OTPs. Sending a link is not proof
of payment. Unknown amounts, delivery rules, unsupported currencies, price changes
or insufficient stock require a revised quote or human review.

## Recovery and operator review

- Retrying a customer confirmation reuses its proposal/order, not a new order.
- A timeout after payment creation is **payment review**, not a confirmed failure.
  Do not create another order. Stock stays reserved until the existing session is
  verified paid or expired.
- In **Store → Recover an uncertain payment**, locate the existing Checkout
  Session in the organization's provider dashboard using the order ID as its
  client reference. Paste its session ID. The CRM retrieves and verifies it;
  entering an ID alone cannot mark payment successful.
- Background recovery reads existing provider sessions without charging cards.
  Failures use the event worker's retry/dead-letter path and the order remains
  visible for review. Disconnected/rotated credentials require administrator review.

## Page messaging

In **Integrations → Facebook Messenger**, supply the organization's Page ID,
Page token, app secret, verification token and Graph API version. Test the
credential, bind the channel, and configure the displayed callback in the Meta
app. The token test does not prove webhook delivery: send a real test message and
check Inbox before publishing an agent. Organization credentials are encrypted
server-side and saved values are not returned to the browser.

Supported standalone media: image, video, audio and document. Captions requiring
an additional send and unsupported interactive/template formats are rejected,
not silently discarded. Use separate text and media steps. The normal messaging
window, customer opt-out and human-takeover guards still apply.

## Release/pilot checklist

Test another organization's access rejection, disabled-store behavior, stock
contention, changed prices, duplicate confirmations, customer cancellation/human
takeover, payment timeout/recovery, signed paid/expired events and media retry.
Use a provider test account before real transactions. Review desktop/mobile layout,
English wording, worker failures and rollback backups. Publishing a customer bot
remains an explicit organization decision.
