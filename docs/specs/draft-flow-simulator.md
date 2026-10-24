# Draft simulator — implementation evidence

CONFIRMED: `FlowCanvas` opens `FlowSimulator` from Test flow. It snapshots the
current draft and runs `lib/followup/simulator.ts`, which accepts only plain graph,
sample input and in-memory state. It has no credential, database, job or network
ports. Closing the panel discards the test state. Restart takes the current draft.

Routing uses the production pure node handler. Variables use the production
expression and bounded typed-variable schemas. Integrations require explicit
mock success/error; configured output mappings require a mock scalar. Messages
are previewed, not delivered. AI classifications are selected explicitly. Media,
saved templates and generated replies are marked mock rather than fetched.
Waits use a virtual clock (smart waits use their minimum, not an AI timing plan).
The run stops at 200 steps. Invalid answers cannot populate session variables.

LIMITATIONS: This is not live delivery verification, provider authorization,
tenant RLS verification, attachment ownership verification, or a complete Phase 11
release gate. Existing-value skip/confirmation stops explicitly because no seeded
contact is provided. It does not prove the runtime's handoff policy or compliance
window. Publication issues are shown by code and node; provider-state checks
remain in the authenticated publication route. No automatic publication occurs.

Evidence: ten simulator unit tests passed; canonical TypeScript check passed.
The additional cases cover disconnected outputs, absent mock outputs, terminal
states, invalid clocks and graph snapshot isolation. Nine publication route tests
also pass: untested/failed/disconnected/stale connections are refused, unavailable
storage fails closed, and authorization plus organization scoping are enforced.
Three panel tests cover malformed mock JSON, clearing sample values on close,
and clearing stale publication findings when restarting an invalid draft.
Separate local Chromium completed the synthetic welcome flow and desktop/mobile
screenshots were inspected. Closing and reopening reset the run to Start. No
overflow was seen in the simulator panel. The in-app browser connection was
unavailable; this was a separate headless browser, not the signed-in CRM session.
Screenshots use synthetic data only:

- `tests/visual/builder/simulator-desktop.png`
- `tests/visual/builder/simulator-mobile.png`

An earlier full repository run exposed failures outside these
focused checks, including translated UI expectations and release guard tests.
That run was stopped after reproducing failures; it did not complete, and no
complete-suite pass count is claimed. Therefore this document does not declare
the full suite or release green. The integration database suite separately passed
13 tests, with baseline install and repeat update succeeding. All these checks
used local synthetic data, not production credentials or customer records.

The regression repair now makes legacy Portuguese test fixtures choose their
locale explicitly using the real provider; production still defaults to English.
Currency fallback assertions use the shared default while retaining explicit
organization-currency checks. Windows release tests pass with Git Bash in PATH.
A completed full-suite run reported 8,607 passed and 127 failed tests. Subsequent
targeted repairs passed 149 locale tests, 35 message-handler tests and 52
release/schema/toast checks; these do not replace another complete-suite run.
After moving the baseline anonymous-access sweep back to the end, fresh install,
repeat update and all 13 integration database invariants passed again.

Living System Checklist: input is the current FlowCanvas draft; output is the
step/variable trace in FlowSimulator. Errors stop at the affected block and the
operator edits the draft before restarting (feedback loop). Entry is the toolbar.
Configuration is sample answer/mock output in the panel. Persistence, operational
audit, follow-up scheduling and human transfer are deliberately absent: a dry run
must not create live demands or alter customer state. Production handoff is not
simulated as verified. Architecture edges are recorded in the simulator map.
