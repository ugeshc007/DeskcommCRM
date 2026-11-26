---
type: operational-memory
date: 2026-09-24
status: deployed-ct102
release_commit: b9373bfc4179023f53ae31a177f4c974b4fbea1a
---

# Project memory — Field Sales release and current development

This is a **dated checkpoint**, not a continuously updated production dashboard. `CONFIRMED`
means checked against code, CI, the deployed server, or the connected phone on 2026-09-24.
`PENDING` means the check or product contract is still outstanding. Read `CLAUDE.md`, the
linked specifications, and fresh CI/server results before the next release. No customer
passwords, device credentials, private coordinates, or access keys belong in this file.
This checkpoint maps the current work and points to the canonical project documents; it
does not duplicate every function or claim that older documentation is current.

## Sources of truth

| Area | Current source |
|---|---|
| Repository rules, tenancy, migrations, release gates | `CLAUDE.md`, `AGENTS.md` |
| Field Sales behavior and uncertainty | `docs/specs/field-sales-tracking.md` |
| Android build, tracking behavior, physical test checklist | `mobile/android/README.md` |
| CT102 guarded release and rollback | `docs/runbooks/ct102-release.md` |
| STORIES/ZODIYA business decisions and unresolved contracts | `docs/requirements/bronet-group.md` |
| Earlier release-acceleration decisions | `docs/handoffs/2026-09-21-release-acceleration.md` |

## Release checkpoint — CONFIRMED

- The fork branch `ugesh/codex/ct102-release-speed` carried release commit
  `b9373bfc4179023f53ae31a177f4c974b4fbea1a`. The required CI `verify` and
  `invariants`, production build, full E2E, Docker image, and Android unit/emulator checks
  all passed for that exact commit before deployment. The green runs were CI `36029379195`,
  build `36029379194`, E2E `36029379205`, image `36029379262`, and Android `36029378929`.
- CT102 is a snapshot installation without `.git`. The guarded `ops/ct102/deploy.sh` adapter
  took a fresh database and WhatsApp backup, applied additive migrations 0383, 0384, 0385,
  and 0388, reused its already healthy private voice sidecar, switched the app to the pinned
  image for the exact commit, and passed internal health. The backup is under
  `/opt/deskcommcrm/backups/ct102-20260924-174849-b9373bf`. No rollback was needed.
- Public `/api/v1/health` returned HTTP 200 and version `b9373bf`. Supabase, Redis, WAHA,
  managed SaaS, billing webhook, and worker checks were `ok`. Overall `degraded` came from
  the already unconfigured managed-host agent. The protected `/app/field-sales` route returned
  the expected unauthenticated redirect. The full E2E Field Sales UI gate passed; direct
  authenticated **production browser rendering was not verified** because the desktop browser
  automation kernel failed to start.
- Migration 0388's raw GPS metadata and configurable quality columns were checked in the live
  schema. The release does **not** imply that every other migration present in the repository
  was applied to CT102.
- The locally built `mobile/android/app/build/outputs/apk/debug/app-debug.apk` is Android
  version `0.1.1-pilot` (code 2), SHA-256
  `E1EC3FA76F81118D0259C79AAF32D289624313D64EEF54234FDE39493646344E`.
  It is a **debug pilot APK**, not a signed distribution release. Local assemble, Android
  unit tests, and lint passed. `adb install -r` updated the authorized Samsung SM-A536E
  without clearing its app data.
- After that update, the Samsung had an active work session and a running location foreground
  service. The live database received fresh GPS records, and the current server rules judged
  the officer online with a fresh, pin-eligible fix (reported accuracy radius about 16 m at
  the time of the check). This confirms upload and eligibility, not exact physical accuracy
  or production browser marker rendering.

## Function map — CONFIRMED by code

