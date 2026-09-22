package com.fieldcrm.sales;

import android.content.Context;
import android.content.Intent;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONObject;

public final class Attendance {
    public static final long MAX_SHIFT_MS = 14L * 60 * 60 * 1000;
    private Attendance() {}
    public static void punchIn(Context context) throws Exception {
        punchIn(context, null);
    }
    public static void punchIn(Context context, Runnable afterSync) throws Exception {
        JSONObject current = SecureState.read(context);
        String zone = current.optString("timezone", "UTC");
        String localDate = java.time.LocalDate.now(java.time.ZoneId.of(zone)).toString();
        SecureState.mutate(context, state -> {
            JSONObject snapshot = state.optJSONObject("snapshot"), policy = snapshot == null ? null : snapshot.optJSONObject("settings");
            if (policy == null || !policy.optBoolean("enabled") || state.optBoolean("access_denied")) throw new IllegalStateException("Sync an enabled policy first.");
            if (state.getJSONArray("events").length() >= 1000) throw new IllegalStateException("Attendance queue is full.");
            state.put("session_id", UUID.randomUUID().toString()).put("session_start_ms", System.currentTimeMillis())
                .put("event_sequence", 0).put("point_sequence", -1).put("status", WorkState.transition(state.getString("status"), "punch_in"))
                .put("active_local_date", localDate);
            state.remove("active_project_id"); state.remove("active_schedule_id");
            state.remove("active_project_name"); state.remove("active_site_name");
            state.getJSONArray("events").put(new JSONObject().put("event_id", UUID.randomUUID().toString()).put("session_id", state.getString("session_id"))
                .put("sequence", 0).put("action", "punch_in").put("captured_at", Instant.now().toString())
                .put("local_date", localDate));
        });
        SyncEngine.sync(context, afterSync);
    }
    public static void selectProject(Context context, JSONObject project) throws Exception {
        SecureState.mutate(context, state -> {
            if (!WorkState.collecting(state.optString("status", "off_duty"))) throw new IllegalStateException("Punch in first.");
            if (state.getJSONArray("events").length() >= 1000) throw new IllegalStateException("Attendance queue is full.");
            int sequence = state.getInt("event_sequence") + 1;
            String projectId = project.getString("project_id");
            String scheduleId = project.optString("schedule_id", "");
            JSONObject command = new JSONObject().put("event_id", UUID.randomUUID().toString())
                .put("session_id", state.getString("session_id")).put("sequence", sequence)
                .put("action", "select_project").put("captured_at", Instant.now().toString())
                .put("project_id", projectId).put("schedule_id", scheduleId.isEmpty() ? JSONObject.NULL : scheduleId)
                .put("local_date", state.getString("active_local_date"));
            state.getJSONArray("events").put(command);
            state.put("event_sequence", sequence).put("active_project_id", projectId)
                .put("active_schedule_id", scheduleId).put("active_project_name", project.optString("project_name", "Project"))
                .put("active_site_name", project.optString("site_name", ""));
        });
        SyncEngine.sync(context, null);
    }
    public static void act(Context context, String action) throws Exception {
        actAt(context, action, Instant.now());
    }
    public static void autoPunchOut(Context context) throws Exception {
        JSONObject state = SecureState.read(context);
        long start = state.optLong("session_start_ms", 0);
        if (start > 0 && WorkState.collecting(state.optString("status", "off_duty")) && System.currentTimeMillis() >= start + MAX_SHIFT_MS)
            actAt(context, "punch_out", Instant.ofEpochMilli(start + MAX_SHIFT_MS));
    }
    private static void actAt(Context context, String action, Instant capturedAt) throws Exception {
        if (action.equals("punch_in")) throw new IllegalArgumentException("Choose an assigned project before punching in.");
        // Stop collection before persistence/network. A disk failure must never keep GPS on.
        if (action.equals("punch_out")) context.stopService(new Intent(context, TrackingService.class));
        SecureState.mutate(context, state -> {
            String next = WorkState.transition(state.getString("status"), action);
            if (!action.equals("punch_out") && state.getJSONArray("events").length() >= 1000)
                throw new IllegalStateException("Attendance queue is full. Sync before starting more work; punch-out remains available.");
            int sequence = state.getInt("event_sequence") + 1;
            state.getJSONArray("events").put(new JSONObject().put("event_id", UUID.randomUUID().toString())
                .put("session_id", state.getString("session_id")).put("sequence", sequence)
                .put("action", action).put("captured_at", capturedAt.toString()));
            state.put("event_sequence", sequence); state.put("status", next);
            if (action.equals("punch_out")) {
                state.remove("active_project_id"); state.remove("active_schedule_id"); state.remove("active_local_date");
                state.remove("active_project_name"); state.remove("active_site_name");
            }
        });
        SyncEngine.sync(context, null);
    }
}
