# CT102 fast release (snapshot installation)

CT102 is a snapshot without `.git`; **do not run** `release-safe.sh` there.
The dedicated `ct102-release` workflow uses the existing GitHub Actions Docker
build and immutable `sha-<commit>` image tag. CT102 pulls that image, takes a
fresh database/WhatsApp backup, applies the exact commit's idempotent baseline,
restarts **only** the app, checks both internal and public health, and restores
the previous app image if the switch fails. Database DDL is additive; database
restore is deliberately manual, never an automatic destructive rollback.

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

This is a **one-click release after checks**, not an instantaneous release or a
Docker container running the pipeline. Build/cache work happens on GitHub
runners; CT102 only pulls, migrates, and restarts. Existing self-host installations
continue to use the standard versioned release workflow.

## Failure handling

The script keeps each backup under `/opt/deskcommcrm/backups/ct102-*` and does
not prune earlier release backups. If app health or public routing fails, it
restarts the previously running app image. Check the database dump and
PostgreSQL migration error before trying again; do not restore a database over
new live writes without a separate recovery decision.

The Android APK is tested by CI but is **not** installed on employees' phones by
this web deployment. Distribute the signed APK/update separately after the
server release.
