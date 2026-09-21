# Field Sales & Project Tracking — implementation contract

Status: Field Officer/Team is deployed on CT102. Six-digit pairing requires migration 0320 and the matching app image; verify the installed schema and health version before claiming it is available. Evidence, not phase names, determines completion.

## Pairing revision — 2026-09-21

- The Android APK has the CRM HTTPS origin compiled in. Its fresh connection screen asks only
  for six digits; the URL is not editable. A clone using another domain must build its APK with
  that domain, and must never treat the URL as a secret.
- Team → Field Officer → Android keys issues a random six-digit code, valid for five minutes and
  a single exchange. The public exchange endpoint is globally and per-IP rate-limited. The
  database stores an HMAC of the code, not the digits. After an atomic exchange the phone stores
  a separate random 256-bit bearer in Android Keystore; the server stores its SHA-256 hash.
- An issued code does not start GPS. Expiry, revocation and current employee membership are
  checked before exchange. Existing strong device credentials remain valid.
- A six-digit code is not suitable as a permanent API credential. If the CRM domain changes,
  the APK must be rebuilt before newly paired devices can connect.

## Previous release checkpoint — 2026-09-21

- Team offers a `Field Officer` role below Viewer in CRM
  permissions. Administrators create and revoke one-time Android keys against accepted
  Field Officer members from **Team → Members → Android device keys**. Key issuance explicitly
  enrolls that employee but never starts GPS. Existing legacy self-service API remains for
  previously enrolled agents/managers, while the Field Sales workspace no longer advertises
  that tab. Revoked invitations can be archived from the Team list, retaining the revoked
  database row so the signed URL remains invalid. This release is live on CT102.

- Staff setup without an email gateway uses the CRM's private invitation link. Only a persisted,
  pending, undelivered viewer/agent invitation can enroll a new account without email confirmation;
  possession of the privately shared link is the enrollment proof, not proof of mailbox ownership.
  Expired, revoked or accepted invitations are refused. The employee
  chooses their own CRM password. An enrolled employee then creates and copies a one-time
  Android device key from an administrator in **Team → Members**. In that release, the Android app
  required a long bearer; the pairing revision above replaces that entry with a short-lived code.
  An account is created only when
  the invited person submits the password form; a device key is created only on request.

- Android's connected home is intentionally limited to today's real assigned-project selector,
  Punch In and Punch Out. Visits, photos, breaks, manual reconnect and manual work actions are
  no longer exposed on the home screen; background GPS and retry remain automatic.
- A colorful, high-contrast native UI adds compact notification and profile icons. Notifications
  show redacted sync state; Profile shows the employee and organization time zone. Sign-out is
  allowed only off duty with empty queues, revokes the device credential on the server first,
  and never erases uncertain local work.
- Punch-in now carries the selected organization-scoped project, schedule and local date. The
  server verifies that exact occurrence for the authenticated employee before opening a session.
- CRM Live view shows every explicitly authorized salesperson's latest position. Selecting a
  marker or person loads that employee's route for the chosen organization-local date, split at
  separate sessions, long gaps and mock-location boundaries. No Google Maps key or token is used.
- The release passed focused Team and Field Sales browser journeys and its database checks.
  The full browser CI run timed out; that is not a claim of full-suite coverage.

Older checkpoints below are historical evidence and may describe controls that the simplified
2026-09-20 mobile home intentionally removed.

## Verified development checkpoint — 2026-09-18

- Optional module schema, authority, attendance, calendar and hashed device credentials exist
  in the development branch. Device revocation is rechecked under row lock inside each
  transaction; browser query caches are keyed by organization and actor.
- CRM My Android devices screen creates one-time keys and confirms revocation. Browser
  visual/E2E proof remains pending; source code is not evidence of finished UX.
- Android debug APK compiled, unit tests passed, lint reported zero errors (SDK-version
  warnings remain). Samsung SM-A536E / Android 16 connected through authorized ADB.
- Real-device smoke verified connection controls, no off-duty GPS, Keystore encryption,
  non-plaintext preferences, and four synthetic offline attendance events. The test uses
  isolated test preferences, no real account, no GPS permission and no coordinates.
- The network-only retry job is scheduled on app launch. A missing network-state permission
  caused an Android 16 startup crash during testing; it was fixed and the scheduled-job
  assertion and device smoke passed afterward. Locked-screen/battery timing is NOT proven.
