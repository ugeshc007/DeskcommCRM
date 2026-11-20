package com.fieldcrm.sales;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.JSONObject;

/** Lives only in the test APK, never in a release application. */
final class LocalPilotPairing {
    static void verifyOfflineQueue(Instrumentation runner) {
        Bundle result = new Bundle(); int status = Activity.RESULT_CANCELED;
        android.content.Context isolated = new android.content.ContextWrapper(runner.getTargetContext()) {
            @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
                return getBaseContext().getSharedPreferences("offline_queue_test_" + name, mode);
            }
            @Override public android.content.Context getApplicationContext() { return this; }
            @Override public boolean stopService(android.content.Intent intent) { return false; }
        };
        try {
            if (!BuildConfig.DEBUG || TrackingService.running) throw new IllegalStateException();
            SecureState.mutate(isolated, state -> {
                state.remove("token"); state.put("status", "off_duty"); state.put("events", new org.json.JSONArray());
                state.put("points", new org.json.JSONArray());
                state.put("snapshot", new JSONObject().put("settings", new JSONObject().put("enabled", true)));
            });
            Attendance.punchIn(isolated); Attendance.act(isolated, "break_start");
            Attendance.act(isolated, "break_end"); Attendance.act(isolated, "punch_out");
            String first = SecureState.read(isolated).getString("session_id");
            Attendance.punchIn(isolated); Attendance.act(isolated, "punch_out");
            JSONObject state = SecureState.read(isolated);
            if (!"off_duty".equals(state.getString("status")) || state.getJSONArray("events").length() != 6
                || first.equals(state.getString("session_id"))
                || !first.equals(state.getJSONArray("events").getJSONObject(0).getString("session_id"))
                || state.getJSONArray("events").getJSONObject(4).getInt("sequence") != 0) throw new AssertionError();
            result.putString("stream", "OFFLINE QUEUE PASS: two shifts retain ordered events and separate session IDs in encrypted storage. Paired account unchanged; no GPS collected.\n");
            status = Activity.RESULT_OK;
        } catch (Throwable failure) { result.putString("stream", "OFFLINE QUEUE FAILED; paired account unchanged.\n"); }
        runner.finish(status, result);
    }
    static void verifySync(Instrumentation runner) {
        Bundle result = new Bundle(); int status = Activity.RESULT_CANCELED;
        try {
            JSONObject before = SecureState.read(runner.getTargetContext());
            if (!BuildConfig.DEBUG || !"http://127.0.0.1:3102".equals(before.optString("server"))
                || !"off_duty".equals(before.getString("status")) || before.getJSONArray("events").length() != 0
                || before.getJSONArray("points").length() != 0) throw new IllegalStateException();
            java.util.concurrent.CountDownLatch completed = new java.util.concurrent.CountDownLatch(1);
            if (!SyncEngine.sync(runner.getTargetContext(), completed::countDown)
                || !completed.await(50, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException();
            JSONObject after = SecureState.read(runner.getTargetContext());
            JSONObject snapshot = after.getJSONObject("snapshot");
            JSONObject identity = snapshot.getJSONObject("identity");
            if (!after.optString("sync_error").isEmpty() || !snapshot.getJSONObject("settings").getBoolean("enabled")
                || !identity.getString("organization_id").equals(before.getJSONObject("identity").getString("organization_id"))
                || !identity.getString("employee_id").equals(before.getJSONObject("identity").getString("employee_id"))
                || !"off_duty".equals(after.getString("status")) || TrackingService.running) throw new IllegalStateException();
            result.putString("stream", "LOCAL SYNC PASS: authenticated snapshot, matching organization and employee, tracking enabled by test policy, GPS remains off.\n");
            status = Activity.RESULT_OK;
        } catch (Exception failure) { result.putString("stream", "LOCAL SYNC FAILED: inspect local connectivity and policy; no secrets printed.\n"); }
        runner.finish(status, result);
    }
    static void run(Instrumentation runner, Bundle arguments) {
        Bundle result = new Bundle(); int status = Activity.RESULT_CANCELED;
        try {
            String token = arguments.getString("field_pilot_key"), org = arguments.getString("field_pilot_org"), actor = arguments.getString("field_pilot_actor");
            if (!BuildConfig.DEBUG || token == null || !token.matches("fld_[a-f0-9]{64}") || org == null || actor == null) throw new IllegalArgumentException();
            SecureState.mutate(runner.getTargetContext(), state -> {
                if (state.has("token") || !state.getString("status").equals("off_duty") || state.getJSONArray("events").length() > 0 || state.getJSONArray("points").length() > 0) throw new IllegalStateException();
                state.put("server", "http://127.0.0.1:3102"); state.put("token", token);
                state.put("identity", new JSONObject().put("organization_id", org).put("employee_id", actor));
                state.put("timezone", "Asia/Dubai");
            });
            result.putString("stream", "LOCAL PAIRING PASS: encrypted test credential; GPS remains off.\n"); status = Activity.RESULT_OK;
        } catch (Exception failure) { result.putString("stream", "LOCAL PAIRING REFUSED: use a disconnected, off-duty test installation.\n"); }
        runner.finish(status, result);
    }
}
