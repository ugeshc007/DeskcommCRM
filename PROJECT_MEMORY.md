# Project memory — DeskcommCRM Field Sales worktree

Updated 2026-10-14. This is a dated map, not proof of current production behavior. Check the
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
- The Field Sales route map colors the selected recorded path, isolated fixes, accuracy area,
  and reliable live pin by officer, with a labeled route swatch. The Project cards list active
  assignments and officers with an open session on that project; attendance refreshes every
  15 seconds while the Projects tab is open. This describes source behavior in this worktree,
  not a deployed version. The map still loads a selected officer's path rather than overlaying
  every officer's full day at once.
- In this worktree's Live view, the existing self-hosted map appears before the officer cards.
  A Grid/List control changes the presentation of on-duty, connected-without-session, and
  off-duty cards without changing which records or GPS pins are shown. The provider remains
  the configured self-hosted basemap; 2GIS is advice only and has not been integrated.
- The optional field-voice image pins Transformers 4.48.3 in its build-only Kokoro prompt stage;
  Kokoro's unbounded dependency resolved to Transformers 5.19.0 in CI, which could not import
  AlbertModel with the stage's Torch 2.5.1. This image-build correction does not replace the
  running voice sidecar during the app-only CT102 release.
- The Android emulator CI job enables KVM access on Ubuntu before creating its API 35 AVD;
  the earlier runner lacked KVM permission and timed out booting before instrumented tests.
- Historical operational report from the prior task: CT102 web app was released from commit
  `31f7f05455eafb579ff750cfb255c842e438b745` after its full GitHub test gate. This Android
  revision has **not** been installed on a physical phone or deployed by that fact. Verify the
  current live image and device state before claiming either.
- No customer bots or messages should be published/sent as part of Field Sales work. Live web
  changes require a green full GitHub gate for the exact release commit and CT102 guarded
  deployment with backup/rollback, as the user directed.
