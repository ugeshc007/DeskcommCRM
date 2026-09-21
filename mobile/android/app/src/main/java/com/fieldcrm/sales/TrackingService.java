package com.fieldcrm.sales;

import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import android.graphics.Color;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONObject;

/** Visible, user-started service. Never auto-starts at boot or after process death. */
public final class TrackingService extends Service implements LocationListener {
    public static volatile boolean running;
    private LocationManager locations;
    private static boolean mayCollect(JSONObject state) {
        JSONObject snapshot = state.optJSONObject("snapshot");
        JSONObject policy = snapshot == null ? null : snapshot.optJSONObject("settings");
        long start = state.optLong("session_start_ms", 0);
        return start > 0 && System.currentTimeMillis() < start + Attendance.MAX_SHIFT_MS
            && WorkState.mayCollect(state.optString("status"), state.optBoolean("access_denied"), policy != null && policy.optBoolean("enabled"));
    }
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable sync = new Runnable() {
        public void run() {
            try { Attendance.autoPunchOut(TrackingService.this); } catch (Exception ignored) { stopSelf(); }
            SyncEngine.sync(TrackingService.this, null); handler.postDelayed(this, 60000);
        }
    };
    private final Runnable cutoff = new Runnable() {
        public void run() {
            stopSelf();
            try { Attendance.autoPunchOut(TrackingService.this); } catch (Exception ignored) { }
        }
    };
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "PUNCH_OUT".equals(intent.getAction())) {
            stopSelf();
            try { Attendance.act(this, "punch_out"); } catch (Exception ignored) { }
            return START_NOT_STICKY;
        }
        try {
            JSONObject state = SecureState.read(this);
            Attendance.autoPunchOut(this);
            state = SecureState.read(this);
            if (!mayCollect(state)) { stopSelf(); return START_NOT_STICKY; }
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                throw new IllegalStateException("Precise location permission is required. Open the app to resume.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel("tracking", "Work-session tracking", NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
            PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, TrackingService.class).setAction("PUNCH_OUT"), PendingIntent.FLAG_IMMUTABLE);
            startForeground(1, new Notification.Builder(this, "tracking").setSmallIcon(R.drawable.ic_tracking_notification).setColor(Color.rgb(91, 70, 255))
                .setContentTitle("Work GPS tracking is active").setContentText("Punch out to stop location tracking.")
                .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "Punch out", stop).build()).build());
            locations = getSystemService(LocationManager.class);
            locations.removeUpdates(this);
            if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw new IllegalStateException("Turn on phone location to resume tracking.");
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 30000L, 20f, this);
            running = true;
            handler.removeCallbacks(cutoff);
            handler.postDelayed(cutoff, Math.max(0, state.optLong("session_start_ms") + Attendance.MAX_SHIFT_MS - System.currentTimeMillis()));
            handler.removeCallbacks(sync); handler.post(sync);
        } catch (Exception error) {
            try { SecureState.mutate(this, state -> state.put("sync_error", "Tracking stopped. Check location permissions and phone settings, then resume in the app.")); } catch (Exception ignored) { }
            stopSelf();
        }
        return START_NOT_STICKY;
    }
    @Override public void onLocationChanged(Location location) {
        try {
            if (!location.hasAccuracy() || location.getAccuracy() < 0 || location.getTime() <= 0) return;
            SecureState.mutate(this, state -> {
                if (!mayCollect(state)) { stopSelf(); return; }
                if (location.getTime() < state.optLong("session_start_ms", Long.MAX_VALUE) ||
                    location.getTime() >= state.optLong("session_start_ms") + Attendance.MAX_SHIFT_MS ||
                    location.getTime() > System.currentTimeMillis() + 60000L) return;
                if (state.getJSONArray("points").length() >= 5000) throw new IllegalStateException("Offline storage limit reached. Sync before resuming.");
                long sequence = state.optLong("point_sequence", -1) + 1;
                state.getJSONArray("points").put(new JSONObject().put("sample_id", UUID.randomUUID().toString())
                    .put("session_id", state.getString("session_id")).put("sequence", sequence)
                    .put("captured_at", Instant.ofEpochMilli(location.getTime()).toString())
                    .put("latitude", location.getLatitude()).put("longitude", location.getLongitude())
                    .put("accuracy_m", location.getAccuracy()).put("mock_location", location.isFromMockProvider()));
                state.put("point_sequence", sequence);
            });
        } catch (Exception failure) {
            try { SecureState.mutate(this, state -> state.put("sync_error", "Location storage unavailable or full. Sync and resume tracking.")); } catch (Exception ignored) { }
            stopSelf();
        }
    }
    @Override public void onProviderDisabled(String provider) {
        try { SecureState.mutate(this, state -> state.put("sync_error", "Phone location is disabled. Enable it and resume tracking.")); } catch (Exception ignored) { }
        stopSelf();
    }
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (locations != null) locations.removeUpdates(this);
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
