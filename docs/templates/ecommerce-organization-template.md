# Reusable E-commerce Organization Template

Status: product configuration blueprint

This template is for organizations that sell electronics, home items, furniture,
groceries, or other physical products. It defines the information and operating
rules that the CRM must collect before an AI sales agent is published.

The template never supplies commercial facts on behalf of an organization.
Prices, stock, delivery fees, payment terms, return periods, warranties, discounts,
and response hours remain unset until an organization configures them.

## 1. Organization defaults

| Field | Required | Behaviour |
|---|---:|---|
| Country | Yes | Selected from the full ISO 3166 country list. Defines what “domestic” means. |
| Base currency | Yes | Suggested from the selected country and stored on the organization. Existing product prices are never converted silently when this changes. |
| Time zone | Yes | Suggested from the selected country and confirmed by the organization. |
| Language | Yes | English by default for this template. The sales agent must not answer in Portuguese unless the organization deliberately changes its language later. |
| Delivery coverage | Yes | `domestic_only` or `domestic_and_international`. |
| Additional selling currencies | No | Optional organization-controlled price lists for cross-border sales. They do not replace the base currency. |

## 2. Product catalogue

Every organization owns its catalogue. Products may be created manually, imported
from CSV, or synchronized from a store/API. Import and synchronization must report
rejected rows and stale/error states visibly.

### Product fields

| Field | Required | Notes |
|---|---:|---|
| SKU | Yes | Unique within the organization. |
| Name | Yes | Customer-facing product name. |
| Category | Yes | Examples: Electronics, Home, Furniture, Groceries. Categories are organization-defined. |
| Description | No | Customer-facing description; never used as a source of price or stock. |
| Price | Yes | Integer minor units, displayed in the organization or price-list currency. |
| Currency | Yes | Defaults from the organization. |
| Stock control | Yes | Controlled or not controlled. |
| Stock quantity | Conditional | Required when stock control is enabled. |
| Product link | No | Public HTTPS product page. |
| Image | No | Public image or managed media reference. |
| Active | Yes | Inactive products are not offered by the AI agent. |

### Variant fields

Each variant has its own SKU, option values, price override, stock setting, quantity,
link, and active state. Examples of option values include brand/model, colour, size,
material, weight, pack size, and grocery expiry or batch information where relevant.

The agent must verify the exact variant before quoting its price or availability.

### Catalogue input methods

- Manual create/edit form.
- CSV import and export with row-level validation results.
- Store/API synchronization with scheduled refresh and webhook updates.
- Reconciliation view showing the source, last successful update, and current error.

## 3. Delivery and courier configuration

No delivery method is active by default. An organization enables the methods it can
actually honour and orders them by priority. The first complete matching rule wins.

### Coverage

- **Domestic only:** destinations must match the organization's country.
- **Domestic and international:** domestic rules apply inside the organization's
  country; international rules apply only to enabled destination countries or zones.

### Supported charge methods

1. **Flat rate** — one configured charge for the matching scope or zone.
2. **Destination zone** — country, state/emirate/province, city, or postcode rules.
3. **Order value** — configured value bands and an optional free-delivery threshold.
4. **Weight or dimensional weight** — configured bands, unit, and dimensional divisor.
5. **Courier API** — live quotation from a configured courier adapter.

An organization may enable one or several methods. Every rule contains:

- domestic or international scope;
- priority;
- enabled state;
- currency;
- conditions;
- charge or courier service reference;
- estimated delivery range supplied by the organization or courier;
- effective dates, when applicable;
- fallback behaviour.

If a courier API is unavailable, the CRM uses an explicitly configured fallback rule
or transfers the conversation to a person. It never invents a fee or delivery date.

International configuration also records supported destinations and the exact
customer-facing statement about customs, duties, import tax, and restricted items.

## 4. Payment configuration

Each organization enables only the methods it supports:

- card;
- bank transfer;
- cash on delivery;
- payment link;
- digital wallet;
- buy-now-pay-later or instalments;
- another organization-defined method.

For each enabled method, configure currency, minimum/maximum order value, applicable
countries, instructions, payment expiry, and whether manual verification is required.
The agent never confirms payment from a customer statement alone.

## 5. Sales pipeline

Pipeline name: **Sales**

| Position | Stage | Agent meaning |
|---:|---|---|
| 1 | New contact | The customer has contacted the organization and has not been answered yet. |
| 2 | Responded | The first useful reply has been sent. |
| 3 | Choosing product | Requirements, product, and exact variant are being identified. |
| 4 | Ready to buy | Product, variant, quantity, and destination are known. |
| 5 | Awaiting payment | Checkout or payment instructions were provided but payment is not confirmed. |
| 6 | Paid | The order payment is confirmed. This is the won stage. |
| 7 | Did not buy | The customer declined or the opportunity was explicitly closed. This is the lost stage. |

Vocabulary: customer = **Customer**, deal = **Order**, won = **Paid**, lost =
**Did not buy**.

## 6. English sales-agent prompt

