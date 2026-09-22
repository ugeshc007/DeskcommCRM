# Field Officer voice activity loop — implementation contract

Status: implemented locally on `codex/field-voice-activity`; test and release gates pending; not deployed.

## Confirmed behavior

- The organization keeps its existing project/weekday assignments. An officer punches in and selects a project before the assistant asks for a destination.
- Voice AI is opt-in in the Android Profile. With the app in the foreground and microphone permission granted, the assistant speaks the destination question, listens for a short answer, and presents its interpretation for confirmation before saving it.
- A statement such as “going to [shop]” becomes a dated activity on that officer's current session and project. If the named shop uniquely matches an assigned project customer, the activity links to that customer. An ambiguous or unmatched name must be corrected by the officer; it must not silently select a shop.
- On arrival, the officer uses the existing shop visit/received-payment form. The amount remains optional and is never initiated as an online payment by speech.
- After a visit/collection is saved, the assistant asks for the next destination while the shift remains active. Punch-out stops the loop. The officer can disable Voice AI at any time, and touch controls remain available.

## Safety and data boundaries

- The profile toggle is not permission for an always-listening background microphone. Recording must be visibly bounded, cancellable, and limited to the foreground app. It must stop on pause, punch-out, permission loss, or timeout.
- Transcription is a proposal, not an authoritative CRM mutation. The officer confirms or edits the activity and the shop association. Speech never records a collection amount or changes a due balance without the existing payment form's explicit save.
- The server must authenticate the employee's device, verify the active session and project/customer ownership inside the organization, validate and deduplicate activity commands, and show the saved activity to authorized managers. Other organizations must not be able to read or write it.
- Audio remains temporary and is deleted after transcription or cancellation. The encrypted offline queue retains only the officer-confirmed text and identifiers, not audio.
- Confirmed activity notes follow visit/payment business-history retention, not the shorter raw-GPS coordinate retention (user-confirmed).

## Required implementation before an APK or live claim

1. An organization-scoped activity ledger with a versioned migration, idempotent baseline appendix, manifest entry, retention policy, audit, and cross-organization tests.
2. A device-only write/read contract and Android offline retry for confirmed activity; display the saved activity with the officer's dated route/visit history.
3. Foreground spoken prompt and bounded listening after project selection and each saved collection, with microphone consent, correction, and touch fallback. Add a distinct next-shop prompt to the private speech service.
4. Android unit/instrumentation tests and a consented real-device pilot; browser, database, image, and full release gates green for the exact commit. Rebuild/sign/distribute the APK separately from the CT102 web deployment.

The voice prompt, review screen, organization-scoped activity ledger, offline text queue, and manager history are part of this change. The current CT102 app has not received it.