- Focused TypeScript/unit checks: 50 cases across contracts, retention and existing retention
  regressions passed. Focused PostgreSQL checks: 9 passed, including fresh baseline INSTALL
  and idempotent UPDATE, device ownership/revocation and per-organization retention.
- Daily data-retention cron now consumes the bounded GPS cleanup function. It uses each
  organization's policy, leaves attendance intact and audits only deleted counts.
- No production deployment or organization activation; live CRM unchanged. All full-phase
  completion gates below remain open, including complete operational workflows and pilot.

## Development checkpoint — 2026-09-19 (not released)

- Calendar occurrence edits and future-series splits preserve recorded visit history.
- Manager activity includes scoped current positions and historical route lines. No road
  tiles are requested until an administrator configures approved same-origin tile hosting.
- Travel/arrival/completion/skip commands have idempotent receipts and ownership checks.
  Android has these controls, outcome notes, next-action date/time pickers and an explicit
  retry for uncertain visit submissions. Full offline visit sequencing is not implemented.
- Correction requests need independent scoped approval; reporting shows corrections
  without extending original GPS capture intervals. Date inputs use organization time.
- Manager visibility has configuration, a current-grants list and revocation even after
  a staff member becomes inactive. Grants are never implied by the generic manager role.
- Android build, unit tests and lint completed; five lint warnings remain. Updated APK
  installed on the Samsung and synthetic off-duty/encryption/attendance smoke passed.
- New local-only Playwright journey exercises assignment and activity screens. Initial
  execution found dropdown labels including option text; field labels were separated
  from their controls. The latest production-build rerun passed, including a minimum
  calendar-card width and a 390px viewport overflow check. Synthetic screenshots are
  retained under `.superpowers/evidence/field-sales-20260919/`.
- Focused checks now pass: 31 unit/CI-registration cases, 15 database invariants with
  fresh INSTALL and idempotent UPDATE, strict TypeScript, targeted lint and Next build.
  Database tests include tenant deletion without affecting another tenant, restricted
  history deletion, manager revocation, visit ownership and correction independence.
- Migration 0315 repairs optional-table lifecycle ownership. Installer applies it through
  `fn_provision_field_sales_lifecycle()`; it does not activate tracking or enroll anyone.
- Android collection now checks enabled organization policy at service start and each
  sample, preventing Resume GPS from bypassing a policy already disabled during sync.
- Photos, next-action task/reminder integration, complete reports/exports, map tile hosting,
  full offline recovery, real GPS/battery pilot and production release remain pending.

## Confirmed requirements (2026-09-18)

### Additional development checkpoint — 2026-09-19

- Mobile GPS ingestion now returns per-sample rejection receipts for expired/out-of-session
  records. Valid samples continue; Android removes only explicitly acknowledged records,
  drains up to ten batches per sync, and shows rejection reasons without retaining expired
  coordinates. Other conflicts still require recovery; full offline visit sequencing is pending.
- Daily CSV export uses existing employee/manager scope, audits export, excludes coordinates
  and visit notes, neutralizes spreadsheet formulas and clips closed attendance spans to the
  organization day. Breaks are included; this is not a payroll report. UI download E2E rerun pending.
- Same-origin raster tile serving is implemented with authenticated access, bounded XYZ paths,
  MIME checks and a read-only directory contract. No live dataset or server volume is installed.
  Runbook: `docs/runbooks/field-sales-maps.md`. Map hosting is not complete without that dataset.
- Focused recovery DB suite passed 16 cases on fresh baseline INSTALL/UPDATE. Report/map unit
  suite passed 12 cases. Android build/unit/lint passed; hardware pilot explicitly authorized.
- Samsung hardware pilot: foreground service and visible notification ran, and punch-out
  stopped collection. ZERO GPS samples were received within the test, so real GPS capture,
  locked-screen behavior and battery endurance remain unverified. Pilot was accountless,
  used only encrypted phone storage, printed no coordinates and restored previous test state.
- User requested a live device key for info@bebright.ae. None created: module is undeployed
  and the in-app browser backend was unavailable. Never substitute a local-test credential.
- Photos, reminders/task completion, full offline recovery and release verification remain.
  Nothing deployed; live CRM data and credentials unchanged.

