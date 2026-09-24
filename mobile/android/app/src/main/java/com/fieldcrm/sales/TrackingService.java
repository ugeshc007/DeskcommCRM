package com.fieldcrm.sales;

import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import android.graphics.Color;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/** Visible, user-started service. A system restart resumes only an authorized active shift. */
public final class TrackingService extends Service implements LocationListener {
    public static volatile boolean running;
    private LocationManager locations;
    private FusedLocationProviderClient fused;
    private LocationCallback fusedCallback;
    private boolean stationary;
    private boolean queuePressure;
    private int stationaryFixes;
    private GpsQuality.Fix previousFix;
    private boolean fusedActive;
    private boolean pausedForSettings;
    private long movingIntervalMs = GpsQuality.MOVING_INTERVAL_MS, stationaryIntervalMs = GpsQuality.STATIONARY_INTERVAL_MS;
    private float positionAccuracyM = GpsQuality.MAX_LIVE_ACCURACY_M;
    private double plausibleSpeedMps = GpsQuality.MAX_PLAUSIBLE_SPEED_M_S;
    private void updatePolicy(JSONObject state) {
        JSONObject snapshot = state.optJSONObject("snapshot"), settings = snapshot == null ? null : snapshot.optJSONObject("settings");
        if (settings == null) return;
        movingIntervalMs = Math.max(2000, Math.min(5000, settings.optLong("moving_interval_ms", GpsQuality.MOVING_INTERVAL_MS)));
        stationaryIntervalMs = Math.max(10000, Math.min(60000, settings.optLong("stationary_interval_ms", GpsQuality.STATIONARY_INTERVAL_MS)));
        positionAccuracyM = Math.max(10, Math.min(500, settings.optInt("position_accuracy_m", 100)));
        plausibleSpeedMps = Math.max(1, Math.min(100, settings.optInt("plausible_speed_m_s", 55)));
    }
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
            try {
                JSONObject state = SecureState.read(TrackingService.this);
                if (!locationEnabled()) {
                    pauseForSettings();
                } else if (pausedForSettings && running && mayCollect(state)) {
                    pausedForSettings = false; requestUpdates();
                }
                boolean pressure = state.getJSONArray("points").length() >= 3000;
                long priorMoving = movingIntervalMs, priorStationary = stationaryIntervalMs;
                updatePolicy(state);
                if (pressure != queuePressure) { queuePressure = pressure;
                    if (running && !pausedForSettings && mayCollect(state)) requestUpdates(); }
                else if (running && !pausedForSettings && mayCollect(state) && (movingIntervalMs != priorMoving || stationaryIntervalMs != priorStationary)) requestUpdates();
            } catch (Exception ignored) { }
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
            updatePolicy(state);
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                throw new IllegalStateException("Location permission is required. Open the app to resume.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel("tracking", "Work-session tracking", NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
            PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, TrackingService.class).setAction("PUNCH_OUT"), PendingIntent.FLAG_IMMUTABLE);
            startForeground(1, new Notification.Builder(this, "tracking").setSmallIcon(R.drawable.ic_tracking_notification).setColor(Color.rgb(91, 70, 255))
                .setContentTitle("Work GPS tracking is active").setContentText("Punch out to stop location tracking.")
                .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "Punch out", stop).build()).build());
            locations = getSystemService(LocationManager.class);
            if (!locationEnabled()) throw new IllegalStateException("Turn on phone location to resume tracking.");
            running = true;
            requestUpdates();
            handler.removeCallbacks(cutoff);
            handler.postDelayed(cutoff, Math.max(0, state.optLong("session_start_ms") + Attendance.MAX_SHIFT_MS - System.currentTimeMillis()));
            handler.removeCallbacks(sync); handler.post(sync);
        } catch (Exception error) {
            running = false;
            try { SecureState.mutate(this, state -> state.put("sync_error", "Tracking stopped. Check location permissions and phone settings, then resume in the app.")); } catch (Exception ignored) { }
            stopSelf();
        }
        return running ? START_STICKY : START_NOT_STICKY;
    }
    private boolean locationEnabled() {
        if (Build.VERSION.SDK_INT >= 28) return locations.isLocationEnabled();
        return locations.isProviderEnabled(LocationManager.GPS_PROVIDER) || locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
    private void requestUpdates() {
        long interval = stationary || queuePressure ? stationaryIntervalMs : movingIntervalMs;
        if (fusedActive && fused != null && fusedCallback != null) fused.removeLocationUpdates(fusedCallback);
        locations.removeUpdates(this);
        fusedActive = false;
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS) {
            fused = LocationServices.getFusedLocationProviderClient(this);
            if (fusedCallback == null) fusedCallback = new LocationCallback() {
                @Override public void onLocationResult(LocationResult result) {
                    if (result == null) return;
                    for (Location fix : result.getLocations()) onLocationChanged(fix);
                }
            };
            LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
                .setMinUpdateIntervalMillis(interval).setMinUpdateDistanceMeters(0)
                .setMaxUpdateAgeMillis(0).setMaxUpdateDelayMillis(0).build();
            try {
                fused.requestLocationUpdates(request, fusedCallback, Looper.getMainLooper())
                    .addOnFailureListener(error -> {
                        fusedActive = false;
                        try { if (running && mayCollect(SecureState.read(this))) requestPlatformUpdates(interval); }
                        catch (Exception ignored) { stopSelf(); }
                    });
                fusedActive = true;
                return;
            } catch (SecurityException denied) { throw denied; }
            catch (RuntimeException unavailable) { /* Non-GMS devices retain the platform provider. */ }
        }
        requestPlatformUpdates(interval);
    }
    private void requestPlatformUpdates(long interval) {
        if (locations == null) return;
        try {
            if (locations.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, this);
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, interval, 0f, this);
        } catch (SecurityException denied) {
            try { SecureState.mutate(this, state -> state.put("sync_error", "Location permission changed. Open the app to restore precise access.")); } catch (Exception ignored) { }
            stopSelf();
        }
    }
    private void pauseForSettings() {
        if (pausedForSettings) return;
        pausedForSettings = true;
        if (fused != null && fusedCallback != null) fused.removeLocationUpdates(fusedCallback);
        if (locations != null) locations.removeUpdates(this);
        try { SecureState.mutate(this, state -> state.put("sync_error", "Phone location is off. Enable it to resume the current work session.")); }
        catch (Exception ignored) { }
    }
    @Override public void onLocationChanged(Location location) {
        try {
            if (!location.hasAccuracy() || !Float.isFinite(location.getAccuracy()) || location.getAccuracy() < 0
                || !Double.isFinite(location.getLatitude()) || !Double.isFinite(location.getLongitude()) || location.getTime() <= 0) return;
            Float speed = location.hasSpeed() && Float.isFinite(location.getSpeed()) && location.getSpeed() >= 0 ? location.getSpeed() : null;
            Float bearing = location.hasBearing() && Float.isFinite(location.getBearing()) ? location.getBearing() : null;
            GpsQuality.Fix fix = new GpsQuality.Fix(location.getElapsedRealtimeNanos(), location.getLatitude(), location.getLongitude(), location.getAccuracy());
            GpsQuality.Result quality = GpsQuality.evaluate(fix, previousFix, SystemClock.elapsedRealtimeNanos(), speed, positionAccuracyM, plausibleSpeedMps);
            JSONArray flags = new JSONArray();
            for (String flag : quality.flags) flags.put(flag);
            if (location.isFromMockProvider()) flags.put("mock");
            String receivedAt = Instant.now().toString();
            final boolean[] pressure = {queuePressure};
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
                    .put("accuracy_m", location.getAccuracy()).put("mock_location", location.isFromMockProvider())
                    .put("device_received_at", receivedAt).put("fix_age_ms", Math.min(Integer.MAX_VALUE, quality.ageMs))
                    .put("speed_m_s", speed == null ? JSONObject.NULL : speed)
                    .put("bearing_deg", bearing == null ? JSONObject.NULL : bearing)
                    .put("quality_flags", flags));
                state.put("point_sequence", sequence);
                state.put("last_fix_at", Instant.ofEpochMilli(location.getTime()).toString());
                state.put("last_fix_accuracy_m", location.getAccuracy());
                state.put("last_fix_flags", flags);
                pressure[0] = state.getJSONArray("points").length() >= 3000;
                state.put("gps_storage_pressure", pressure[0]);
            });
            if (!quality.flags.contains("stale") && !quality.flags.contains("duplicate")
                && !quality.flags.contains("out_of_order") && !quality.flags.contains("implausible_jump")) previousFix = fix;
            if (quality.moving) stationaryFixes = 0;
            else if (quality.flags.isEmpty()) stationaryFixes++;
            boolean nextStationary = stationaryFixes >= 3;
            if (nextStationary != stationary || pressure[0] != queuePressure) {
                stationary = nextStationary; queuePressure = pressure[0]; requestUpdates();
            }
        } catch (Exception failure) {
            try { SecureState.mutate(this, state -> state.put("sync_error", "Location storage unavailable or full. Sync and resume tracking.")); } catch (Exception ignored) { }
            stopSelf();
        }
    }
    @Override public void onProviderDisabled(String provider) {
        if (locations != null && (locations.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER))) return;
        pauseForSettings();
    }
    @Override public void onProviderEnabled(String provider) {
        if (!pausedForSettings || !running) return;
        try { if (mayCollect(SecureState.read(this))) { pausedForSettings = false; requestUpdates(); } }
        catch (Exception ignored) { stopSelf(); }
    }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (fused != null && fusedCallback != null) fused.removeLocationUpdates(fusedCallback);
        if (locations != null) locations.removeUpdates(this);
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
