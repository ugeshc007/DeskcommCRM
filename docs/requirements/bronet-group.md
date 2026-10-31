# Bronet Group CRM requirements — STORIES, ZODIYA, STORIES INTERNATIONAL

Source: business brief supplied by the customer on 2026-09-23. This is a requirements record, not a claim that every item is already implemented.

## Confirmed operating model

The three brands are separate **organizations in one CRM installation**. The customer confirmed this choice. Organization data remains isolated by `organization_id` and RLS. A person may belong to more than one organization, but that does not by itself transfer a lead or grant one organization access to another's customers.

SAP invoice data will be supplied through a **webhook**. The SAP product, event format, signing method, and invoice identity fields have not yet been specified.

The customer confirmed that manager escalation starts **after one working day overdue**. Use Monday–Friday in the organization's configured timezone; holidays are not excluded until a holiday calendar is supplied.

Cross-brand assignment **moves ownership** to the destination organization. The source organization must retain an audit receipt, but cannot keep a readable duplicate lead. The SAP payload/authentication contract, store and product lists, and stage mapping will be supplied later; these workflows must not guess values or activate outbound sends in their absence.

The customer confirmed that a cross-brand move requires a **manager or admin who belongs to both the source and destination organizations**. The active organization remains the trusted source organization; the destination is explicitly selected and independently authorized.
The destination may receive the lead's customer name, phone, email, products, budget, follow-up and notes; the source keeps a non-readable audit receipt only.
The customer confirmed that a moved lead keeps the **same Event ID** across brands. Any move must migrate its linked records atomically and preserve tenant isolation; issuing a replacement lead ID is not acceptable.

## Current fit and gaps

| Requirement | Current CRM evidence | Gap or next action |
|---|---|---|
| Lead details | The implementation branch adds an optional retail lead form with phone, source detail, products, budget, purchase date, address, required next follow-up, and salesperson/store derived from the login and manager assignment. Other tenants' generic lead form remains unchanged. | Not live until the full release gate and deployment complete. Store and product catalogs remain to be supplied. |
| Lead/Event ID and repeat customer | The implementation branch uses the existing lead UUID as the Event ID, enforces one open event per international-format phone per organization, and searches open and historical Event IDs by phone without putting the phone in a URL. | Confirm any desired shorter display format; keep the UUID as the canonical ID. |
| Three-month retention lead | Lead close states and follow-up machinery exist. | Add an idempotent scheduled retention job after the conversion date, conditional on the agreed rule for existing open leads and the salesperson's current membership. |
| Follow-up enforcement and escalation | The implementation branch requires a future next follow-up, records Done with a new stage and next date unless Won/Lost, and shows manager overdue/escalated flags after one Monday–Friday working day in the organization timezone. | Not live yet. The recipient/channel for a push notification remains unspecified; current flag is in-app only. |
| Cross-brand assignment | The implementation branch adds an atomic move of the same Event ID, contact, history and follow-up into a selected destination pipeline, stage, owner and store, gated to a manager/admin in both organizations. It leaves a source audit receipt without lead content. | Not live yet. Moves with other linked records or matching destination contacts fail for manager review until their merge/transfer semantics are agreed. |
| Conversion invoice matching | Leads have Won/Converted-like status and value, but no SAP invoice lookup or lead-to-multiple-invoices workflow was found. | Receive signed SAP webhook events, store tenant-scoped invoice identities, then let staff select one or more matching invoices at conversion. Phone alone must not silently select an invoice. |
| Campaign and performance reports | Meta Ads campaign read APIs and an activity report exist. A stage-aging report is being added on the implementation branch, using the existing stage-entry timestamp and a selectable day threshold; it is not live yet. | Add campaign-to-lead attribution and the requested qualified/follow-up/conversion/value and CRE × salesperson reports. Define qualification and CRE before calculating totals. |
| Marketing channels | WhatsApp conversation sending and Meta Ads read integration exist. No in-product bulk WhatsApp/email campaign flow or Meta Lead Form ingestion was found in the current code search. | Scope consent, opt-out, campaign scheduling, delivery and conversion events. Separate Meta Ads insights from Meta Lead Form capture and Conversion API delivery. No campaign should publish or send during implementation. |
| Recent note on lead card | `crm_lead_activities` is the lead timeline; `note` is an existing activity type. The lead card did not display the newest note and the dossier had no direct note composer. | Add a note action and show its text, time and author on the pipeline card, with full history in the dossier. This is the first implementation slice. |

## Decisions still required before the remaining workflows can be implemented

1. Is “Created” a new visible pipeline stage for each brand, and which existing stage names count as Qualified, Converted and Lost?
2. What are the product lists and stores for each organization? Can one salesperson work in multiple stores?
3. Is CRE a role, a person assigned to each lead, or the person who captured it?
4. What does “once the existing one is Converted or Lost” mean if a mobile number has several older leads, or belongs to a shared household/business number?
5. For the retention lead, should the three months be counted from conversion date or invoice date? What if the original salesperson has left?
6. Which manager receives a push escalation, and which notification channel is used? The current in-app flag is visible to all managers of the organization.
7. Cross-brand authorization and transferred customer data are confirmed above; the manager selects the destination pipeline/stage and salesperson at transfer time. Define how to merge an existing destination contact and how to handle leads linked to other modules before expanding transfer eligibility.
8. Provide a sample SAP webhook event and an authentication/signature contract. Specify invoice ID, number, amount, currency, customer phone, organization/brand, returns/cancellations and replay behavior.
9. Define campaign attribution keys and the qualifying event. Decide whether consent is brand-specific or group-wide before cross-brand marketing.

## Delivery order

1. Recent note display and entry, with existing lead history and organization isolation. **Customer approved shipping this slice first.**
2. Bronet lead form and required-field configuration; Event ID and duplicate-open rule.
3. Follow-up lifecycle, manager escalation and retention automation.
4. Authorized cross-organization transfer and SAP webhook invoice matching.
5. Campaign capture, outbound campaign controls, conversion events and reports.

Each later slice needs its own schema/RLS tests and an end-to-end journey against a fresh installation. Customer campaigns and bots remain unpublished until separately authorized.
