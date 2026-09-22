package com.fieldcrm.sales;

import org.json.JSONArray;
import org.json.JSONObject;

/** Deterministic delayed-response regressions using only synthetic in-memory state. */
final class SessionSnapshotTest {
    static JSONObject local() throws Exception {
        return new JSONObject().put("session_id", "old").put("status", "working")
            .put("event_sequence", 0).put("events", new JSONArray()).put("points", new JSONArray());
    }
    static JSONObject session(boolean closed) throws Exception {
        return new JSONObject().put("id", "old").put("status", closed ? "off_duty" : "working")
            .put("punched_in_at", "2026-09-22T10:00:00Z").put("punched_out_at", closed ? "2026-09-22T11:00:00Z" : JSONObject.NULL)
            .put("last_sequence", closed ? 1 : 0).put("project_id", JSONObject.NULL).put("schedule_id", JSONObject.NULL)
            .put("project_name", JSONObject.NULL).put("local_date", "2026-09-22");
    }
    static void unchanged(JSONObject current, JSONObject requested, JSONArray response) throws Exception {
        String before = current.toString();
        SessionSnapshot.apply(current, requested, response);
        if (!before.equals(current.toString())) throw new AssertionError("Stale snapshot changed local attendance");
    }
    static void run() throws Exception {
        JSONObject requested = local(); JSONArray open = new JSONArray().put(session(false));
        JSONObject stopped = local().put("status", "off_duty").put("event_sequence", 1);
        stopped.getJSONArray("events").put(new JSONObject().put("action", "punch_out"));
        unchanged(stopped, requested, open); // Pending stop cannot be resurrected.
        stopped.put("events", new JSONArray());
        unchanged(stopped, requested, open); // Nor can a stop already acknowledged by another sync.
        JSONObject next = local().put("session_id", "next");
        unchanged(next, requested, open); // A newer shift must retain its own GPS/session identity.
        JSONObject project = local().put("event_sequence", 1).put("active_project_id", "new-project");
        unchanged(project, requested, open);
        JSONObject current = local().put("active_project_id", "project");
        current.getJSONArray("points").put(new JSONObject().put("sample_id", "retained"));
        SessionSnapshot.apply(current, local(), new JSONArray().put(session(true)));
        if (!"off_duty".equals(current.getString("status")) || current.has("active_project_id")
            || current.getJSONArray("points").length() != 1) throw new AssertionError("Confirmed closure must stop work and preserve queued GPS");
        JSONObject pending = local(); pending.getJSONArray("events").put(new JSONObject().put("action", "select_project"));
        unchanged(pending, local(), new JSONArray().put(session(true)));
        JSONObject switched = local();
        SessionSnapshot.apply(switched, local(), new JSONArray().put(session(false).put("id", "new-server-session")).put(session(true)));
        if (!"new-server-session".equals(switched.getString("session_id"))) throw new AssertionError("Current server session must take precedence over closed history");
        JSONObject restore = new JSONObject().put("status", "off_duty").put("events", new JSONArray());
        JSONObject restoreRequest = new JSONObject(restore.toString());
        SessionSnapshot.apply(restore, restoreRequest, open);
        if (!"working".equals(restore.getString("status")) || !"old".equals(restore.getString("session_id"))
            || restore.getInt("event_sequence") != 0) throw new AssertionError("Unchanged device must recover its active server session");
    }
}