| Responsibility | Entry point or implementation | Invariant to preserve |
|---|---|---|
| Attendance and location ingestion | `lib/field-sales/attendance.ts`: `recordAttendance`, `recordLocations` | Authenticated employee and organization scope; session interval; stable sample ID and fingerprint on replay. Trusted mobile uploads may rebase a colliding **server** sequence while retaining the original `device_sequence`. |
| Device authorization | `lib/field-sales/devices.ts`: `authenticateFieldDevice`, pairing, revoke functions | Pairing is short-lived; bearer hash and revocation are checked; no body-supplied tenant identity. |
| Android acquisition | `mobile/android/app/src/main/java/com/fieldcrm/sales/TrackingService.java` | User-started, visible location foreground service; fused high-accuracy updates where supported; fresh measured fixes, explicit stop, no force-stop bypass. |
| Fix validation | `mobile/android/app/src/main/java/com/fieldcrm/sales/GpsQuality.java` | Monotonic age, duplicate/order/jump and accuracy flags; raw coordinates retained; stationary jitter must not become travelled distance. |
| Offline queue | `mobile/android/app/src/main/java/com/fieldcrm/sales/SyncEngine.java`, `SecureState.java`, `SyncJobService.java` | Encrypted local queue, stable IDs, bounded retries, no deletion before acknowledgment; network-only background job never starts GPS. |
| Live view and route | `lib/field-sales/operations.ts`: `readFieldOperations`; `lib/field-sales/route-quality.ts` | Online and on-duty status is separate from reliable GPS. Current pin requires a recent credible fix; historical/uncertain points remain distinguishable. |
| CT102 release | `ops/ct102/deploy.sh`, `ops/ct102/rollback.sh` | Exact image revision and green gate; fresh backup before migration; app rollback available; preserve proxy/voice configuration. |

The backend queue fix addressed an actual collision between a re-paired phone's local GPS
sequence and records already stored for the same session. Before the fix, a phone could be on
duty and collecting points while the server rejected its queued upload; a manager then saw no
fresh pin. The new ingestion path does not discard the original reading or weaken replay and
tenant checks. Map quality controls also avoid presenting an old or low-quality reading as a
current exact position. A displayed radius is the device's reported uncertainty, not proof of
building-level accuracy.

## What is still pending

- **Physical GPS validation:** measured open-sky, urban-canyon, indoor, screen-off, connectivity
  loss, permission-change, and multi-hour battery tests. The checklist is in the Android README.
  No one-metre or five-metre field accuracy has been measured. Filtering/ML remains disabled
  until a reference route demonstrates a benefit.
- **Android release distribution:** sign a release APK and test update compatibility and
  background behavior on the intended fleet. The current debug APK is for the pilot.
- **Production visual check:** inspect the authenticated Field Sales map in a working browser
  and confirm marker, radius, route, and status against a fresh device fix. Database pin
  eligibility and CI browser tests do not replace this observation.
- **Bronet/STORIES/ZODIYA:** the business decisions and implementation gaps are recorded in
  `docs/requirements/bronet-group.md`. Do not infer that its wider workflows are live because
  migration 0387 and related code exist in the repository: CT102's guarded release applied
  only the four migrations listed above. SAP invoice webhook payload/authentication, catalogs,
  stage mapping, and outbound campaign consent/controls still require agreed contracts. Do not
  publish bots or send campaigns as part of this work.
- **CT102 release automation:** the `ct102-production` GitHub Environment and secrets were
  not configured at this checkpoint, so this deployment used the guarded adapter manually
  after checking the exact-SHA gate. Future operators must confirm the environment and release
  workflow state rather than assuming the manual run made one-click deployment available.
- **Commit identity:** a later documentation-only commit on this branch does not change the
  deployed app, which remains `b9373bf`. The next application deployment still requires a
  full green gate and image check for its own exact release commit.

Tenant account and organization-name changes made through the live administration surface
are deliberately excluded from this public repository memory. Keep any such audit record in
the authorized private system; never commit passwords, account identifiers, or backup contents.