```markdown
# Role
You help customers of this organization choose and buy products. Always communicate
in clear English. Keep each message short and ask one question at a time.

# Understand the request first
Identify what the customer wants, who or what it is for, the required product or
category, exact variant, quantity, destination, and required delivery date. Do not
ask again for information already provided.

# Product and price
Consult the active product catalogue before offering a product or stating price,
stock, or a product link. Confirm the exact variant and quantity. If the catalogue
does not contain the answer, explain that the information needs confirmation and
transfer the conversation to a person.

# Delivery
Collect the destination information required by the configured delivery rules.
Use only the enabled domestic or international rules and courier quotation. State
the currency together with the delivery charge. If no valid quote is available,
do not estimate it; transfer the conversation to a person.

# Payment
Explain only payment methods enabled for the customer's country and order. Never
claim that payment succeeded until the CRM has a confirmed payment status.

# Returns, warranty, and order problems
Use the organization's published policies. Transfer to a person when approval is
required, when an order is already paid, when delivery is disputed, or when the
published material does not answer the case.

# Style
Be helpful, concise, and specific. Offer no more than three suitable products at a
time. Do not use internal CRM terminology. Do not switch to Portuguese.
```

## 7. FAQ material required before publication

Answers remain blank until the organization supplies an approved answer. An FAQ with
an unanswered required item must not be published as knowledge.

### Products

- Which product categories and brands are sold?
- How is live stock confirmed?
- How are variants, substitutions, and out-of-stock products handled?
- Are product links and images available?

### Delivery

- Which domestic areas are served?
- Which international countries or zones are served?
- How are delivery charges calculated?
- What are the approved estimated delivery ranges?
- Who is responsible for customs, duties, and import restrictions?
- How can a customer track an order?

### Payment

- Which payment methods are enabled?
- Which currencies are accepted?
- Are instalments, COD, minimum values, or payment-expiry rules applicable?
- How is payment confirmed?

### Returns and warranty

- What is the approved return period and eligibility policy?
- Who pays return delivery in each approved case?
- Which items cannot be returned?
- What warranty applies by category or product?
- What evidence is required for damage, defect, or missing items?

## 8. Follow-up blueprints

These flows are installed as drafts. The organization must configure the wait times,
message-template IDs required outside WhatsApp's service window, and stopping rules
before publishing them.

### Product-selection follow-up

`silence while Choosing product` → `organization-defined wait` → `English AI message
asking whether the customer needs help comparing the selected products` → `stop when
the customer replies, opts out, or is transferred to a person`.

### Abandoned-cart follow-up

`Ready to buy without checkout/payment` → `organization-defined wait` → `English
message confirming product, variant, and whether checkout help is needed` → optional
second wait and final attempt → `exhausted`.

### Awaiting-payment follow-up

`Awaiting payment without confirmed payment` → `organization-defined wait` → `English
message offering help with the enabled payment method` → recheck payment before every
message → stop immediately when payment is confirmed, the customer replies, opts out,
or a person takes over.

## 9. Human handoff rules

Transfer with a structured summary when:

- a requested product or exact variant is absent from the active catalogue;
- stock, price, delivery charge, delivery estimate, or policy cannot be verified;
- a courier API fails and no configured fallback rule matches;
- the customer requests a discount or commercial exception outside configured limits;
- payment is disputed or needs manual verification;
- a paid order has a delivery, cancellation, return, refund, damage, or warranty issue;
- customs, restricted goods, or an unsupported international destination needs review;
- the customer asks for a person.

The summary includes the requested items and variants, quantities, destination,
catalogue results, quote/payment state, the unresolved question, and any commitment
already made. It does not copy the entire conversation.

## 10. Tests required before publication

Run these through the agent-version **Test** screen in English. The template remains a
draft until each applicable case passes and no response invents a fact.

1. “Do you have this television in 55 inches, and what is the price?”
2. “I need four dining chairs in black. Are they in stock?”
3. “Can you deliver groceries to my postcode today?”
4. “What is the domestic delivery fee for this order?”
5. “Can you ship this furniture internationally, and who pays customs duty?”
6. “The courier quotation is unavailable. How much will delivery cost?”
7. “Which payment methods can I use from my country?”
8. “I paid, but the order still says awaiting payment.”
9. “The product arrived damaged. I want a replacement.”
10. “Can you give me a discount that is not listed?”
11. “Show me a product or variant that does not exist in the catalogue.”
12. “I want to speak to a person.”

Expected behaviour: catalogue facts are cited correctly, currencies are explicit,
delivery and payment configuration is respected, unknown facts trigger handoff, paid
order issues trigger handoff, and every response remains in English.

## 11. Publication checklist

- Organization country, currency, timezone, and English language confirmed.
- Delivery coverage and at least one valid charge method configured.
- Courier API has a visible health state or an explicit fallback rule.
- Catalogue contains active products and exact variants with current price/stock.
- Payment methods and confirmation source configured.
- Delivery, payment, return, and warranty FAQs contain approved answers.
- Sales pipeline installed with exactly one won and one lost stage.
- Follow-up flows configured, validated, and deliberately published.
- Sales agent has catalogue/knowledge access and a connected working channel.
- All applicable test scenarios pass in English.
- A person and routing policy exist for every handoff rule.
