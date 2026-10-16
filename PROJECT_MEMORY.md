# Project memory — DeskcommCRM Field Sales worktree

Updated 2026-10-16. This is a dated map, not proof of current production behavior. Check the
repository, GitHub checks and the running installation before any release claim.

- This worktree carries the multi-tenant Field Sales Android module under `mobile/android`, its
  Next.js API and UI under `app/api/v1/field-sales` and `app/app/field-sales`, and Postgres
  contracts under `lib/field-sales`. Tenant IDs come from authenticated context; device keys
  are employee-scoped and revoked server-side.
- Attendance and GPS are saved encrypted on the device and synchronized through idempotent
  commands. The foreground location service requests fused high-accuracy fixes where available,
  with platform fallback. Offline queues, accuracy flags and server-side fresh-pin filtering are
  implemented; requested update intervals are not delivery guarantees.
- The Android source in this worktree changes off-duty start to project card → tracking notice →
  confirm. It queues punch-in and project selection atomically on the phone, then sends the two
  existing API commands in order. The home distinguishes pending sync, server-confirmed punch
  actions, and GPS start errors. Runtime location permission is requested on connected open;
  notification permission is separate and non-blocking. This source revision is Android
  `0.1.2-pilot` (code 3); the version number alone is not evidence of installation.
- The Field Sales route map colors recorded paths, isolated fixes, accuracy area,
  and reliable live pins by officer, with labeled route swatches. The route view can select
  one, several, or all visible officers for the date; multi-officer history is sampled at
  30-second buckets per officer and shown as distinct, non-joined paths. The Project cards list active
  assignments and officers with an open session on that project; attendance refreshes every
  15 seconds while the Projects tab is open. This describes source behavior in this worktree,
  not a deployed version. Route and live maps have a full-screen control.
- In this worktree's Live view, the existing self-hosted map appears before the officer list.
  Team and Attendance now use compact List rows only. The Live view officer list retains its
  Grid/List control. The route-and-visits preview defaults its shop visits to compact List rows,
  with Grid available. Display layout does not change attendance records or GPS pins. The provider remains
  the configured self-hosted basemap; 2GIS is advice only and has not been integrated.
- The optional field-voice image pins Transformers 4.48.3 in its build-only Kokoro prompt stage;
  Kokoro's unbounded dependency resolved to Transformers 5.19.0 in CI, which could not import
  AlbertModel with the stage's Torch 2.5.1. This image-build correction does not replace the
  running voice sidecar during the app-only CT102 release.
- The Android emulator CI job enables KVM access on Ubuntu before creating its API 35 AVD;
  the earlier runner lacked KVM permission and timed out booting before instrumented tests.
- Historical operational report checked on 2026-10-14: CT102 web app was released from commit
  `3ae49bfa9eae7bd00eca6915eaace4a78d255397` after its full GitHub test gate. This Android
  revision has **not** been installed on a physical phone or deployed by that fact. Verify the
  current live image and device state before claiming either.
- No customer bots or messages should be published/sent as part of Field Sales work. Live web
  changes require a green full GitHub gate for the exact release commit and CT102 guarded
  deployment with backup/rollback, as the user directed.
- On 2026-10-16, the full browser gate for `7e161e581` failed on a 5.5px sidebar overflow
  at 1280×900 and on a map canvas intercepting the full-screen exit control. The source
  corrections are local until a new commit and its complete gate pass; neither failure may be
  treated as a green release or evidence of CT102 deployment.
