# Managed SaaS pilot runbook

Set `SAAS_DEPLOYMENT_MODE=managed_saas` only on the shared managed installation. The default
`self_hosted` keeps public signup and all product capabilities unchanged. Run the normal migration
triplet before enabling managed mode and confirm `/api/v1/health` reports `managed_saas: ok`.

## Provision and correct a tenant

1. Bootstrap a platform owner with `scripts/bootstrap-owner.ts`; use an email identity and MFA.
2. Create the organization from the platform tenant screen and send its owner invitation.
3. Open the tenant detail and create the manual subscription. Prices are handled outside this
   ledger; store no card details, access tokens, invoice payloads, or customer PII in references.
4. Correct a plan, state, dates, or optional limit from the same card. Every change is idempotent,
   creates a billing event, and is audited. Billing state never suspends service automatically.
5. Suspend/reactivate only through the existing explicit platform actions when an authorized human
   has made that separate operational decision.

## Recovery

- A limit error names the resource and current ceiling. Raise/remove the limit, then retry the same
  creation action; live conversations and already-scheduled contact are not interrupted.
- If the subscription schema health check is down, run the standard update procedure with both
  compose files, verify migration 0239/0240, and do not onboard tenants until it is green.
- During provider outage, continue the manual ledger. Never infer a successful payment from a
  queued or unverified provider event.
- Restore drills must restore database, storage, Redis-dependent work, and app secrets together;
  verify cross-tenant RLS and billing event history before reopening traffic.
- A compromised Meta token is revoked in Meta first, replaced through Connections, and never pasted
  into logs or tickets. Rotate webhook verification secrets if callback authenticity is uncertain.

Production also requires a public HTTPS hostname, database backups with tested restore, worker and
scheduler freshness monitoring, Redis, storage, transactional email, and one callback URL per
channel token. `localhost` is not a valid Meta callback.
