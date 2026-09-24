# CT102 fast release (snapshot installation)

CT102 is a snapshot without `.git`; **do not run** `release-safe.sh` there.
The dedicated `ct102-release` workflow uses the existing GitHub Actions Docker
build and immutable `sha-<commit>` image tag. CT102 pulls that image, takes a
fresh database/WhatsApp backup, applies the release's versioned, idempotent
migrations in one transaction, starts the private voice sidecar, then restarts **only** the app among existing services. CT102 checks internal
health; the GitHub runner checks public health and calls `rollback.sh` if that
probe fails. CT102 cannot reach its own public hostname reliably. Database DDL
is additive; database restore is deliberately manual, never an automatic
destructive rollback. Do not replay the entire baseline on this snapshot:
`platform_meta_webhook` belongs to `supabase_admin`, not the schema URL's
`postgres` role, so the update fails at `COMMENT ON TABLE`.

## One-time authorization (repository administrator)

1. In the repository, create the `ct102-production` Environment with a required
   reviewer. Restrict it to `codex/ct102-release-speed` until this deployment
   branch is deliberately retired. Do not enable unreviewed automatic release.
   GitHub only displays a manual `workflow_dispatch` workflow after its YAML
   exists on the repository's default branch; merge this workflow there before
   expecting the Actions → Run workflow button to appear.
2. Add these **Environment secrets**, never repository files or chat messages:
   `CT102_HOST` (Proxmox host), `CT102_USER` (`root` for `pct exec`),
   `CT102_SSH_PRIVATE_KEY` (a dedicated deploy key), and
   `CT102_SSH_HOST_KEY` (a pinned `known_hosts` line, verified against the host
   fingerprint out of band). Limit the key to the release host and rotate it
   if its custody is uncertain.
3. Confirm the Proxmox host accepts that key and can run `pct push` and
   `pct exec 102`. CT102 must retain its private `.env`, both existing Compose
   files, `docker-compose.ct102.map.yml`, and the read-only UAE map archive.
   The workflow copies no credentials to GHCR or the repository.

## Release

Push the branch. GitHub runs `verify`, `invariants`, `build-and-size`, `e2e`,
`imagens-ok`, and Android checks in parallel. Once **all** pass for the exact
commit, open Actions → `ct102-release` → Run workflow on
`codex/ct102-release-speed`. An environment reviewer approves it. The workflow
refuses a missing/failed/cancelled check or mismatched image revision. It does
not rebuild on CT102. The local app and migration can be prepared while CI is
running, but the production switch must wait for a green gate.

This workflow currently carries migrations `0383`, `0384`, `0385`, and `0388` for Field Sales
device presence, project customers, activity notes, and location quality. Before a later release with schema changes, update the explicit
migration file in the workflow and deploy script; do not assume the old file
covers a new schema. This is a **one-click release after checks**, not an
instantaneous release or a Docker container running the pipeline. Build/cache
work happens on GitHub runners; CT102 only pulls, migrates, and restarts.
Existing self-host installations continue to use the standard versioned
release workflow.

This app-only correction keeps the existing private speech sidecar. The workflow
reads its pinned digest from CT102; `deploy.sh` requires that exact container to
be healthy and leaves it running. It still verifies the new app's exact commit,
takes a fresh backup, applies the additive migrations, and retains app rollback.
The eighth `deploy.sh` argument is the exact location-quality migration path.
If the release fails, the newly started voice container is stopped along with
restoring the previous app image. Confirm CT102 memory headroom for the 1536 MiB
container limit before approving the production environment.

## Failure handling

The script keeps each backup under `/opt/deskcommcrm/backups/ct102-*` and does
not prune earlier release backups. If app health or public routing fails, it
restarts the previously running app image. Check the database dump and
PostgreSQL migration error before trying again; do not restore a database over
new live writes without a separate recovery decision.

The Android APK is tested by CI but is **not** installed on employees' phones by
this web deployment. Distribute the signed APK/update separately after the
server release.
