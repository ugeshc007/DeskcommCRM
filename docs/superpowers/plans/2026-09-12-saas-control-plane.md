# Managed SaaS and shared control plane — phased execution plan

Authorization: the user requested a phased SaaS implementation and explicitly asked that the
phases be executed sequentially until completion. Base measured against `origin/main` at
`e142504d` on 2026-09-12. Work is isolated in worktree `.worktrees/saas-control-plane`, branch
`feat/saas-control-plane`. This plan does not authorize a production deployment, purchasing a
payment service, choosing prices on the user's behalf, or handling customer payment credentials.

## Product boundary

- Preserve the complete MIT self-hosted edition. SaaS behavior is additive and defaults off.
- First deliver a managed-SaaS pilot: the platform operator provisions and manages organizations,
  plans, billing state, and operational recovery from the existing platform console.
- The shared deployment continues to use the existing `organization_id` + RLS isolation model.
- Reuse the confirmed plan identifiers `standard`, `pro`, and `enterprise`. Prices, currencies,
  trial lengths, quotas, grace periods, and payment-provider choice are configuration, not invented
  business rules.
- Payment automation is attached through a provider-neutral contract. The first provider is
  `manual`, which makes the managed pilot operable without pretending an external payment was
  collected. A commercial gateway can be attached later without changing tenant data contracts.
- A single public HTTPS application URL receives WhatsApp callbacks. Existing per-channel path
  tokens remain the trusted organization boundary; SaaS billing data never selects webhook tenant.

## Phase 0 — evidence, safety, and architecture contract

Deliverables:

1. Audit current signup/provisioning, platform administration, suspension/reactivation, usage,
   billing placeholder, navigation, and deployment contracts.
2. Record the SaaS/self-host boundary and the provider-neutral billing model in this plan.
3. Start from current `origin/main` in a clean worktree; preserve the localization worktree.
4. Define the Living System edges before schema: platform admin/manual provider → subscription →
   tenant billing screen and entitlement evaluator; billing state changes → audit/event → platform
   tenant detail and tenant billing screen.

Exit gate: authoritative docs and current code measured; no business rule inferred from stale docs.

## Phase 1 — installation mode and platform-owner bootstrap

Deliverables:

1. Add a backwards-compatible deployment mode (`self_hosted` default, `managed_saas` opt-in) with
   validation and a visible platform-console indicator.
2. Keep public self-service signup configurable: existing behavior remains the self-host default;
   managed mode can require platform provisioning without deleting the signup path.
3. Bootstrap the requested platform owner through the canonical owner script. Login remains email
   based; no username-only or fake production identity is introduced. The supplied password must
   never enter source control, logs, plans, screenshots, or shell history.
4. Add tests proving old installations boot unchanged and managed mode is explicit.

Exit gate: existing self-host configuration still boots; platform owner has a confirmed email,
active tenant-admin membership, and active `platform_admins.scope = 'full'`.

## Phase 2 — provider-neutral subscription ledger

Deliverables:

1. Add tenant-aware `organization_subscriptions` (one current subscription per organization) and
   append-only `organization_billing_events`.
2. Reuse `standard|pro|enterprise`; support `manual` as the initial provider and opaque external
   customer/subscription references for a future adapter. Never store payment-card data.
3. Model lifecycle without inventing automatic punishment: `trialing`, `active`, `past_due`, and
   `canceled` are recorded states; only an explicit platform action changes organization suspension.
4. Add timestamps and optional, operator-entered limits as JSON with validated known keys. Missing
   limits mean “not enforced,” preserving self-host behavior.
5. Ship schema in the required triplet: versioned migration, idempotent baseline appendix, and
   MANIFEST entry. Add RLS and two-tenant invariants.

Exit gate: fresh install + update application pass on PostgreSQL 15; RLS proves no cross-tenant
read/write; platform service-role paths filter the organization explicitly.

## Phase 3 — platform billing operations

Deliverables:

1. Add platform-admin read/update endpoints for a tenant subscription with Zod, MFA/support-write
   policy, idempotency where appropriate, `ok()`/`fail()`, and explicit organization filters.
2. Every successful mutation writes `api_audit_log` and an append-only billing event in the same
   operation boundary; no secret or full external payload is logged.
3. Extend the existing tenant detail screen with plan, billing state, period/trial dates, limits,
   and a manual update form. Missing configuration is visible and actionable.
4. Surface `past_due` and canceled-period-end states in the platform notice workflow without
   automatically disabling customer service.

Exit gate: a full platform admin can update a tenant; read-only support and tenant users cannot;
the change is visible in tenant detail and in the audit/event history.

## Phase 4 — tenant billing screen

Deliverables:

1. Replace the `/app/settings/billing` placeholder with the active organization's plan, status,
   current/trial period, configured limits, measured usage, and support path.
