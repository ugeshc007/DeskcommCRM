package com.fieldcrm.sales;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import org.json.JSONObject;

/** Explicitly consented, timed local-account pilot. Never part of the production APK. */
final class LocalLockedPilot {
    static void run(Instrumentation runner) {
        Context context = runner.getTargetContext();
        Activity screen = null; boolean started = false; String stage = "preconditions";
        Bundle result = new Bundle(); int status = Activity.RESULT_CANCELED;
        try {
            JSONObject state = SecureState.read(context);
            if (!BuildConfig.DEBUG || !"http://127.0.0.1:3102".equals(state.optString("server"))
                || !state.has("token") || !"off_duty".equals(state.getString("status"))
                || state.getJSONArray("events").length() != 0 || state.getJSONArray("points").length() != 0)
                throw new IllegalStateException();
            android.os.BatteryManager battery = context.getSystemService(android.os.BatteryManager.class);
            stage = "launch";
            int initial = battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
            int initialCharge = battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
            screen = runner.startActivitySync(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runner.waitForIdleSync();
            stage = "punch-in"; Attendance.punchIn(context, TestAssignment.fromState(context)); started = true;
            runner.runOnMainSync(() -> context.startForegroundService(new Intent(context, TrackingService.class)));
            Thread.sleep(3000);
            stage = "foreground-service"; if (!TrackingService.running) throw new IllegalStateException();
            stage = "lock-screen";
            runner.getUiAutomation().executeShellCommand("input keyevent 223").close();
            long start = android.os.SystemClock.elapsedRealtime();
            stage = "locked-observation";
            int checks = 0, lockedChecks = 0, unpluggedChecks = 0; boolean breakStarted = false, breakEnded = false;
            while (android.os.SystemClock.elapsedRealtime() - start < 15 * 60 * 1000L) {
                Thread.sleep(5000);
                if (!TrackingService.running || !WorkState.collecting(SecureState.read(context).getString("status")))
                    throw new IllegalStateException();
                if (context.getSystemService(android.app.NotificationManager.class).getActiveNotifications().length == 0)
                    throw new IllegalStateException();
                checks++;
                if (context.getSystemService(android.app.KeyguardManager.class).isKeyguardLocked()) lockedChecks++;
                Intent power = context.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (power != null && power.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1) == 0) unpluggedChecks++;
                long elapsed = android.os.SystemClock.elapsedRealtime() - start;
                if (!breakStarted && elapsed >= 5 * 60 * 1000L) { Attendance.act(context, "break_start"); breakStarted = true; }
                if (!breakEnded && elapsed >= 10 * 60 * 1000L) { Attendance.act(context, "break_end"); breakEnded = true; }
            }
            JSONObject report = new JSONObject().put("duration_minutes", 15).put("checks", checks)
                .put("locked_checks", lockedChecks).put("unplugged_checks", unpluggedChecks)
                .put("battery_start_percent", initial).put("battery_end_percent", battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY))
                .put("charge_start_uah", initialCharge).put("charge_end_uah", battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER));
            Attendance.act(context, "punch_out"); started = false;
            Thread.sleep(2000);
            if (TrackingService.running) throw new IllegalStateException();
            report.put("punch_out_stopped", true);
            SecureState.mutate(context, current -> current.put("local_pilot_report", report));
            result.putString("stream", "LOCAL LOCKED PILOT: " + report + ". Short observation only, not all-day battery endurance.\n");
            status = Activity.RESULT_OK;
        } catch (Throwable failure) {
            result.putString("stream", "LOCAL LOCKED PILOT incomplete at " + stage + " (" + failure.getClass().getSimpleName() + "). No coordinates or credentials printed.\n");
        } finally {
            if (started) {
                context.stopService(new Intent(context, TrackingService.class));
                try { Attendance.act(context, "punch_out"); } catch (Exception ignored) { }
            }
            if (screen != null) { Activity activity = screen; runner.runOnMainSync(activity::finish); }
        }
        runner.finish(status, result);
    }
}
