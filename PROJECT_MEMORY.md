# Project memory — DeskcommCRM Field Sales worktree

Updated 2026-09-26. This is a dated map, not proof of current production behavior. Check the
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
- Historical operational report from the prior task: CT102 web app was released from commit
  `31f7f05455eafb579ff750cfb255c842e438b745` after its full GitHub test gate. This Android
  revision has **not** been installed on a physical phone or deployed by that fact. Verify the
  current live image and device state before claiming either.
- No customer bots or messages should be published/sent as part of Field Sales work. Live web
  changes require a green full GitHub gate for the exact release commit and CT102 guarded
  deployment with backup/rollback, as the user directed.
