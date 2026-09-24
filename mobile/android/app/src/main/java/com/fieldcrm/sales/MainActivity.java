package com.fieldcrm.sales;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.provider.Settings;
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
import java.math.BigDecimal;
import org.json.*;
import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;

/** A deliberately small field workflow: punch in, choose a project, punch out. */
public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(23, 37, 61), MUTED = Color.rgb(91, 105, 125);
    private static final int BRAND = Color.rgb(91, 70, 255), BRAND_DARK = Color.rgb(62, 46, 194);
    private static final int GREEN = Color.rgb(14, 159, 110), RED = Color.rgb(214, 55, 71);
    private static final int PAGE = Color.rgb(245, 247, 255), CARD = Color.WHITE;
    private LinearLayout content;
    private Spinner projectPicker;
    private final ArrayList<JSONObject> projectChoices = new ArrayList<>();
    private VoiceAssistant voiceAssistant;
    private boolean settingsPromptShown;
    private final Handler clock = new Handler(Looper.getMainLooper());
    private final Runnable refreshClock = new Runnable() {
        @Override public void run() { render(); sync(); clock.postDelayed(this, 60000); }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        voiceAssistant = new VoiceAssistant(this);
        SyncJobService.schedule(this);
        render();
    }
    @Override public void onResume() {
        super.onResume(); try { Attendance.autoPunchOut(this); } catch (Exception ignored) { }
        render(); sync(); clock.removeCallbacks(refreshClock); clock.postDelayed(refreshClock, 60000);
    }
    @Override public void onPause() { clock.removeCallbacks(refreshClock); voiceAssistant.cancel(); super.onPause(); }
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
        if (state.getJSONArray("events").length() > 0)
            add(hero, label("Attendance not yet confirmed by CRM. Open Notifications for sync details.", 15, RED, true), 10);
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
        add(panel, label(TrackingService.running ? "Work GPS tracking active" : "GPS is not active. Check permissions and resume tracking.", 14,
            TrackingService.running ? GREEN : RED, true), 14);
        if (!TrackingService.running) {
            Button resumeGps = action("Resume GPS", BRAND); resumeGps.setOnClickListener(v -> startTracking()); add(panel, resumeGps, 8);
        }
        if (state.optBoolean("gps_storage_pressure")) add(panel,
            label("Offline GPS queue is filling. Tracking uses slower updates until uploads resume.", 14, RED, true), 8);
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            add(panel, label("Approximate location only. Live pins may be unavailable; allow Precise location in Android app settings.", 14, RED, true), 10);
            Button locationSettings = action("Open location permission", BRAND);
            locationSettings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())))); add(panel, locationSettings, 8);
        }
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
            if (state.optBoolean("voice_enabled")) {
                add(panel, label("Voice AI asks for the next shop after you choose a project or save a shop visit.", 14, MUTED, false), 16);
                Button speak = action("Ask AI for next shop", BRAND);
                speak.setOnClickListener(v -> startDestinationConversation(false)); add(panel, speak, 10);
            }
            projectPicker = new Spinner(this); projectPicker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, choices));
            projectPicker.setMinimumHeight(dp(56)); add(panel, projectPicker, 12);
            Button choose = action(state.optString("active_project_id").isEmpty() ? "Choose project" : "Change project", BRAND);
            choose.setOnClickListener(v -> chooseProject()); add(panel, choose, 10);
        }
        if (!state.optString("active_project_id").isEmpty()) showProjectCustomers(state);
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
                    try {
                        Attendance.punchIn(this);
                        startTracking(); render();
                    } catch (Exception failure) { alert("Punch in not saved", "Refresh and try again."); }
                }).show();
        } catch (Exception failure) { alert("Policy unavailable", "Refresh assignments before punching in."); }
    }
    private void chooseProject() {
        if (projectPicker == null || projectChoices.isEmpty()) return;
        try { Attendance.selectProject(this, projectChoices.get(projectPicker.getSelectedItemPosition()), () -> runOnUiThread(() -> {
            try {
                JSONObject current = SecureState.read(this);
                if (current.optBoolean("voice_enabled") && WorkState.collecting(current.optString("status", "off_duty"))
                    && current.getJSONArray("events").length() == 0 && !current.optString("active_project_id").isEmpty())
                    startDestinationConversation(false);
            } catch (Exception ignored) { /* The touch controls remain available. */ }
        })); render(); }
        catch (Exception failure) { alert("Project not saved", "Your work session and GPS remain active. Sync and try again."); }
    }
    private void startDestinationConversation(boolean nextShop) {
        try {
            JSONObject state = SecureState.read(this);
            if (!state.optBoolean("voice_enabled") || !WorkState.collecting(state.optString("status", "off_duty"))
                || state.optString("active_project_id").isEmpty()) return;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 12);
                alert("Microphone permission", "Allow microphone access, then tap Ask AI for next shop. You can always use the shop list by touch.");
                return;
            }
            voiceAssistant.playPrompt(nextShop, this::startVoiceInput,
                () -> alert("Voice unavailable", "Use the shop list by touch. Your work session remains active."));
        } catch (Exception failure) { alert("Voice unavailable", "Use the shop list by touch."); }
    }
    private void startVoiceInput() {
        try {
            JSONObject current = SecureState.read(this);
            if (!current.optBoolean("voice_enabled") || !WorkState.collecting(current.optString("status", "off_duty"))
                || current.optString("active_project_id").isEmpty()) return;
        } catch (Exception ignored) { return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 12);
            alert("Microphone permission", "Allow microphone access, then tap Ask AI for next shop. The shop list still works by touch.");
            return;
        }
        try { voiceAssistant.start(); }
        catch (Exception failure) { alert("Microphone unavailable", "Choose a shop by touch."); return; }
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Listening")
            .setMessage("Tell me where you are going or what you are doing. Tap Stop when finished. Recording stops automatically after seven seconds.")
            .setNegativeButton("Cancel", (d, w) -> voiceAssistant.cancel())
            .setPositiveButton("Stop and transcribe", null).create();
        final Runnable[] autoStop = new Runnable[1];
        dialog.setOnDismissListener(d -> {
            if (autoStop[0] != null) clock.removeCallbacks(autoStop[0]);
            if (voiceAssistant.isRecording()) voiceAssistant.cancel();
        });
        dialog.setOnShowListener(shown -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            if (autoStop[0] != null) clock.removeCallbacks(autoStop[0]);
            voiceAssistant.stop(new VoiceAssistant.Result() {
                public void received(String text) { runOnUiThread(() -> confirmVoiceActivity(text)); }
                public void unavailable() { runOnUiThread(() -> alert("Voice unavailable", "Choose a shop by touch. Nothing was changed.")); }
            });
            dialog.dismiss();
        }));
        dialog.show();
        autoStop[0] = () -> { if (dialog.isShowing() && voiceAssistant.isRecording()) dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); };
        clock.postDelayed(autoStop[0], 7000);
    }
    private void confirmVoiceActivity(String transcript) {
        try {
            JSONObject state = SecureState.read(this);
            if (!WorkState.collecting(state.optString("status", "off_duty")) || state.optString("active_project_id").isEmpty()) return;
            JSONObject snapshot = state.optJSONObject("snapshot"); JSONArray roster = snapshot == null ? null : snapshot.optJSONArray("customers");
            ArrayList<JSONObject> customers = new ArrayList<>(); ArrayList<String> labels = new ArrayList<>();
            ArrayList<String> names = new ArrayList<>();
            if (roster != null) for (int i = 0; i < roster.length(); i++) {
                JSONObject shop = roster.getJSONObject(i);
                if (!state.getString("active_project_id").equals(shop.optString("project_id"))) continue;
                customers.add(shop); names.add(shop.optString("shop_name"));
                labels.add(shop.optString("shop_name") + " · " + shop.optString("customer_code"));
            }
            int match = ProjectVoiceMatcher.uniqueMatch(transcript, names);
            final JSONObject[] selected = { match < 0 ? null : customers.get(match) };
            LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(20), dp(8), dp(20), 0);
            EditText note = field("Confirm or correct what you said", false); note.setText(transcript);
            note.setFilters(new InputFilter[]{ new InputFilter.LengthFilter(1000) }); add(form, note, 0);
            if (!customers.isEmpty()) {
                AutoCompleteTextView picker = new AutoCompleteTextView(this); picker.setThreshold(1); picker.setSingleLine(true);
                picker.setHint("Link an assigned shop (optional)"); picker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_dropdown_item_1line, labels));
                if (match >= 0) picker.setText(labels.get(match), false);
                picker.setOnItemClickListener((parent, view, position, id) -> {
                    int index = labels.indexOf(String.valueOf(parent.getItemAtPosition(position)));
                    selected[0] = index < 0 ? null : customers.get(index);
                });
                picker.addTextChangedListener(new android.text.TextWatcher() {
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                    public void onTextChanged(CharSequence s, int start, int before, int count) { selected[0] = null; }
                    public void afterTextChanged(android.text.Editable s) { }
                });
                add(form, picker, 12);
            }
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Confirm activity note")
                .setMessage(match < 0 ? "No unique shop was recognized. Correct the note and choose a shop if needed; no payment will be recorded." :
                    "Review the recognized activity and shop. No payment will be recorded.")
                .setView(form).setNegativeButton("Discard", null).setPositiveButton("Save activity", null).create();
            dialog.setOnShowListener(shown -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                try {
                    String confirmed = note.getText().toString().trim();
                    if (confirmed.isEmpty() || confirmed.length() > 1000) { note.setError("Enter an activity note"); return; }
                    JSONObject current = SecureState.read(this);
                    if (!WorkState.collecting(current.optString("status", "off_duty")) || !state.getString("session_id").equals(current.optString("session_id"))
                        || !state.getString("active_project_id").equals(current.optString("active_project_id")))
                        throw new IllegalStateException();
                    JSONObject command = new JSONObject().put("activity_id", UUID.randomUUID().toString())
                        .put("session_id", current.getString("session_id")).put("project_id", current.getString("active_project_id"))
                        .put("project_customer_id", selected[0] == null ? JSONObject.NULL : selected[0].getString("id"))
                        .put("note", confirmed).put("source", "voice").put("captured_at", Instant.now().toString());
                    SyncEngine.activity(this, command, () -> runOnUiThread(this::render));
                    dialog.dismiss(); Toast.makeText(this, "Activity saved; syncing to CRM", Toast.LENGTH_SHORT).show();
                } catch (Exception failure) { alert("Activity not saved", "Check the work session and try again. No payment was recorded."); }
            }));
            dialog.show();
        } catch (Exception failure) { alert("Activity unavailable", "Use the shop list by touch."); }
    }
    private void showProjectCustomers(JSONObject state) throws Exception {
        JSONObject snapshot = state.optJSONObject("snapshot"); JSONArray roster = snapshot == null ? null : snapshot.optJSONArray("customers");
        if (roster == null) return;
        ArrayList<JSONObject> customers = new ArrayList<>(); ArrayList<String> labels = new ArrayList<>();
        String projectId = state.getString("active_project_id");
        for (int i = 0; i < roster.length(); i++) {
            JSONObject shop = roster.getJSONObject(i);
            if (!projectId.equals(shop.optString("project_id"))) continue;
            customers.add(shop); labels.add(shop.optString("shop_name") + " · " + shop.optString("customer_code"));
        }
        LinearLayout panel = card(); add(panel, label("Project shops", 18, INK, true), 0);
        if (customers.isEmpty()) add(panel, label("No shops assigned to this project yet. Ask your manager to add or import them in CRM → Projects.", 14, MUTED, false), 8);
        else {
            add(panel, label("Search for a shop, then record a visit or payment received.", 14, MUTED, false), 8);
            AutoCompleteTextView picker = new AutoCompleteTextView(this); picker.setThreshold(1); picker.setSingleLine(true);
            picker.setHint("Search shop name or code"); picker.setTextSize(16); picker.setMinHeight(dp(54));
            picker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_dropdown_item_1line, labels));
            final JSONObject[] selected = { null };
            picker.setOnItemClickListener((parent, view, position, id) -> {
                String choice = String.valueOf(parent.getItemAtPosition(position));
                int index = labels.indexOf(choice); selected[0] = index < 0 ? null : customers.get(index);
            });
            picker.addTextChangedListener(new android.text.TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                public void onTextChanged(CharSequence s, int start, int before, int count) { selected[0] = null; }
                public void afterTextChanged(android.text.Editable s) { }
            });
            add(panel, picker, 12);
            Button record = action("Record shop visit / collection", BRAND);
            record.setOnClickListener(v -> {
                JSONObject shop = selected[0];
                if (shop == null) { alert("Select a shop", "Choose one of the listed shops before recording a visit."); return; }
                openCollectionDialog(state, shop);
            }); add(panel, record, 10);
        }
        add(content, panel, 16);
    }
    private void openCollectionDialog(JSONObject state, JSONObject shop) {
        try {
            LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(20), dp(6), dp(20), 0);
            String currency = shop.optString("currency", "");
            String due = shop.isNull("balance_cents") ? "Due not specified" :
                new BigDecimal(shop.getString("balance_cents")).movePointLeft(2).signum() < 0
                  ? "Advance credit: " + currency + " " + new BigDecimal(shop.getString("balance_cents")).abs().movePointLeft(2).toPlainString()
                  : "Due: " + currency + " " + new BigDecimal(shop.getString("balance_cents")).movePointLeft(2).toPlainString();
            add(form, label(due, 14, MUTED, false), 0);
            EditText amount = field("Amount received (optional)", false);
            amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
            add(form, amount, 10);
            new AlertDialog.Builder(this).setTitle(shop.getString("shop_name"))
                .setMessage("Leave the amount blank to record a visit only. A payment is a record of money already received, not an online charge.")
                .setView(form).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> {
                    try {
                        String value = amount.getText().toString().trim();
                        Object cents = JSONObject.NULL;
                        if (!value.isEmpty()) {
                            BigDecimal parsed = new BigDecimal(value);
                            long minor = parsed.movePointRight(2).longValueExact();
                            if (minor <= 0 || minor > 1_000_000_000_000L) throw new IllegalArgumentException();
                            cents = minor;
                        }
                        JSONObject command = new JSONObject().put("collection_id", UUID.randomUUID().toString())
                            .put("project_customer_id", shop.getString("id")).put("project_id", shop.getString("project_id"))
                            .put("session_id", state.getString("session_id"))
                            .put("captured_at", Instant.now().toString()).put("amount_cents", cents);
                        SyncEngine.collection(this, command, () -> runOnUiThread(this::render));
                        Toast.makeText(this, "Shop record queued for sync", Toast.LENGTH_SHORT).show();
                        startDestinationConversation(true);
                    } catch (Exception failure) { alert("Not saved", "Enter a positive amount with up to two decimal places, or leave it blank for a visit."); }
                }).show();
        } catch (Exception failure) { alert("Shop unavailable", "Refresh the project customer list and try again."); }
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
            int activities = state.optJSONArray("pending_activities") == null ? 0 : state.getJSONArray("pending_activities").length();
            String message = "Last sync: " + state.optString("last_sync", "Not synced yet") + "\nPending attendance: " + events + "\nPending GPS records: " + points + "\nPending activity notes: " + activities;
            if (!issue.isEmpty()) message += "\n\nNeeds attention: " + issue;
            PowerManager power = getSystemService(PowerManager.class);
            if (power != null && !power.isIgnoringBatteryOptimizations(getPackageName()) && WorkState.collecting(state.optString("status")))
                message += "\n\nBattery restrictions may delay background GPS or uploads. Check Android battery settings if fresh fixes stop; the requested interval is not guaranteed.";
            new AlertDialog.Builder(this).setTitle("Notifications").setMessage(message).setNegativeButton("Close", null).setPositiveButton("Sync now", (d, w) -> sync()).show();
        } catch (Exception failure) { alert("Notifications unavailable", "Secure status could not be opened."); }
    }
    private void showProfile() {
        try {
            JSONObject state = SecureState.read(this), snapshot = state.optJSONObject("snapshot"); JSONObject employee = snapshot == null ? null : snapshot.optJSONObject("employee");
            String name = employee == null ? "Sales person" : employee.optString("display_name", "Sales person");
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Profile").setMessage(name + "\nOrganization time zone: " + state.optString("timezone", "UTC"))
                .setNegativeButton("Close", null).setNeutralButton("Voice settings", null).setPositiveButton("Sign out", null).create();
            dialog.setOnShowListener(x -> {
                Button signOut = dialog.getButton(AlertDialog.BUTTON_POSITIVE); signOut.setTextColor(RED); signOut.setOnClickListener(v -> signOut(dialog));
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> { dialog.dismiss(); showVoiceSettings(); });
            }); dialog.show();
        } catch (Exception failure) { alert("Profile unavailable", "Secure profile data could not be opened."); }
    }
    private void showVoiceSettings() {
        try {
            Switch enabled = new Switch(this); enabled.setText("Enable Voice AI"); enabled.setTextSize(17);
            enabled.setChecked(SecureState.read(this).optBoolean("voice_enabled"));
            LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setPadding(dp(24), dp(8), dp(24), dp(8));
            add(panel, enabled, 0);
            add(panel, label("Off by default. When on, the app asks where you are going after project selection and each saved shop visit. It listens for up to seven seconds while the app is open, then asks you to review the note. You can cancel, switch voice off, or use the shop list by touch. Temporary audio is deleted after transcription.", 14, MUTED, false), 12);
            new AlertDialog.Builder(this).setTitle("Voice settings").setView(panel)
                .setNegativeButton("Cancel", null).setPositiveButton("Save", (d, w) -> {
                    try {
                        SecureState.mutate(this, state -> state.put("voice_enabled", enabled.isChecked()));
                        if (!enabled.isChecked()) voiceAssistant.cancel(); render();
                    } catch (Exception failure) { alert("Settings not saved", "Try again; touch controls remain available."); }
                }).show();
        } catch (Exception failure) { alert("Settings unavailable", "Try again after reopening the app."); }
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
        if ((checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) ||
            (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(Build.VERSION.SDK_INT >= 33 ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1); return false;
        }
        return true;
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        render();
        if (requestCode == 1) try {
            if (WorkState.collecting(SecureState.read(this).optString("status"))) startTracking();
        } catch (Exception ignored) { }
    }
    private void startTracking() {
        if (!permissions()) return;
        LocationManager manager = getSystemService(LocationManager.class);
        boolean enabled = Build.VERSION.SDK_INT >= 28 ? manager.isLocationEnabled()
            : manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!enabled) {
            new AlertDialog.Builder(this).setTitle("Phone location is off")
                .setMessage("Enable phone location, then return to Field Sales. Your punch-in and pending records remain saved.")
                .setPositiveButton("Open location settings", (d, w) -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)))
                .setNegativeButton("Later", null).show(); return;
        }
        try {
            startForegroundService(new Intent(this, TrackingService.class));
            if (!settingsPromptShown && GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS) {
                settingsPromptShown = true;
                LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, GpsQuality.MOVING_INTERVAL_MS).build();
                LocationServices.getSettingsClient(this).checkLocationSettings(new LocationSettingsRequest.Builder().addLocationRequest(request).build())
                    .addOnFailureListener(error -> {
                        if (error instanceof ResolvableApiException) try {
                            ((ResolvableApiException) error).startResolutionForResult(this, 21);
                        } catch (Exception ignored) { /* The service still uses available providers. */ }
                    });
            }
        } catch (Exception failure) { alert("GPS unavailable", "Allow location and notifications, then reopen the app."); }
    }
}