### Follow-up lifecycle checkpoint — 2026-09-19

- Optional migration 0316 adds next-action completion time/actor without replacing the
  original action or due date. Installer now provisions through this forward-only upgrade.
- CRM overdue reminders have confirmation, preserved history, optimistic revision checks
  and one audit event for a completed action; replay does not create another completion.
- Android reads own overdue actions even outside the currently cached week. Completion
  intents are encrypted, account-bound and retried with the original revision. Failed
  completion retries do not prevent GPS queue progress or calendar refresh. Explicitly
  stopping a retry does not undo any completion already accepted by the server.
- Device keys cannot use manager scope for another employee's next action. Browser manager
  access still requires the explicit manager grant; cross-organization access is rejected.
- These are in-app reminders. Scheduled push/email reminders and photos remain pending;
  no customer communication is automatically sent. Not deployed; live key not created.
- Verification: production build, TypeScript and targeted lint passed; 17 PostgreSQL
  invariants passed on fresh INSTALL and repeat UPDATE, including a manager device-key
  scope denial. Local Playwright passed the reminder confirmation, saved completion,
  daily CSV download/audit and 390px no-overflow checks. Android build/unit/lint passed.
- Repeat consented Samsung pilot received one real GPS sample, confirmed the visible
  notification and no collection after punch-out. No additional fix arrived during the
  stationary break interval. No live account/network was used; original phone test state
  was restored afterward. This does not prove locked-screen/network delivery or battery life.

- Build on the currently deployed fork (runtime c11c814, test-only follow-ups through
  bd045e9f). User explicitly deferred merging original upstream on 2026-09-18.
- Android application; initial capacity target 25 salespeople, not a licence limit.
- GPS starts at punch-in, continues during declared breaks and when changing projects,
  and stops immediately at punch-out. No hidden or off-duty collection.
- Multiple projects and multiple scheduled assignments per person/day. Weekly recurring
  schedules, plus one-off visits; project identity is independent of an occurrence.
- Country comes from the organization's CRM configuration, NOT the device or developer.
  Current source: organizations.onboarding_state.welcome.country_code; time zone:
  organizations.timezone (confirmed in app/actions/onboarding/acceptWelcome.ts).
  Missing/invalid region prevents activation; countries with several zones are not guessed.
- MapLibre/OpenStreetMap-derived maps, no Google Maps SDK, API calls or AI tokens.
  Tile hosting still costs resources and requires an approved provider/attribution.
- English UI and organization isolation through every layer.

## Final phases and acceptance gates

| Phase | Deliverables | Completion evidence | State |
|---|---|---|---|
| 1 Foundation | Scope, authority, region, session/variable contracts, security and data model | Contract tests; cross-organization design and map | In progress |
| 2 Calendar | Projects/sites; daily/week views; one-off/weekly assignments; exceptions; revision checks | Scheduling, DST, overlap and recurrence edit tests; browser proof | In progress |
| 3 Android | Secure device connection; Today/Week; assignment details; notifications and local queue | Installable APK; login/revocation/offline tests | In progress |
| 4 Attendance | Punch-in/out; break/resume; corrections; immutable audit | Concurrent punch/idempotency tests; mobile proof | In progress |
| 5 Tracking | Visible foreground service; encrypted offline points; retries; permission/battery status | Locked-screen, offline, punch-out and restart tests on real devices | In progress |
| 6 Manager map | Latest authorized positions; stale/accuracy badges; route replay; scoped filters | Map attribution/cost controls; no cross-org or off-duty points | In progress |
| 7 Visits | Travel/arrival/departure; project progress; notes/photos; next action | Scoped file access; visit history/CRM links; end-to-end visit | In progress |
| 8 Operations | Attendance/visit/travel summaries; correction approvals; missing-visit alerts | Audited approval, redacted notifications, export permission tests | In progress |
| 9 Release verification | Configuration, RLS, retention, recovery, performance, real devices | Full regression/DB/UI tests; measured 25-user pilot capacity | Pending |
| 10 Rollout | Backup/rollback; Android signing/distribution; training; small pilot then opt-in rollout | Real-device pilot acceptance and live health evidence | Pending |

No phase is complete merely because files exist. Unit and security checks run throughout,
not only Phase 9. Phases 3–6 require native Android behavior; a webview is not a substitute.

## State and authority

