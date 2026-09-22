package com.fieldcrm.sales;

import org.json.JSONArray;
import org.json.JSONObject;

/** A delayed GET must never undo attendance saved locally while it was in flight. */
final class SessionSnapshot {
    private SessionSnapshot() {}
    static void apply(JSONObject current, JSONObject requested, JSONArray sessions) throws Exception {
        if (sessions == null || current.getJSONArray("events").length() != 0
            || !current.optString("session_id").equals(requested.optString("session_id"))
            || current.optInt("event_sequence", -1) != requested.optInt("event_sequence", -1)
            || !current.optString("status").equals(requested.optString("status"))) return;
        JSONObject selected = null;
        for (int index = 0; index < sessions.length(); index++) {
            JSONObject session = sessions.getJSONObject(index);
            if (session.isNull("punched_out_at")) { selected = session; break; }
            if (session.getString("id").equals(current.optString("session_id"))) selected = session;
        }
        if (selected == null) return; // Absence from the bounded history is not proof of closure.
        if (!selected.isNull("punched_out_at")) {
            current.put("status", "off_duty");
            current.remove("active_project_id"); current.remove("active_schedule_id");
            current.remove("active_local_date"); current.remove("active_project_name"); current.remove("active_site_name");
            return;
        }
        current.put("session_start_ms", java.time.Instant.parse(selected.getString("punched_in_at")).toEpochMilli())
            .put("event_sequence", selected.getInt("last_sequence"))
            .put("session_id", selected.getString("id")).put("status", selected.optString("status", "working"))
            .put("active_project_id", selected.isNull("project_id") ? "" : selected.getString("project_id"))
            .put("active_schedule_id", selected.isNull("schedule_id") ? "" : selected.getString("schedule_id"))
            .put("active_local_date", selected.optString("local_date"))
            .put("active_project_name", selected.isNull("project_name") ? "Choose a project below" : selected.getString("project_name"))
            .put("active_site_name", selected.optString("site_name", ""));
    }
}
