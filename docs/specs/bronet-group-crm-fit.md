# Bronet Group retail CRM — fit and requirements draft

Status: discovery only. **No Bronet-specific feature is implemented or deployed by this document.**
`CONFIRMED` denotes the supplied brief or current repository code; `PROPOSED` is a design
option awaiting Bronet approval. This is separate from the Field Sales release.

## Fit against the current CRM

| Requirement | Current foundation (confirmed in code) | Work still needed | Reuse |
|---|---|---|---|
| Lead capture | Contacts, CRM leads, pipelines, owners, source, value, expected close date and custom fields | Bronet intake form with required products, budget, purchase date, source, follow-up; secondary phone/address mapping and validation | Configurable retail lead form |
| ID and duplicate rule | Contact search and lead IDs exist | Normalized-phone active-event exclusivity, atomic create gate, history and explicit terminal-state rule | Optional event/lead policy per organization |
| Retention | Lead reactivation exists, but not the specified post-conversion cycle | Three-month scheduled creation, same-owner fallback, retention source, idempotency and opt-out | Configurable retention workflow |
| Follow-up | Tasks, next actions, follow-up engine and stage transitions exist | Save-time mandatory due date, complete-then-next-status/date form, overdue SLA escalation and escalation history | Tenant policy and workflow template |
| Three brands | Organization isolation and independent pipelines exist | Deliberate cross-organization transfer; never direct cross-tenant read/write | Permissioned transfer mechanism |
| SAP conversion | Won/lost transitions exist | SAP adapter, phone-to-customer mapping, invoice lookup and selection, one-to-many invoice links, reconciliation | Configurable ERP connector interface; SAP adapter separate |
| Reporting | Pipeline/lead views and read-only Meta campaign insights exist | Invoice-backed attribution, CRE×salesperson, lead aging, follow-up SLA and source/campaign joining | Generic reports with tenant-defined dimensions |
| Marketing | WhatsApp and channel template infrastructure; read-only Meta Ads; CTWA conversion transport | Meta Lead Form capture, correct CRM Conversion API mapping, consent/opt-out-aware WhatsApp and bulk email campaigns | Shared connector/campaign framework |
| Latest note on lead list | Lead activity timeline exists; conversation notes are separate | Human lead-note write/read API, latest note text/time/author on list, immediate update and full note history | Reusable lead-note preview for all organizations |

## Important architecture choice

`CONFIRMED`: Bronet asks for separate brand instances *and* assignment between brands.
Current tenant boundaries prohibit reading another organization's leads. `PROPOSED`:
three organization spaces under one platform account with an explicit transfer operation.
The source keeps its own immutable transfer record; the destination receives a scoped copy
with source brand/campaign provenance, new local lead ID and consent metadata. Recipient
and action must be authorized and audited. If Bronet truly needs physically separate
installations, use a signed integration between installations instead; no shared database
shortcut. The two alternatives need a decision before schema design.

## Lead lifecycle to confirm

1. `Created` is the default stage. Creation requires a valid normalized primary phone,
   products, budget, expected purchase date, source, and next follow-up timestamp.
2. At most one nonterminal *event* per phone in the chosen brand scope; historical events
   remain searchable. Decide whether cross-brand transfers count as the same event.
3. Completing a follow-up requires a new status and due timestamp unless the event is
   `Converted` or `Lost`. Overdue alerts go to a designated manager, with an audit trail.
4. Conversion requires selecting one or more verified SAP invoices. Store SAP IDs, currency,
   amount and retrieval timestamp; do not infer the matching invoice from phone alone.
5. After three calendar months, an eligible converted event starts a Retention event once,
   subject to the duplicate/consent rule. If the original salesperson is inactive, route
   to a configured fallback rather than silently creating an unowned lead.
6. The lead list displays the most recent *human* note (text, local date/time, author);
   adding a note updates the preview and full activity history without reopening the page.
   Do not mix private AI memory with human notes. Define note permissions and deletion policy.

## Open decisions from Bronet

- Which SAP edition and API/tenant are available? How are phone numbers linked to SAP
  business partners, and can invoices be split/refunded?
- What is the brand/store/user hierarchy, including CRE versus salesperson, transfers,
  shared customers and manager scope?
- What are the exact lead statuses, qualification rule, SLA thresholds, holiday calendars,
  and the meaning of “once” for the same phone across three brands?
- Which country/timezone/currency and marketing consent/retention policies apply to each brand?
- Which Meta assets (Pages, forms, ad accounts, pixels/datasets, WhatsApp accounts) belong
  to each brand? What email provider and verified sending domains will be used?

## Proposed delivery order

1. Approve the lifecycle, tenant boundary and SAP matching contract using real but
   redacted sample records; define reporting metric formulas.
2. Build configurable intake, phone/event gate, assignment and required follow-up workflow.
3. Add human lead notes and live latest-note preview; add SLA and retention worker.
4. Implement permissioned inter-brand transfer and SAP invoice linkage.
5. Add Meta Lead Form/Conversion API, consent-safe campaigns and attribution reports.
6. Test cross-organization isolation, concurrent duplicate creation, retries, invoice
   selection, opt-outs and dashboards before any pilot deployment.
