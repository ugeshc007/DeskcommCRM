package com.fieldcrm.sales;

import android.content.Context;
import android.content.Intent;
import java.time.Instant;
import java.util.UUID;
import org.json.JSONObject;

public final class Attendance {
    private Attendance() {}
    public static void punchIn(Context context, JSONObject occurrence) throws Exception {
        String projectId = occurrence.getString("project_id");
        String scheduleId = occurrence.getString("occurrence_key").split(":", 2)[0];
        String localDate = occurrence.getString("date");
        if (projectId.isEmpty() || scheduleId.isEmpty() || localDate.isEmpty()) throw new IllegalArgumentException("Assignment is incomplete.");
        SecureState.mutate(context, state -> {
            JSONObject snapshot = state.optJSONObject("snapshot"), policy = snapshot == null ? null : snapshot.optJSONObject("settings");
            if (policy == null || !policy.optBoolean("enabled") || state.optBoolean("access_denied")) throw new IllegalStateException("Sync an enabled policy first.");
            if (state.getJSONArray("events").length() >= 1000) throw new IllegalStateException("Attendance queue is full.");
            state.put("session_id", UUID.randomUUID().toString()).put("session_start_ms", System.currentTimeMillis())
                .put("event_sequence", 0).put("point_sequence", -1).put("status", WorkState.transition(state.getString("status"), "punch_in"))
                .put("active_project_id", projectId).put("active_schedule_id", scheduleId).put("active_local_date", localDate)
                .put("active_project_name", occurrence.optString("project_name", "Assigned project")).put("active_site_name", occurrence.optString("site_name", ""));
            state.getJSONArray("events").put(new JSONObject().put("event_id", UUID.randomUUID().toString()).put("session_id", state.getString("session_id"))
                .put("sequence", 0).put("action", "punch_in").put("captured_at", Instant.now().toString())
                .put("project_id", projectId).put("schedule_id", scheduleId).put("local_date", localDate));
        });
        SyncEngine.sync(context, null);
    }
    public static void act(Context context, String action) throws Exception {
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
                .put("action", action).put("captured_at", Instant.now().toString()));
            state.put("event_sequence", sequence); state.put("status", next);
            if (action.equals("punch_out")) {
                state.remove("active_project_id"); state.remove("active_schedule_id"); state.remove("active_local_date");
                state.remove("active_project_name"); state.remove("active_site_name");
            }
        });
        SyncEngine.sync(context, null);
    }
}
