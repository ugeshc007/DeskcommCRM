package com.fieldcrm.sales;

import android.content.Context;
import java.time.LocalDate;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Test-APK-only assignment builder; never packaged in the production application. */
final class TestAssignment {
    static JSONObject fromState(Context context) throws Exception {
        JSONObject snapshot = SecureState.read(context).optJSONObject("snapshot");
        JSONArray occurrences = snapshot == null ? null : snapshot.optJSONArray("occurrences");
        if (occurrences != null && occurrences.length() > 0) return occurrences.getJSONObject(0);
        String schedule = UUID.randomUUID().toString();
        return new JSONObject().put("project_id", UUID.randomUUID().toString()).put("occurrence_key", schedule + ":test")
            .put("date", LocalDate.now().toString()).put("project_name", "Isolated test project").put("site_name", "Test only");
    }
}
