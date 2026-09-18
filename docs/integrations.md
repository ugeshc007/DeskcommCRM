# Integrations — Phase 7

Implemented locally; not deployed. Provider data actions listed for Phases 8/9
are not enabled by connecting a Google account.

## Organization administrator

1. Open **Integrations** from the CRM navigation.
2. For **Signed webhook**, choose Add connection, name it, and supply an HTTPS
   endpoint and a signing secret (at least 16 characters). No secrets in URLs.
3. Save, then choose Test and confirm. Only a synthetic event is sent. Successful
   testing activates this revision. It does not publish a bot.
4. In the builder, add **Integration action**, select the tested connection and
   Send event, map Event name and Value to send, and connect Success and Error.
5. Save the draft and use the normal publication process after testing.

The receiver must verify the HMAC-SHA256 of the exact JSON request body against
`X-Integration-Signature` (`sha256=<hex>`), and deduplicate `X-Idempotency-Key`.
The body is `{ "id": "stable-action-id", "data": { "event": "...", "value": "..." } }`.
Only explicitly mapped fields are transmitted. Private/loopback/link-local IPs,
non-HTTPS URLs, query-bearing URLs and redirects are rejected. DNS is pinned for
the outbound request. A timeout or non-success HTTP response may have produced
an effect: inspect the destination; the CRM will not automatically resend it.

Rotate/reconnect creates a new revision and requires testing. Select the new
revision in affected drafts before publishing. Disconnect removes local secrets
and stops future uses; it cannot cancel an already in-flight request or revoke
access in the external provider. Remove the app at Google as well to revoke its grant.
History displays status only, never payloads, tokens or provider response bodies.

## Installation administrator: Google OAuth

Configure a Google OAuth **web application** with this exact redirect URI:
`https://YOUR-CRM-DOMAIN/api/v1/integration-connections/oauth/callback`.
Set `INTEGRATIONS_GOOGLE_CLIENT_ID` and `INTEGRATIONS_GOOGLE_CLIENT_SECRET`
server-side and ensure `NEXT_PUBLIC_APP_URL` matches that domain. The existing
`AI_CRED_AES_KEY` must be configured securely for the vault. Never commit values.
Scopes: `openid` and `https://www.googleapis.com/auth/spreadsheets`.
Google consent publication/verification and allowed test users are operator tasks.

An organization administrator chooses Connect Google account and grants access
for their account. State is bound to an HttpOnly browser nonce and consumed once;
current administrator membership and connection revision are rechecked before save.
Reconnect repeats consent. Test refreshes expired access server-side when possible;
revoked grants require reconnect. Spreadsheet read/write actions arrive in Phase 8.

## Verification boundary

Database tests use disposable PostgreSQL and synthetic identities. Adapter/OAuth
unit tests mock remote requests. The visual fixture uses synthetic metadata and
does not prove authenticated API-to-provider delivery. Real consent, authenticated
cross-organization end-to-end checks and deployment are release gates, not claimed
by the local screen preview. No customer bot is automatically published.
