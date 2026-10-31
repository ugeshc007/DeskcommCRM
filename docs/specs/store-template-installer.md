# Store template draft installation

Status: draft installer implemented locally; focused database verification passed.
Full Phase 10 and release verification remain incomplete. Not deployed.

## Confirmed code behavior

The administrator entry is **AI → Follow-ups → E-commerce template**.
`StoreTemplateInstaller` loads organization-scoped channel/credential metadata from
`GET /api/v1/ecommerce-template`. No credential values are returned. Country comes
from `organizations.onboarding_state.welcome.country_code`; currency and time zone
come from the organization row. Missing regional facts block installation.

`POST /api/v1/ecommerce-template` requires current administrator access, rejects
support sessions and unknown input fields, and calls `installStoreDraft` using
authenticated organization/user IDs, never client-supplied authority.

The service uses one PostgreSQL transaction over existing generic CRM tables:

- Recheck and lock active administrator membership; lock the organization row.
- Reuse a previous receipt only after checking ownership of every referenced resource.
- Check channel and optional AI credential ownership and provider compatibility.
- Create a separate non-default Sales pipeline and seven English stages.
- Create an inactive MCP agent and an unpublished version with catalogue search,
  English instructions, handoff enabled and explicit policy/price/stock safeguards.
- Create a manual, draft Store enquiry flow. No enrollment or publication occurs.
- Save an installation receipt in organization settings, preserving other settings.
- Write `ecommerce.template_installed` to the audit log in the same transaction.

Name collisions fail and roll back rather than replacing existing resources.
Concurrent installs serialize on the organization row. SQL statements and lock waits
are bounded. The audit record appears in the existing audit viewer.
No new niche database tables or migrations are introduced by this installer.

The setup form includes categories, additional currency codes, domestic-only or
international coverage, explicit flat/manual courier rules, optional free-delivery
thresholds, payment preferences and five policy FAQs. Delivery preview uses the
same pure validated calculator tested in `delivery.test.ts`: missing, conflicting,
unsupported or manual rates produce review, never an invented/free quote.
Configured policies become the draft agent prompt and can be edited in that editor.

## Important limits — Phase 10 is not complete

This is an enquiry template, **not an order processor**. Category/product/quantity/
destination/payment preference are captured as session variables. The final AI
review is instructed to verify facts; completing the flow is not order/payment proof.

- No products, prices, stock or business policies are fabricated by installation.
- `productTemplateSchema` describes the requested variant/media shape but does not
  yet persist a full variant catalogue or implement multi-currency product prices.
- Courier preview is not a carrier booking, tax calculation or agent tool yet.
- No checkout, stock reservation, abandoned-cart enrollment or payment reminder
  is installed. Those require authoritative cart/order/payment state and channel
  window/consent checks. The draft does not pretend these are working.
- AI model/credential readiness is checked by the existing publication controls,
  not by a paid provider call during draft installation.
- Full authenticated E2E, broader PostgreSQL isolation tests, Messenger and final
  release verification must pass before declaring the requested stages complete.

## Verification

Focused form, route, delivery and simulator tests use synthetic data. The local
Chromium fixture `/store` renders the actual component with mock API responses,
not a live installation. Desktop and 390px mobile were visually inspected; no
horizontal page overflow was observed. The visual check found and corrected an
API envelope mismatch that the first form mock had missed; the mock now follows
the real `{data: ...}` response contract.

On 2026-09-18, 39 focused store/palette/API tests passed, followed by the repeatable
synthetic browser check (including delivery preview and draft review links).
The database harness passed 17 tests across store installation, integration ledger
and connection management, with baseline fresh install and repeat update passing.
Installer tests exercise concurrent retries, draft-only state, preservation of
pre-existing default stages, transaction rollback, revoked/foreign administrator
access, foreign channels, missing region and forged cross-organization receipts.
They use ephemeral PostgreSQL and synthetic identities, not production records.

The broader 2026-09-18 unit regression run completed with 8,752 passing tests
across 844 files and zero failures. The production build, final TypeScript check,
channel-boundary lint and permission-rank lint passed; full ESLint had zero errors
and 350 warnings. The channel translation/test-boundary adjustments and the final
installer contract tests were additionally checked in focused runs. This is not
authenticated end-to-end or live-provider evidence, and does not mark the remaining
Messenger, checkout or publication requirements complete.

The full PostgreSQL run reported 1,559 passes, two failures, one expected failure
and one skipped test. The failures were the dedicated-RLS-proof registry and a
calendar fixture using database `now()` against the host clock. The registry now
cites the dedicated tests, secret-table tests additionally attempt real denied
SELECTs under browser roles, and the retry fixture is explicitly due in the past.
The five-file rerun passed all 100 tests, including fresh install/repeat update.
This focused correction is not a claim that a second full database run occurred.

The installer validator suite also passed in disposable Linux after correcting
release selection: `head -1` could close a pipeline early and, with `pipefail`,
discard the valid version. The replacement consumes the stream and a 20,000-tag
fixture covers the failure. The Windows update-guard permission assertion cannot
prove Unix mode 600; that update-guard suite passed separately under Linux.

Living System: account settings feed the setup form; the transaction feeds the
agent editor, pipeline settings, flow builder and audit viewer. Success links open
those editors. Failures stay visible with retained fields; retries reuse the
receipt. No live customer demand exists until explicit later publication, so the
installer does not schedule outreach or claim human handoff delivery.