2. Tenant admins can read only their organization. No payment method UI exists until a real gateway
   is selected and implemented.
3. Explain manual billing honestly. Never show a checkout button that cannot complete.
4. Add the missing-configuration state and recovery direction.

Exit gate: browser proof as tenant A and tenant B shows isolated values and useful empty states.

## Phase 5 — entitlements and usage guardrails

Deliverables:

1. Create a pure entitlement evaluator that combines deployment mode, billing lifecycle, optional
   plan limits, and current usage. It must fail open for self-hosted installations and fail visibly
   (not silently) when managed configuration is malformed.
2. Start with measurable resources already present: active members, connected channels, and monthly
   AI cost/usage. Limits remain nullable and operator-configured.
3. Apply guardrails at canonical creation boundaries, not only in the UI. Return actionable errors
   and create a platform-visible notice when a limit blocks an operation.
4. Do not interrupt existing conversations or scheduled customer contact automatically. Changes to
   limits affect future creations/usage; irreversible customer communication retains its existing
   channel gates.

Exit gate: unit, API, DB, and browser tests prove allowed/blocked paths, tenant isolation, visible
recovery, and unchanged self-host behavior.

## Phase 6 — payment-provider adapter boundary

Deliverables:

1. Define a server-only adapter contract for checkout/customer portal/webhook normalization without
   adding a mandatory paid dependency.
2. Implement the `manual` adapter and signed/idempotent normalized billing-event ingestion contract.
3. Keep concrete providers behind optional configuration. Adding Stripe, Paddle, Mercado Pago,
   Asaas, or another gateway requires an explicit provider decision and credentials supplied outside
   chat/source control.
4. Unknown, duplicate, stale, or out-of-order events are recorded safely and cannot regress a newer
   subscription state.

Exit gate: contract tests prove replay/idempotency/order behavior with synthetic events; no external
purchase or production webhook is claimed.

## Phase 7 — operations and deployment readiness

Deliverables:

1. Document a production topology for app, worker, scheduler, database, Redis, storage, email,
   public HTTPS, webhook routing, backups, restore drills, and secret management.
2. Add managed-mode health/readiness checks for subscription configuration and worker freshness.
3. Add runbooks for tenant provisioning, billing correction, suspension/reactivation, provider
   outage, backup restore, and compromised Meta credentials.
4. Preserve Docker image publication and self-host update behavior; new variables have safe defaults
   and appear in both `.env.example` and `lib/env.ts`.

Exit gate: shell/package gates pass and the managed configuration reports missing dependencies
before onboarding customers.

## Phase 8 — end-to-end launch gate

Deliverables:

1. Run typecheck, lint, channel lint, unit tests, shell tests, database invariants, build, and relevant
   Playwright journeys.
2. Prove through the frontend: platform owner login → create tenant → set subscription → tenant
   owner accepts invite → sees own billing → reaches a configured limit → sees recovery → platform
   admin resolves it → operation succeeds.
3. Update `docs/testing/user-journey-map.md`, the architecture JSON map, and a `.changes/` fragment.
4. Record what was measured locally and what still requires production infrastructure or a chosen
   payment provider. Never label synthetic webhook tests as external payment proof.

Exit gate: all repository-required checks relevant to the changed surfaces are green, visual
evidence exists, and the Living System checklist below is answered with concrete artifacts.

## Living System checklist — SaaS control plane

- **Input:** `scripts/bootstrap-owner.ts`, platform tenant creation, manual adapter, and future
  normalized provider webhooks feed `organization_subscriptions`.
- **Output:** entitlement evaluator, tenant billing page, platform tenant detail, suspension workflow,
  and operational notices consume subscription state.
- **Log:** `organization_billing_events` is the tenant timeline; `api_audit_log` records accountable
  human mutations. Both are shown in the platform tenant detail; tenant-safe state is shown in Billing.
- **Screen:** `/admin/tenants/[id]` for the operator and `/app/settings/billing` for tenant admins.
- **Door:** existing platform tenant navigation and existing Billing registry destination.
- **Anti-death:** past-due/missing/malformed configuration becomes a visible notice and recovery
  action; no silent worker return and no automatic interruption of live customer conversations.
- **Configuration:** platform tenant detail edits provider-neutral state and optional limits; missing
  provider configuration is explicit. Self-host default needs no billing configuration.
- **AI↔human continuity:** billing does not hand conversations between AI and humans; N/A by domain.
  Entitlement failures return structured, actionable errors to the human configuring the resource.
- **Feedback loop:** measured usage feeds the billing/limits view; blocked operations identify the
  exact limit and platform action that can resolve it. Operator corrections change the next decision.
- **Map:** add `docs/architecture/saas-control-plane.architecture.json` with subscription inputs and
  its tenant/operator/entitlement consumers.

