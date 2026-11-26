package com.fieldcrm.sales;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import org.json.JSONObject;

/** Opt-in hardware probe. No account, server, synthetic location injection or coordinate output. */
final class LocalGpsPilot {
    static void run(Instrumentation runner) {
        Context context = runner.getTargetContext(); Activity activity = null;
        String previous = null; boolean prepared = false; Bundle result = new Bundle(); int outcome = Activity.RESULT_CANCELED;
        try {
            JSONObject original = SecureState.read(context);
            if (original.has("token") || !"off_duty".equals(original.getString("status")) || original.getJSONArray("events").length() > 0 || original.getJSONArray("points").length() > 0)
                throw new IllegalStateException("A fresh disconnected pilot installation is required");
            previous = context.getSharedPreferences("field_sales", 0).getString("encrypted", null);
            SecureState.mutate(context, state -> state.put("snapshot", new JSONObject().put("settings", new JSONObject().put("enabled", true))));
            prepared = true;
            activity = runner.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runner.waitForIdleSync();
            Attendance.punchIn(context);
            runner.runOnMainSync(() -> context.startForegroundService(new Intent(context, TrackingService.class)));
            long deadline = android.os.SystemClock.elapsedRealtime() + 120000;
            while (android.os.SystemClock.elapsedRealtime() < deadline && SecureState.read(context).getJSONArray("points").length() == 0) Thread.sleep(1000);
            int working = SecureState.read(context).getJSONArray("points").length();
            if (!TrackingService.running) throw new AssertionError("Tracking service did not remain active");
            if (context.getSystemService(android.app.NotificationManager.class).getActiveNotifications().length == 0)
                throw new AssertionError("Tracking notification is missing");
            Attendance.act(context, "break_start");
            Thread.sleep(35000);
            int duringBreak = SecureState.read(context).getJSONArray("points").length();
            if (!TrackingService.running) throw new AssertionError("Tracking stopped during the agreed break policy");
            Attendance.act(context, "punch_out"); Thread.sleep(2000);
            int stopped = SecureState.read(context).getJSONArray("points").length();
            Thread.sleep(35000);
            if (TrackingService.running || SecureState.read(context).getJSONArray("points").length() != stopped)
                throw new AssertionError("Location collection continued after punch-out");
            result.putString("stream", "LOCAL GPS PILOT: working samples=" + working + "; after break=" + duringBreak
                + "; punch-out stopped collection. Visible notification checked. "
                + (working > 0 ? "Real location received." : "NO SATELLITE FIX: collection is NOT verified.")
                + " No network account used; coordinates never printed. Not an all-day battery test.\n");
            outcome = working > 0 ? Activity.RESULT_OK : Activity.RESULT_CANCELED;
        } catch (Throwable failure) {
            result.putString("stream", "LOCAL GPS PILOT incomplete (" + failure.getClass().getSimpleName() + "). No coordinates printed.\n");
        } finally {
            context.stopService(new Intent(context, TrackingService.class));
            if (prepared) {
                android.content.SharedPreferences.Editor edit = context.getSharedPreferences("field_sales", 0).edit();
                if (previous == null) edit.remove("encrypted"); else edit.putString("encrypted", previous);
                edit.commit();
            }
            if (activity != null) { Activity screen = activity; runner.runOnMainSync(screen::finish); }
        }
        runner.finish(outcome, result);
    }
}
