# Project memory — DeskcommCRM Field Sales worktree

Updated 2026-10-21. This is a dated map, not proof of current production behavior. Check the
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
- In this worktree, `field_sales_employees.route_style_index` is allocated once per officer
  and organization under a transaction-scoped lock. Existing officers are backfilled by the
  optional 0694 migration. Live positions and retained GPS history render the same stable
  color/pattern without rewriting location records; the route legend can emphasize one
  officer while dimming others. The CT102 app-only deploy adapter includes this migration
  after its database backup. This is source behavior until the exact release passes CI and
  the guarded deployment is independently verified.
- In this worktree's Live view, the existing self-hosted map appears before the officer list.
  A Route history checkbox on the workspace Live view requests and draws the selected day's
  authorized officers' retained GPS paths together, with distinct colors and quality filtering.
  Team and Attendance now use compact List rows only. The Live view officer list retains its
  Grid/List control. Team rows show online officers first, then names alphabetically, and
  punch-in/out values include the organization-local calendar date and time. The route-and-visits preview defaults its shop visits to compact List rows,
  with Grid available. Display layout does not change attendance records or GPS pins. The provider remains
  the configured self-hosted basemap; 2GIS is advice only and has not been integrated.
- On 2026-10-16, a follow-up UI fix connected the embedded map's full-screen control to
  the enclosing Route and visits dialog. Without this, the dialog's transformed position
  constrained the map to a centered rectangle rather than the viewport. The browser test
  now checks viewport-sized dialog and map bounds, and verifies return to dialog size.
- The optional field-voice image pins Transformers 4.48.3 in its build-only Kokoro prompt stage;
  Kokoro's unbounded dependency resolved to Transformers 5.19.0 in CI, which could not import
  AlbertModel with the stage's Torch 2.5.1. This image-build correction does not replace the
  running voice sidecar during the app-only CT102 release.
- The Android emulator CI job enables KVM access on Ubuntu before creating its API 35 AVD;
  the earlier runner lacked KVM permission and timed out booting before instrumented tests.
- Operational report checked on 2026-10-17: CT102 web app was released from commit
  `9d5b3f6a9438eeb612b6065ef1a011e6fd109da3` after its full GitHub test gate and
  required production review. Public health reported this version (with a pre-existing
  degraded status). This does not include the route-style migration described above or
  install an Android build; verify current live image and physical device state before claiming either.
- No customer bots or messages should be published/sent as part of Field Sales work. Live web
  changes require a green full GitHub gate for the exact release commit and CT102 guarded
  deployment with backup/rollback, as the user directed.
- In this worktree, manual team invitations have the same 24-hour signed-token lifetime for
  field officers, viewers, agents, managers and admins. When invitation email is not delivered,
  a tenant admin verifies the recipient offline and shares the private link; a persisted,
  pending row with matching organization, email, role, interface, and expiry is required before
  the no-email account is created. The inviting UI warns that possession of a manager/admin link
  can claim that role. This is source behavior, not a live deployment claim.
- In this worktree, Attendance also has a per-officer monthly list and Excel export. It uses the
  existing daily attendance calculation for every organization-local date, includes full local
  check-in/check-out timestamps and no-punch days, and does not include GPS or leave notes.
  A shift crossing midnight counts in full on its local check-in date, while showing the
  actual next-day checkout timestamp; prior calendar-day splitting made a noon-to-00:30
  shift appear as only 30 minutes on the checkout date.
  Field officers are limited to self, while managers/admins can select enrolled staff. The
  export records an audit event. This is source behavior until the exact commit passes the
  required test gate and CT102 deployment is independently verified.
- The earlier browser failures on `7e161e581` (sidebar overflow and full-screen exit
  control interception) were corrected before the `ef19402` release. A later manual
  screenshot revealed the separate transformed-dialog full-screen constraint above.