- Organization admin configures module/policy; installation admin installs optional tables.
  Module installation and per-organization enablement are separate; default disabled.
- Explicit field-team manager grants limit visibility to assigned team members. A generic
  agent cannot read colleagues' attendance, coordinates, devices or attachments.
- Employee identity derives from validated authentication, never payload user_id.
- Managers assign projects but cannot remotely start an employee's tracking session.
- Session transitions: off_duty -> working -> on_break -> working -> off_duty.
  working/on_break both collect under the confirmed policy; closed sessions never collect.
- GPS collection is interruptible by punch-out, local permission removal, logout or
  organization/device revocation. Revocation is rechecked by the server on every sync;
  offline devices cannot instantly learn a server revocation, which must be disclosed.
- Record device capture time, server receive time, accuracy and sequence. Never confuse
  received-at with current position. Old offline points cannot replace a newer position.
- GPS samples outside an authenticated, employee-owned work interval are rejected;
  delayed samples inside a closed session may sync, but never make that user appear active.
- Punch-out stops the Android service locally BEFORE waiting for network acknowledgement.
- Offline operations retain stable IDs; retry is at-least-once transport, idempotent storage.
  Reuse of an ID with different content is a conflict, never silent success.
- Coordinates are sensitive: excluded from logs, audit metadata, push text and crash reports.
  Audit references session/assignment IDs, not location payloads. Raw data has a configured
  retention period; deployment cannot enable collection without a policy and worker.
- No employee ranking/disciplinary or payroll decision automatically inferred from GPS.

## Scheduling contract

- Calendar date + wall-clock time + IANA organization zone define an assignment.
  Persist occurrence UTC instants and the schedule zone so device zone changes do not move it.
- ISO weekdays Monday=1 ... Sunday=7; bounded query windows; stable occurrence identity
  (series ID + local calendar date), not sequence numbers that change during edits.
- Recurrence has effective start and optional inclusive end. Generate requested windows,
  not infinite rows. Exceptions can cancel or replace one occurrence.
- Edits: one occurrence, this-and-future, entire series. Completed/in-progress history is
  immutable; entire-series changes affect only eligible future occurrences.
- Explicit end-date offset supports overnight work. Overlaps are shown before saving;
  project switching does not create a second attendance session.
- DST ambiguity/nonexistent local times require an explicit resolution, not silent shifting.
- Organization zone changes do not silently reinterpret existing series; show review/rebase.

## Operational loop and proposed integration points

These are planned connections, not claims of existing implementation:
CRM organization/membership -> scoped field service -> calendar/mobile assignments;
mobile attendance/GPS -> validated session store -> manager dashboard;
visit outcome -> CRM next task -> scheduled assignment;
sync failure -> visible mobile queue/manager stale state -> retry or operator correction.
Field operations are employee-driven; AI cannot access raw employee journeys or start tracking.
Navigation will expose Field Sales under CRM; failures must have a visible action, not only logs.

## Release prerequisites (not permission to fabricate completion)

Confirm employee notice and applicable workplace policy with the organization; configure
retention and approved map hosting; obtain Android signing/distribution ownership; pair a
real authorized Android device for battery/background tests. No production employee data
is collected during development. Existing CRM flows and other hosted applications stay intact.

## Progress evidence

- Repository scanned: no existing native Android or field-project tracking implementation
  found by filename search; existing CRM country/time-zone sources confirmed above.
- New branch: codex/field-sales-tracking, based on the deployed fork as explicitly requested.
- Android debug APK compiled and installed on the connected Samsung; synthetic smoke
  passed. This does not prove GPS delivery, locked-screen behavior or battery endurance.
- Local recovery check (2026-09-19): Docker restarted, persistent synthetic `Field Sales Test`
  organization created, and Samsung paired using an encrypted device credential. The device
  fetched an authenticated snapshot with matching organization/employee identity while
  remaining off duty. No production credential or production data was changed.
- The local pilot uses the QA API on port 55431 and PostgreSQL on 55432, with the CRM on
  port 3102. Phone access currently uses USB reverse forwarding; unplugging removes that
  transport, so offline queue behavior must not be mistaken for live synchronization.
- Current recheck: 42 Field Sales unit tests and Android build/unit/lint passed. These are
  scoped checks, not evidence of completed full release verification or deployment.
