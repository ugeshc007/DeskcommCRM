package com.fieldcrm.sales;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

/** Fresh-install device smoke test: no credentials or location permissions required. */
public final class SmokeInstrumentation extends Instrumentation {
    private boolean gpsPilot;
    private Bundle pilotArguments;
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); pilotArguments = arguments; gpsPilot = arguments != null && "consented-local-only".equals(arguments.getString("gps_pilot")); start(); }
    private boolean contains(View view, String value) {
        if (view instanceof TextView && ((TextView) view).getText().toString().equals(value)) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (contains(group.getChildAt(i), value)) return true;
        }
        return false;
    }
    private boolean described(View view, String value) {
        CharSequence description = view.getContentDescription();
        if (description != null && value.contentEquals(description)) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) if (described(group.getChildAt(i), value)) return true;
        }
        return false;
    }
    @Override public void onStart() {
        if (pilotArguments != null && pilotArguments.containsKey("field_pilot_key")) { LocalPilotPairing.run(this, pilotArguments); return; }
        if (pilotArguments != null && "true".equals(pilotArguments.getString("verify_local_sync"))) { LocalPilotPairing.verifySync(this); return; }
        if (pilotArguments != null && "true".equals(pilotArguments.getString("verify_offline_queue"))) { LocalPilotPairing.verifyOfflineQueue(this); return; }
        if (pilotArguments != null && "consented-local-only".equals(pilotArguments.getString("locked_pilot"))) { LocalLockedPilot.run(this); return; }
        if (gpsPilot) { LocalGpsPilot.run(this); return; }
        Bundle result = new Bundle(); Activity activity = null; String stage = "fresh-state";
        try {
            if (SecureState.read(getTargetContext()).has("token")) throw new IllegalStateException("Use a fresh test installation, not a connected employee device.");
            stage = "launch";
            activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitForIdleSync(); Activity screen = activity;
            if (getTargetContext().getSystemService(android.app.job.JobScheduler.class).getPendingJob(102) == null)
                throw new AssertionError("Network-only retry job was not scheduled");
            final boolean[] visible = {false};
            runOnMainSync(() -> visible[0] = contains(screen.getWindow().getDecorView(), "Connect securely")
                && contains(screen.getWindow().getDecorView(), "Six-digit code")
                && !contains(screen.getWindow().getDecorView(), "CRM HTTPS address"));
            if (!visible[0]) throw new AssertionError("Connection controls are not rendered");
            if (TrackingService.running || !"off_duty".equals(SecureState.read(getTargetContext()).getString("status"))) throw new AssertionError("Fresh installation must not track");
            // Separate synthetic preference namespace under the target UID; never employee state.
            android.content.Context testContext = new android.content.ContextWrapper(getTargetContext()) {
                @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
                    return getBaseContext().getSharedPreferences("smoke_test_" + name, mode);
                }
                @Override public android.content.Context getApplicationContext() { return this; }
            };
            stage = "test-storage";
            SecureState.mutate(testContext, state -> {
                state.put("status", "off_duty"); state.put("events", new org.json.JSONArray()); state.put("points", new org.json.JSONArray());
                state.put("snapshot", new org.json.JSONObject().put("settings", new org.json.JSONObject().put("enabled", true)));
                state.put("synthetic_marker", "encrypted-storage-proof");
            });
            if (!"encrypted-storage-proof".equals(SecureState.read(testContext).getString("synthetic_marker"))) throw new AssertionError("Encrypted storage round trip failed");
            String stored = testContext.getSharedPreferences("field_sales", 0).getString("encrypted", "");
            if (stored.contains("encrypted-storage-proof") || stored.contains("snapshot")) throw new AssertionError("Plaintext storage found");
            stage = "test-attendance";
            Attendance.punchIn(testContext); Attendance.act(testContext, "break_start");
            if (!WorkState.collecting(SecureState.read(testContext).getString("status"))) throw new AssertionError("Break policy differs");
            Attendance.act(testContext, "break_end"); Attendance.act(testContext, "punch_out");
            org.json.JSONObject closed = SecureState.read(testContext);
            if (!"off_duty".equals(closed.getString("status")) || closed.getJSONArray("events").length() != 4) throw new AssertionError("Offline attendance lost");
            String firstSession = closed.getString("session_id");
            Attendance.punchIn(testContext); Attendance.act(testContext, "punch_out");
            org.json.JSONObject second = SecureState.read(testContext);
            if (firstSession.equals(second.getString("session_id")) || second.getJSONArray("events").length() != 6
                || !firstSession.equals(second.getJSONArray("events").getJSONObject(0).getString("session_id"))
                || second.getJSONArray("events").getJSONObject(4).getInt("sequence") != 0)
                throw new AssertionError("Multiple offline shifts lost session identity or order");
            stage = "test-photo-queue";
            SecureState.mutate(testContext, state -> state.put("pending_photos", new org.json.JSONArray()));
            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(12, 12, android.graphics.Bitmap.Config.ARGB_8888);
            try { VisitPhotos.queue(testContext, bitmap, java.util.UUID.randomUUID().toString()); } finally { bitmap.recycle(); }
            org.json.JSONObject photo = SecureState.read(testContext).getJSONArray("pending_photos").getJSONObject(0);
            if (testContext.getSharedPreferences("field_sales", 0).getString("encrypted", "").contains(photo.getString("image_base64"))) throw new AssertionError("Photo plaintext found");
            stage = "connected-home";
            Activity first = activity; runOnMainSync(first::finish);
            String date = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString(), project = java.util.UUID.randomUUID().toString(), schedule = java.util.UUID.randomUUID().toString();
            SecureState.mutate(getTargetContext(), current -> {
                current.put("token", "fld_" + new String(new char[64]).replace('\0', 'a')).put("server", "https://synthetic.invalid").put("timezone", "UTC")
                    .put("identity", new org.json.JSONObject().put("organization_id", java.util.UUID.randomUUID()).put("employee_id", java.util.UUID.randomUUID()))
                    .put("snapshot", new org.json.JSONObject().put("settings", new org.json.JSONObject().put("enabled", true).put("notice_text", "Test notice"))
                        .put("employee", new org.json.JSONObject().put("display_name", "Synthetic salesperson"))
                        .put("region", new org.json.JSONObject().put("timezone", "UTC").put("country_code", "AE"))
                        .put("occurrences", new org.json.JSONArray().put(new org.json.JSONObject().put("project_id", project).put("occurrence_key", schedule + ":test")
                            .put("date", date).put("project_name", "Synthetic project").put("site_name", "Synthetic site")
                            .put("starts_at", java.time.Instant.now().toString()).put("ends_at", java.time.Instant.now().plusSeconds(3600).toString()))));
            });
            activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); waitForIdleSync(); Activity connected = activity;
            final boolean[] simple = {false}; runOnMainSync(() -> simple[0] = contains(connected.getWindow().getDecorView(), "Start work")
                && contains(connected.getWindow().getDecorView(), "Punch in") && described(connected.getWindow().getDecorView(), "Notifications and sync status")
                && described(connected.getWindow().getDecorView(), "Profile and sign out") && !contains(connected.getWindow().getDecorView(), "Sync now")
                && !contains(connected.getWindow().getDecorView(), "Start break") && !contains(connected.getWindow().getDecorView(), "Attach visit photo"));
            if (!simple[0]) throw new AssertionError("Connected home is not the simplified project/punch workflow");
            SecureState.clear(getTargetContext());
            result.putString("stream", "PASS: connection screen; simplified connected project/Punch In home; notification/profile controls; off-duty GPS; Android Keystore round trip; no plaintext preferences; offline attendance retained. Isolated synthetic records only; no credentials or GPS collected.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable failure) {
            result.putString("stream", "FAIL: " + stage + " (" + failure.getClass().getSimpleName() + "). No sensitive data printed.\n");
            finish(Activity.RESULT_CANCELED, result);
        } finally {
            try { if (SecureState.read(getTargetContext()).optString("token").startsWith("fld_aaa")) SecureState.clear(getTargetContext()); } catch (Exception ignored) { }
            if (activity != null) { Activity screen = activity; runOnMainSync(screen::finish); }
        }
    }
}
