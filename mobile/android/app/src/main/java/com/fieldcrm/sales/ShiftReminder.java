package com.fieldcrm.sales;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONObject;

/** One reminder per session; attendance and GPS continue until a human ends the shift. */
final class ShiftReminder {
    private ShiftReminder() {}

    static void notifyIfDue(Context context) throws Exception {
        JSONObject state = SecureState.read(context);
        long start = state.optLong("session_start_ms", 0);
        if (start <= 0 || System.currentTimeMillis() - start < Attendance.SHIFT_REMINDER_MS
            || !WorkState.collecting(state.optString("status", "off_duty"))) return;
        String sessionId = state.optString("session_id");
        if (sessionId.isEmpty() || sessionId.equals(state.optString("shift_reminder_sent_for_session"))) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        SecureState.mutate(context, current -> current.put("shift_reminder_sent_for_session", sessionId));
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("shift_reminders", "Shift reminders", NotificationManager.IMPORTANCE_HIGH));
        PendingIntent open = PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        manager.notify(14, new Notification.Builder(context, "shift_reminders")
            .setSmallIcon(R.drawable.ic_tracking_notification)
            .setContentTitle("Your shift has reached 14 hours")
            .setContentText("Punch out if finished, or contact your manager if you are still working.")
            .setContentIntent(open).setAutoCancel(true).build());
    }
}
