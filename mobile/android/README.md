# Android Field Sales pilot

Status: development build, not a production release. No Google Maps SDK or Google API key.

## Build and checks

Use JDK 17 or newer, Android SDK 35, Gradle 8.14.2 and Android Gradle Plugin 8.13.2.
Run `gradle :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` from this directory.
The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`; it must not be committed.
Signing keys, `local.properties`, build outputs and Gradle caches are ignored.

For the fresh-install smoke test, build `:app:assembleDebugAndroidTest`, install both debug
APKs on an authorized spare device, and run:

```text
adb shell am instrument -w com.fieldcrm.sales.test/com.fieldcrm.sales.SmokeInstrumentation
```

It checks rendered connection controls, off-duty state, encrypted Android Keystore-backed
storage and synthetic offline attendance in a **separate test-only preference namespace**. It does not
connect an employee, grant location permission, start GPS or send data to the CRM.
It intentionally refuses to run against an already-connected employee installation.

## Connection and privacy

1. Installation admin installs the optional module; organization admin enrolls staff and
   configures a notice and retention period. Installation alone never enables tracking.
2. An organization administrator opens Team → the Field Officer → Android keys and creates a
   six-digit pairing code. The code is valid for five minutes and one exchange. The legacy
   self-service screen uses the same pairing contract for previously enrolled staff.
3. In Android, enter only the six-digit code. The CRM origin is compiled into this APK as
   `https://crm.techspothub.com`; a different self-host installation must rebuild the APK
   with its own HTTPS origin. The server stores only HMAC(code) until exchange, then replaces
   it with the hash of a random 256-bit, revocable device bearer. Android stores that bearer,
   cache and pending queue encrypted with Android Keystore. A six-digit code is never a bearer.
4. Sync the organization policy and today's projects. Select an assigned project, accept the
   displayed tracking notice, and punch in. Precise location and visible notification permissions
   are requested explicitly.
5. Breaks continue tracking. Punch-out requests local service shutdown before disk/network
   operations. Offline attendance and sample IDs survive retries without duplicate inserts.
6. A replacement key is checked against the same CRM origin, organization and employee
   while work is pending. Revocation is revalidated inside server transactions.

The service is user-started, visible and not automatically restarted after process death
or reboot. Reopening the connected app restarts an interrupted active-session service. It requests GPS
updates at a provisional 30-second / 20-metre threshold; real-device battery measurements
must determine final configuration. This is not a guarantee of update frequency.
An offline phone cannot immediately learn remote revocation. No hidden tracking is used.
Network-only retries use Android JobScheduler (15-minute requested cadence, OS-controlled
and not an exact guarantee), including after punch-out. This job never starts GPS.
It is re-registered when the app opens; reboot does not silently restart collection.
Pending GPS is bounded at 5,000 samples; a full/unwritable queue stops collection and shows
an error rather than silently discarding points. Expired/out-of-interval server rejections
remain visible for resolution; automatic rejected-record reconciliation is still pending.

## Connected home and sign-out

The connected home deliberately contains only today's assigned-project selector, Punch In and
Punch Out. Sync and GPS retry remain automatic. A notification icon shows last sync and pending
attendance/GPS counts without coordinates. Profile shows the employee and organization time zone.
Sign-out is refused while working or while any queue is pending. The app revokes its device token
on the CRM before deleting Android Keystore-backed local state; a failed revocation leaves the
account connected and the data intact.

## Remaining release gates

- Full synthetic local-server pairing, reconnect, offline-drain and permission-loss tests.
- Real-device locked-screen, battery, reboot/interruption and accurate punch-out proof.
- Background retry timing under Android battery restrictions; full queue reconciliation.
- End-to-end map/visit/correction proof, photo attachments and remaining calendar workflows.
- Production signing/distribution, privacy review and limited opt-in pilot.

No release-ready claim is implied by compilation, lint or this smoke test.
# Follow-up completion and hardware pilot checkpoint

The app displays assigned visit next actions, including overdue actions outside the loaded
week. Completion is confirmed by the user and queued encrypted with its original revision.
Pending completion failures do not block GPS sync. The user can explicitly stop a queued
retry; this does not undo a completion already saved remotely. Keys remain employee-only
even if the account has manager privileges in the web CRM.

2026-09-19: the consented Samsung pilot received one real GPS fix, verified a visible
notification, and verified collection stopped at punch-out. This accountless probe restored
previous encrypted test state and printed no coordinates. It is not end-to-end delivery,
locked-screen reliability or battery endurance evidence. The paired Samsung has separately
passed authenticated local snapshot synchronization and encrypted two-shift offline queue
tests. These scoped checks do not make this APK a completed production release.
