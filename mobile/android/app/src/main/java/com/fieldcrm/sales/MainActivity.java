package com.fieldcrm.sales;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.text.InputType;
import android.text.InputFilter;
import android.view.*;
import android.widget.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.json.*;

/** A deliberately small field workflow: punch in, choose a project, punch out. */
public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(23, 37, 61), MUTED = Color.rgb(91, 105, 125);
    private static final int BRAND = Color.rgb(91, 70, 255), BRAND_DARK = Color.rgb(62, 46, 194);
    private static final int GREEN = Color.rgb(14, 159, 110), RED = Color.rgb(214, 55, 71);
    private static final int PAGE = Color.rgb(245, 247, 255), CARD = Color.WHITE;
    private LinearLayout content;
    private Spinner projectPicker;
    private final ArrayList<JSONObject> projectChoices = new ArrayList<>();
    private final Handler clock = new Handler(Looper.getMainLooper());
    private final Runnable refreshClock = new Runnable() {
        @Override public void run() { render(); sync(); clock.postDelayed(this, 60000); }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        SyncJobService.schedule(this);
        render();
    }
    @Override public void onResume() {
        super.onResume(); try { Attendance.autoPunchOut(this); } catch (Exception ignored) { }
        render(); sync(); clock.removeCallbacks(refreshClock); clock.postDelayed(refreshClock, 60000);
    }
    @Override public void onPause() { clock.removeCallbacks(refreshClock); super.onPause(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable shape(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable;
    }
    private TextView label(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL)); view.setLineSpacing(0, 1.12f); return view;
    }
    private void add(LinearLayout parent, View view, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(top); parent.addView(view, params);
    }
    private Button action(String text, int color) {
        Button button = new Button(this); button.setText(text); button.setTextSize(17); button.setTextColor(Color.WHITE);
        button.setAllCaps(false); button.setTypeface(Typeface.DEFAULT_BOLD); button.setMinHeight(dp(56)); button.setBackground(shape(color, 16)); return button;
    }
    private ImageButton icon(int resource, String description) {
        ImageButton button = new ImageButton(this); button.setImageResource(resource); button.setContentDescription(description);
        button.setColorFilter(INK); button.setBackground(shape(Color.WHITE, 24)); button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setMinimumWidth(dp(48)); button.setMinimumHeight(dp(48)); return button;
    }
    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(20), dp(20), dp(20), dp(20));
        card.setBackground(shape(CARD, 20)); card.setElevation(dp(2)); return card;
    }
    private void alert(String title, String message) { new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show(); }
    private void render() {
        if (isFinishing() || isDestroyed()) return;
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(PAGE);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(20), dp(18), dp(20), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -1)); setContentView(scroll);
        try {
            JSONObject state = SecureState.read(this); header(state.has("token"));
            if (!state.has("token")) connection(); else workplace(state);
        } catch (Exception failure) {
            LinearLayout problem = card(); add(problem, label("Secure storage needs attention", 20, RED, true), 0);
            add(problem, label("Do not clear app data. Contact your CRM administrator so pending records can be recovered.", 15, MUTED, false), 8); add(content, problem, 22);
        }
    }
    private void header(boolean connected) {
        LinearLayout row = new LinearLayout(this); row.setGravity(Gravity.CENTER_VERTICAL);
        row.addView(label("Field Sales", 28, INK, true), new LinearLayout.LayoutParams(0, dp(56), 1));
        if (connected) {
            ImageButton notice = icon(R.drawable.ic_notifications, "Notifications and sync status"); notice.setOnClickListener(v -> showNotifications());
            ImageButton profile = icon(R.drawable.ic_profile, "Profile and sign out"); profile.setOnClickListener(v -> showProfile());
            LinearLayout.LayoutParams first = new LinearLayout.LayoutParams(dp(48), dp(48)); first.leftMargin = dp(8); row.addView(notice, first);
            LinearLayout.LayoutParams second = new LinearLayout.LayoutParams(dp(48), dp(48)); second.leftMargin = dp(8); row.addView(profile, second);
        }
        content.addView(row);
    }
    private void connection() {
        add(content, label("Connect this phone", 24, INK, true), 24);
        add(content, label("Ask your administrator for a six-digit pairing code. It works once and expires after five minutes. Your CRM password is never entered here.", 15, MUTED, false), 8);
        LinearLayout form = card(); EditText key = field("Six-digit code", true);
        key.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        key.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});
        add(form, label("Six-digit code", 14, INK, true), 0); add(form, key, 6);
        Button connect = action("Connect securely", BRAND); add(form, connect, 18); add(content, form, 20);
        connect.setOnClickListener(v -> {
            String code = key.getText().toString().trim();
            if (!code.matches("[0-9]{6}")) { alert("Check code", "Enter the six digits shown in Team → Android keys."); return; }
            connect.setEnabled(false);
            SyncEngine.pair(this, code, () -> runOnUiThread(() -> { key.setText(""); render(); sync(); }),
                () -> runOnUiThread(() -> { connect.setEnabled(true); alert("Could not connect", "The code may be wrong, expired or already used. Ask your administrator for a new code."); }));
        });
    }
    private EditText field(String hint, boolean secret) {
        EditText field = new EditText(this); field.setHint(hint); field.setSingleLine(true); field.setTextSize(16); field.setMinHeight(dp(52));
        field.setPadding(dp(14), 0, dp(14), 0); field.setBackground(shape(Color.rgb(240, 242, 249), 12)); field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        field.setInputType(secret ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI); return field;
    }
    private void workplace(JSONObject state) throws Exception {
        String status = state.optString("status", "off_duty"); boolean working = WorkState.collecting(status);
        LinearLayout hero = card(); hero.setBackground(shape(working ? Color.rgb(228, 249, 240) : Color.rgb(235, 232, 255), 20));
        add(hero, label(working ? "You are punched in" : "Ready for today's work", 23, working ? Color.rgb(7, 105, 74) : BRAND_DARK, true), 0);
        add(hero, label(working ? "Your work session is in progress. Punch out when finished or after the 14-hour limit." : "Punch in to start your work session.", 15, MUTED, false), 6); add(content, hero, 22);
        if (working) activeShift(state); else offDuty(state);
    }
    private void offDuty(JSONObject state) throws Exception {
        LinearLayout panel = card(); add(panel, label("Start work", 18, INK, true), 0);
        add(panel, label("Your working hours and GPS begin when you punch in. Choose the project afterward.", 15, MUTED, false), 8);
        Button punch = action("Punch in", GREEN); punch.setOnClickListener(v -> confirmPunchIn()); add(panel, punch, 18);
        add(content, panel, 16);
    }
    private void activeShift(JSONObject state) throws Exception {
        LinearLayout panel = card(); add(panel, label("Active project", 16, MUTED, true), 0);
        add(panel, label(state.optString("active_project_name", "Choose a project below"), 23, INK, true), 8);
        long elapsed = Math.max(0, Math.min(Attendance.MAX_SHIFT_MS, System.currentTimeMillis() - state.optLong("session_start_ms", System.currentTimeMillis())));
        add(panel, label(String.format(Locale.US, "Working time: %d h %02d min", elapsed / 3600000L, (elapsed / 60000L) % 60), 15, INK, true), 7);
        if (!state.optString("active_site_name").isEmpty()) add(panel, label(state.optString("active_site_name"), 15, MUTED, false), 5);
        add(panel, label(TrackingService.running ? "Work in progress" : "GPS is restarting automatically", 14, GREEN, true), 14);
        JSONObject snapshot = state.optJSONObject("snapshot"); JSONArray occurrences = snapshot == null ? null : snapshot.optJSONArray("occurrences");
        JSONArray projects = snapshot == null ? null : snapshot.optJSONArray("projects");
        String zone = state.optString("timezone", "UTC"), shiftDate = state.optString("active_local_date", LocalDate.now(ZoneId.of(zone)).toString());
        projectChoices.clear(); ArrayList<String> choices = new ArrayList<>(); java.util.Set<String> scheduled = new java.util.HashSet<>();
        if (occurrences != null) for (int i = 0; i < occurrences.length(); i++) {
            JSONObject item = occurrences.getJSONObject(i); if (!shiftDate.equals(item.optString("date"))) continue;
            String time = item.optBoolean("untimed") ? "Any time" : DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of(zone)).format(Instant.parse(item.getString("starts_at")));
            projectChoices.add(new JSONObject().put("project_id", item.getString("project_id"))
                .put("schedule_id", item.getString("occurrence_key").split(":", 2)[0])
                .put("project_name", item.optString("project_name", "Scheduled project"))
                .put("site_name", item.optString("site_name", "")));
            scheduled.add(item.getString("project_id"));
            choices.add("Scheduled: " + item.optString("project_name", "Project") + " · " + time);
        }
        if (projects != null) for (int i = 0; i < projects.length(); i++) {
            JSONObject item = projects.getJSONObject(i); if (scheduled.contains(item.getString("id"))) continue;
            projectChoices.add(new JSONObject().put("project_id", item.getString("id")).put("schedule_id", "")
                .put("project_name", item.optString("name", "Project")).put("site_name", item.optString("site_name", "")));
            choices.add("Other project: " + item.optString("name", "Project"));
        }
        if (choices.isEmpty()) add(panel, label("No active projects are available. Ask your manager; GPS and working time continue until punch-out.", 15, RED, false), 12);
        else {
            projectPicker = new Spinner(this); projectPicker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, choices));
            projectPicker.setMinimumHeight(dp(56)); add(panel, projectPicker, 12);
            Button choose = action(state.optString("active_project_id").isEmpty() ? "Choose project" : "Change project", BRAND);
            choose.setOnClickListener(v -> chooseProject()); add(panel, choose, 10);
        }
        Button out = action("Punch out", RED); out.setOnClickListener(v -> confirmPunchOut()); add(panel, out, 22); add(content, panel, 16);
        if (!TrackingService.running) startTracking();
    }
    private void confirmPunchIn() {
        if (!permissions()) return;
        try {
            JSONObject snapshot = SecureState.read(this).optJSONObject("snapshot"), policy = snapshot == null ? null : snapshot.optJSONObject("settings");
            if (policy == null || !policy.optBoolean("enabled")) throw new IllegalStateException();
            new AlertDialog.Builder(this).setTitle("Start your work session?")
                .setMessage(policy.optString("notice_text") + "\n\nGPS starts now and stops at punch-out or after 14 hours. Choose a project after punching in.")
                .setNegativeButton("Cancel", null).setPositiveButton("Agree and punch in", (dialog, which) -> {
                    try { Attendance.punchIn(this); startTracking(); render(); } catch (Exception failure) { alert("Punch in not saved", "Refresh and try again."); }
                }).show();
        } catch (Exception failure) { alert("Policy unavailable", "Refresh assignments before punching in."); }
    }
    private void chooseProject() {
        if (projectPicker == null || projectChoices.isEmpty()) return;
        try { Attendance.selectProject(this, projectChoices.get(projectPicker.getSelectedItemPosition())); render(); }
        catch (Exception failure) { alert("Project not saved", "Your work session and GPS remain active. Sync and try again."); }
    }
    private void confirmPunchOut() {
        new AlertDialog.Builder(this).setTitle("Punch out now?").setMessage("GPS tracking will stop immediately. Pending records will continue syncing safely.")
            .setNegativeButton("Cancel", null).setPositiveButton("Punch out", (dialog, which) -> {
                try { Attendance.act(this, "punch_out"); render(); } catch (Exception failure) { alert("Needs attention", "GPS was stopped. Open Notifications to review pending attendance."); }
            }).show();
    }
    private void showNotifications() {
        try {
            JSONObject state = SecureState.read(this); int events = state.optJSONArray("events") == null ? 0 : state.getJSONArray("events").length();
            int points = state.optJSONArray("points") == null ? 0 : state.getJSONArray("points").length(); String issue = state.optString("sync_error");
            String message = "Last sync: " + state.optString("last_sync", "Not synced yet") + "\nPending attendance: " + events + "\nPending GPS records: " + points;
            if (!issue.isEmpty()) message += "\n\nNeeds attention: " + issue;
            new AlertDialog.Builder(this).setTitle("Notifications").setMessage(message).setNegativeButton("Close", null).setPositiveButton("Sync now", (d, w) -> sync()).show();
        } catch (Exception failure) { alert("Notifications unavailable", "Secure status could not be opened."); }
    }
    private void showProfile() {
        try {
            JSONObject state = SecureState.read(this), snapshot = state.optJSONObject("snapshot"); JSONObject employee = snapshot == null ? null : snapshot.optJSONObject("employee");
            String name = employee == null ? "Sales person" : employee.optString("display_name", "Sales person");
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Profile").setMessage(name + "\nOrganization time zone: " + state.optString("timezone", "UTC"))
                .setNegativeButton("Close", null).setPositiveButton("Sign out", null).create();
            dialog.setOnShowListener(x -> { Button signOut = dialog.getButton(AlertDialog.BUTTON_POSITIVE); signOut.setTextColor(RED); signOut.setOnClickListener(v -> signOut(dialog)); }); dialog.show();
        } catch (Exception failure) { alert("Profile unavailable", "Secure profile data could not be opened."); }
    }
    private void signOut(AlertDialog profile) {
        try {
            JSONObject state = SecureState.read(this);
            if (WorkState.collecting(state.optString("status", "off_duty"))) { alert("Punch out first", "Punch out before signing out so tracking stops and attendance is preserved."); return; }
            if (SyncEngine.hasPendingWork(state)) { alert("Sync before signing out", "Pending attendance or GPS records belong to this account. Open Notifications and sync them first."); return; }
            profile.dismiss(); SyncEngine.signOut(this, () -> runOnUiThread(() -> {
                try {
                    if (SecureState.read(this).has("token")) alert("Sign out not completed", "The server did not confirm sign-out. Your account remains safely connected.");
                    else Toast.makeText(this, "Signed out safely", Toast.LENGTH_SHORT).show();
                } catch (Exception ignored) { alert("Sign out not completed", "Secure status could not be confirmed."); }
                render();
            }));
        } catch (Exception failure) { alert("Sign out unavailable", "Pending records were retained. Try again after syncing."); }
    }
    private void sync() { SyncEngine.sync(this, () -> runOnUiThread(this::render)); }
    private boolean permissions() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
            (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(Build.VERSION.SDK_INT >= 33 ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1); return false;
        }
        return true;
    }
    private void startTracking() { if (!permissions()) return; try { startForegroundService(new Intent(this, TrackingService.class)); } catch (Exception failure) { alert("GPS unavailable", "Allow location and notifications, then reopen the app."); } }
}
